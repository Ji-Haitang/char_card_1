/**
 * user-portrait-manager.js - 玩家自定义主角立绘
 *
 * 每个表情保存一张经过浏览器缩放压缩的 WebP；运行时按：
 * 精确表情 → 微笑 → 唯一立绘 → 当前唯一/首张立绘 的顺序回退。
 * 图片作为全局配置写入 storageService/IndexedDB，不随单个游戏存档切换。
 */
var userPortraitManager = (function() {
    'use strict';

    var USER_ID = 'USER';
    var BASE_KEY = '唯一立绘';
    var MAX_SOURCE_BYTES = 20 * 1024 * 1024;
    var MAX_STORED_BYTES = 3 * 1024 * 1024;
    var FALLBACK_EXPRESSIONS = ['大笑','平静','生气','兴奋','微笑','不满','严肃','害羞','尴尬','为难','惊讶','紧张','害怕','悲伤','哭泣','得意','发情'];

    function _esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _expressions() {
        var source = (typeof slgEmotionOptions !== 'undefined' && Array.isArray(slgEmotionOptions))
            ? slgEmotionOptions : FALLBACK_EXPRESSIONS;
        var result = [BASE_KEY];
        source.forEach(function(name) {
            if (!name || name === 'none' || /^特殊CG\d+$/.test(name) || result.indexOf(name) !== -1) return;
            result.push(name);
        });
        return result;
    }

    function _state() {
        if (typeof storageService === 'undefined' || !storageService.loadUserPortraits) {
            return { version: 2, enabled: false, images: {} };
        }
        var value = storageService.loadUserPortraits();
        var images = (value && value.images && typeof value.images === 'object') ? value.images : {};
        var hasImages = Object.keys(images).length > 0;
        return {
            version: 2,
            // 旧版已有图片但没有 enabled 字段时保持原有“上传即显示”行为。
            enabled: hasImages && ((value && typeof value.enabled === 'boolean') ? value.enabled : true),
            images: images
        };
    }

    async function _save(state) {
        if (typeof storageService === 'undefined' || !storageService.saveUserPortraits) {
            throw new Error('存储服务尚未就绪');
        }
        return storageService.saveUserPortraits(state);
    }

    function _cleanToken(value) {
        return String(value || '').replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]/g, '').trim();
    }

    function isUserToken(value) {
        var token = _cleanToken(value);
        if (!token) return false;
        var lower = token.toLowerCase();
        if (['user','player','主角','玩家','你'].indexOf(lower) !== -1) return true;
        var playerName = (typeof gameData !== 'undefined' && gameData && gameData.playerName)
            ? _cleanToken(gameData.playerName) : '';
        return !!playerName && token === playerName;
    }

    function hasPortrait() {
        return Object.keys(_state().images).length > 0;
    }

    function isEnabled() {
        return !!_state().enabled;
    }

    function isDisplayEnabled() {
        var state = _state();
        return !!state.enabled && Object.keys(state.images).length > 0;
    }

    async function setEnabled(enabled) {
        var state = _state();
        var hasImages = Object.keys(state.images).length > 0;
        state.enabled = !!enabled && hasImages;
        try {
            await _save(state);
            render(document.getElementById('user-portrait-manager-root'));
            _notifyChanged();
            return state.enabled;
        } catch (error) {
            render(document.getElementById('user-portrait-manager-root'));
            if (typeof showModal === 'function') showModal(error && error.message ? error.message : String(error));
            return false;
        }
    }

    function getPortraitRecord(emotion) {
        var images = _state().images;
        var keys = Object.keys(images);
        if (keys.length === 0) return null;
        var requested = String(emotion || '');
        if (requested && requested !== 'none' && images[requested]) return images[requested];
        if (images['微笑']) return images['微笑'];
        if (images[BASE_KEY]) return images[BASE_KEY];
        // 若只上传了一张或只有其他表情，任何缺失表情都使用首张可用立绘。
        return images[keys[0]] || null;
    }

    function getPortraitUrl(emotion) {
        if (!isDisplayEnabled()) return null;
        var record = getPortraitRecord(emotion);
        return record && record.dataUrl ? record.dataUrl : null;
    }

    function getDisplayName() {
        return (typeof gameData !== 'undefined' && gameData && gameData.playerName) ? gameData.playerName : '主角';
    }

    function _dataUrlBytes(dataUrl) {
        var comma = String(dataUrl || '').indexOf(',');
        if (comma < 0) return 0;
        return Math.ceil((dataUrl.length - comma - 1) * 3 / 4);
    }

    function _readImage(file) {
        return new Promise(function(resolve, reject) {
            if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type || '')) {
                reject(new Error('仅支持 PNG、JPG/JPEG 或 WebP 图片'));
                return;
            }
            if (file.size > MAX_SOURCE_BYTES) {
                reject(new Error('原图不能超过 20MB'));
                return;
            }
            var reader = new FileReader();
            reader.onerror = function() { reject(new Error('读取图片失败')); };
            reader.onload = function() {
                var image = new Image();
                image.onerror = function() { reject(new Error('图片无法解码')); };
                image.onload = function() { resolve({ image: image, source: reader.result }); };
                image.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function _encode(image, maxDimension, quality) {
        var scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
        var width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
        var height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
        var canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        var context = canvas.getContext('2d', { alpha: true });
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        var dataUrl = canvas.toDataURL('image/webp', quality);
        // 极旧 WebView 不支持 WebP 编码时会返回 PNG，仍保留透明通道并正常使用。
        if (!/^data:image\/(webp|png);/i.test(dataUrl)) dataUrl = canvas.toDataURL('image/png');
        return { dataUrl: dataUrl, width: width, height: height, bytes: _dataUrlBytes(dataUrl) };
    }

    async function _processFile(file) {
        var decoded = await _readImage(file);
        var encoded = _encode(decoded.image, 1600, 0.9);
        if (encoded.bytes > MAX_STORED_BYTES) encoded = _encode(decoded.image, 1200, 0.8);
        if (encoded.bytes > MAX_STORED_BYTES) throw new Error('压缩后图片仍超过 3MB，请使用尺寸更小的原图');
        return encoded;
    }

    function _notifyChanged() {
        try {
            if (typeof refreshTianshanNpcPortraits === 'function') refreshTianshanNpcPortraits();
            if (typeof GameMode !== 'undefined' && GameMode === 1 && typeof updateStoryDisplay === 'function') updateStoryDisplay();
        } catch (e) { console.warn('[UserPortrait] 刷新立绘失败:', e); }
    }

    function render(root) {
        if (!root) return;
        var state = _state();
        var hasImages = Object.keys(state.images).length > 0;
        var displayEnabled = !!state.enabled && hasImages;
        var toggleHint = !hasImages ? '请先上传立绘' : (displayEnabled ? '已开启' : '已关闭');
        var options = _expressions().map(function(name) {
            return '<option value="' + _esc(name) + '">' + _esc(name) + '</option>';
        }).join('');
        var cards = Object.keys(state.images).map(function(name) {
            var item = state.images[name];
            return '<div style="display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px;border:1px solid rgba(128,128,128,.28);border-radius:7px;margin-bottom:7px">' +
                '<div style="width:72px;height:72px;overflow:hidden;border-radius:5px;background:rgba(0,0,0,.08)"><img src="' + item.dataUrl + '" alt="' + _esc(name) + '" style="width:100%;height:100%;object-fit:contain"></div>' +
                '<div style="min-width:0"><div style="font-weight:bold">' + _esc(name) + '</div>' +
                '<div style="font-size:11px;color:#999;overflow-wrap:anywhere">' + _esc(item.fileName || '') + '<br>' + item.width + '×' + item.height + ' · ' + Math.round((item.bytes || 0) / 1024) + 'KB</div></div>' +
                '<button class="cfg-btn cfg-btn-subtle" onclick="userPortraitManager.remove(\'' + _esc(name) + '\')">删除</button></div>';
        }).join('');
        if (!cards) cards = '<div style="padding:18px;text-align:center;color:#999">尚未上传主角立绘。未上传时不会显示主角图层。</div>';

        root.innerHTML = '<div class="pm-section">' +
            '<p style="font-size:12px;line-height:1.7;color:#999">为主角上传唯一立绘或各表情差分。缺少某个表情时依次回退到“微笑”→“唯一立绘”→首张可用图片。推荐透明背景 PNG/WebP。</p>' +
            '<div class="gs-switch-row" style="margin-bottom:10px">' +
            '<span class="gs-switch-label"><strong>剧情中显示主角立绘</strong><br><small style="color:#999">关闭后，提示词和立绘槽位均只使用 NPC</small></span>' +
            '<label class="gs-toggle-wrap"><input type="checkbox" ' + (displayEnabled ? 'checked ' : '') + (!hasImages ? 'disabled ' : '') + 'onchange="userPortraitManager.setEnabled(this.checked)">' +
            '<span class="gs-toggle-track"><span class="gs-toggle-thumb"></span></span><span class="gs-toggle-hint">' + toggleHint + '</span></label>' +
            '</div>' +
            '<div class="gs-switch-row" style="align-items:flex-end;flex-wrap:wrap;gap:8px">' +
            '<label style="flex:1 1 130px"><span class="gs-switch-label" style="display:block;margin-bottom:4px">立绘类型</span><select id="user-portrait-expression" class="cfg-input">' + options + '</select></label>' +
            '<label style="flex:2 1 210px"><span class="gs-switch-label" style="display:block;margin-bottom:4px">选择图片</span><input id="user-portrait-file" type="file" accept="image/png,image/jpeg,image/webp" class="cfg-input"></label>' +
            '<button class="cfg-btn cfg-btn-green" onclick="userPortraitManager.uploadSelected()">上传并保存</button>' +
            '</div><div id="user-portrait-status" style="min-height:18px;font-size:12px;color:#999;margin:6px 0"></div>' +
            '<div>' + cards + '</div></div>';
    }

    async function uploadSelected() {
        var expressionEl = document.getElementById('user-portrait-expression');
        var fileEl = document.getElementById('user-portrait-file');
        var status = document.getElementById('user-portrait-status');
        var file = fileEl && fileEl.files ? fileEl.files[0] : null;
        if (!file) {
            if (status) status.textContent = '请先选择图片';
            return;
        }
        var expression = expressionEl ? expressionEl.value : BASE_KEY;
        if (status) status.textContent = '正在处理图片…';
        try {
            var encoded = await _processFile(file);
            var state = _state();
            var hadImages = Object.keys(state.images).length > 0;
            state = { version: 2, enabled: hadImages ? !!state.enabled : true, images: Object.assign({}, state.images) };
            state.images[expression] = {
                dataUrl: encoded.dataUrl,
                fileName: file.name || '',
                width: encoded.width,
                height: encoded.height,
                bytes: encoded.bytes,
                updatedAt: Date.now()
            };
            await _save(state);
            render(document.getElementById('user-portrait-manager-root'));
            _notifyChanged();
            if (typeof showModal === 'function') showModal('主角“' + _esc(expression) + '”立绘已保存');
        } catch (error) {
            if (status) status.textContent = error && error.message ? error.message : String(error);
        }
    }

    function remove(expression) {
        var perform = async function() {
            try {
                var state = _state();
                var images = Object.assign({}, state.images);
                delete images[expression];
                await _save({ version: 2, enabled: !!state.enabled && Object.keys(images).length > 0, images: images });
                render(document.getElementById('user-portrait-manager-root'));
                _notifyChanged();
            } catch (error) {
                if (typeof showModal === 'function') showModal(error && error.message ? error.message : String(error));
            }
        };
        if (typeof showConfirmModal === 'function') {
            showConfirmModal('删除主角立绘', '确定删除“' + _esc(expression) + '”立绘吗？', perform);
        } else if (window.confirm('确定删除该立绘吗？')) perform();
    }

    return {
        USER_ID: USER_ID,
        BASE_KEY: BASE_KEY,
        render: render,
        uploadSelected: uploadSelected,
        remove: remove,
        hasPortrait: hasPortrait,
        isEnabled: isEnabled,
        isDisplayEnabled: isDisplayEnabled,
        setEnabled: setEnabled,
        isUserToken: isUserToken,
        getPortraitRecord: getPortraitRecord,
        getPortraitUrl: getPortraitUrl,
        getDisplayName: getDisplayName
    };
})();
