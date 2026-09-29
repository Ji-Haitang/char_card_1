/**
 * prompt-manager-modal.js - 提示词管理面板（系统设置-游戏设置-提示词管理）
 *
 * 按 prompt-builder.js 实际拼装顺序，列出可查看/可编辑的 prompt 条目：
 *   - 可调条目：编辑后保存为 promptOverrides（全局配置，不随存档走）
 *   - 不可调条目：仅供查看原始内容
 *   - 下拉框条目（主要NPC信息/行动指导/思维链）：任选一项单独编辑，存 promptOverrides
 *   - 地点信息（v0.6 更新）：不再走 promptOverrides，直接读/写 locationMemory（随存档走），
 *     编辑器是独立的结构化表单（危险度/友善度/行动建议/子场景分开填写），不是自由文本框
 *
 * 依赖：prompt-overrides.js, prompt-data-core.js, prompt-data-npc.js,
 *        prompt-data-actions.js, prompt-data-extra.js, prompt-builder.js（LOCATION_REGISTRY/renderLocationText/parseLocationText/getPromptLocationDefault）,
 *        storage-service.js（loadLocationMemory/saveLocationMemory）
 */

var promptManagerModal = (function() {

    var _locState = null; // 地点信息结构化编辑器的当前表单状态

    // --- 行动指导：从 ACTION_REGISTRY 的首个 key 推导展示名 ---
    function _actionDisplayName(entry) {
        var k = (entry.keys && entry.keys[0]) || entry.varName;
        return k.replace(/^行动选择[:：]\s*/, '');
    }

    function _npcOverrideKey(varName) { return varName.replace(/^PROMPT_/, ''); }
    function _actionOverrideKey(varName) { return varName.replace(/^PROMPT_/, ''); }

    // --- 提示词/世界书预设切换：上游默认 + 四个相互独立的本地槽位 ---
    var _PRESET_LS_MODE = 'jxz_presetMode';
    var _PRESET_LS_LEGACY_BACKUP = 'jxz_presetBackup'; // 旧版唯一“我的自定义”备份，自动迁移到槽位1
    var _PRESET_LS_SLOT_PREFIX = 'jxz_presetSlot_';
    var _PRESET_LS_NAMES = 'jxz_presetSlotNames';
    var _PRESET_MODES = ['default', 'custom1', 'custom2', 'custom3', 'custom4'];
    var _PRESET_DEFAULT_NAMES = {
        default: '上游默认',
        custom1: '本地槽位 1',
        custom2: '本地槽位 2',
        custom3: '本地槽位 3',
        custom4: '本地槽位 4'
    };

    function _isPresetMode(mode) {
        return _PRESET_MODES.indexOf(mode) !== -1;
    }

    function _normalizePresetMode(mode) {
        // 兼容旧版 custom/default：原“我的自定义”无损映射为本地槽位1。
        if (mode === 'custom') return 'custom1';
        return _isPresetMode(mode) ? mode : 'custom1';
    }

    function _presetMode() {
        var raw = localStorage.getItem(_PRESET_LS_MODE) || 'custom1';
        var normalized = _normalizePresetMode(raw);
        if (raw !== normalized) localStorage.setItem(_PRESET_LS_MODE, normalized);
        return normalized;
    }

    function _presetSlotKey(mode) {
        return _PRESET_LS_SLOT_PREFIX + mode;
    }

    function _presetBackup(mode) {
        mode = _normalizePresetMode(mode);
        if (mode === 'default') return null;
        try {
            var data = JSON.parse(localStorage.getItem(_presetSlotKey(mode)) || 'null');
            if (data) return data;
        } catch(e) {}

        // 槽位1首次读取时兼容旧版单备份；迁移后仍保留旧 key，便于降级回旧版本。
        if (mode === 'custom1') {
            try {
                var legacy = JSON.parse(localStorage.getItem(_PRESET_LS_LEGACY_BACKUP) || 'null');
                if (legacy) {
                    localStorage.setItem(_presetSlotKey(mode), JSON.stringify(legacy));
                    return legacy;
                }
            } catch(e2) {}
        }
        return null;
    }

    function _savePresetBackup(mode, data) {
        mode = _normalizePresetMode(mode);
        if (mode === 'default') return;
        var raw = JSON.stringify(data || _emptyPresetSnapshot());
        localStorage.setItem(_presetSlotKey(mode), raw);
        // 槽位1同步维护旧版备份 key，确保版本回退时仍能恢复原自定义内容。
        if (mode === 'custom1') localStorage.setItem(_PRESET_LS_LEGACY_BACKUP, raw);
    }

    function _emptyPresetSnapshot() {
        return { overrides: {}, wb1: [], wb2: [] };
    }

    function _snapshotCustom() {
        var snap = {};
        // localStorage 优先（PC），为空则回退 storageService._cache（APK/IDB-only）
        try { snap.overrides = JSON.parse(localStorage.getItem('jxz_promptOverrides') || 'null'); } catch(e) { snap.overrides = null; }
        if (!snap.overrides && typeof storageService !== 'undefined') {
            try { snap.overrides = JSON.parse(JSON.stringify(storageService.loadPromptOverrides() || {})); } catch(e2) { snap.overrides = {}; }
        }
        if (!snap.overrides) snap.overrides = {};

        try { snap.wb1 = JSON.parse(localStorage.getItem('jxz_customWorldbook') || 'null'); } catch(e) { snap.wb1 = null; }
        if (!snap.wb1 && typeof storageService !== 'undefined') {
            try { snap.wb1 = JSON.parse(JSON.stringify(storageService.loadCustomWorldbook('1') || [])); } catch(e2) { snap.wb1 = []; }
        }
        if (!snap.wb1) snap.wb1 = [];

        try { snap.wb2 = JSON.parse(localStorage.getItem('jxz_customWorldbook2') || 'null'); } catch(e) { snap.wb2 = null; }
        if (!snap.wb2 && typeof storageService !== 'undefined') {
            try { snap.wb2 = JSON.parse(JSON.stringify(storageService.loadCustomWorldbook('2') || [])); } catch(e2) { snap.wb2 = []; }
        }
        if (!snap.wb2) snap.wb2 = [];

        return snap;
    }

    function _restoreCustom(snap) {
        snap = snap || _emptyPresetSnapshot();
        // 四个槽位均恢复为独立 JSON 副本，防止数组/对象引用在槽位之间串改。
        var copy;
        try { copy = JSON.parse(JSON.stringify(snap)); }
        catch(e) { copy = _emptyPresetSnapshot(); }

        // 写 localStorage
        localStorage.setItem('jxz_promptOverrides', JSON.stringify(copy.overrides || {}));
        localStorage.setItem('jxz_customWorldbook', JSON.stringify(copy.wb1 || []));
        localStorage.setItem('jxz_customWorldbook2', JSON.stringify(copy.wb2 || []));
        // 同步 storageService 缓存
        if (typeof storageService !== 'undefined') {
            storageService.saveCustomWorldbook('1', copy.wb1 || []);
            storageService.saveCustomWorldbook('2', copy.wb2 || []);
            // 批量恢复 promptOverrides
            if (typeof storageService.savePromptOverrides === 'function') {
                storageService.savePromptOverrides(copy.overrides || {});
            } else {
                var overrides = copy.overrides || {};
                for (var k in overrides) {
                    if (overrides.hasOwnProperty(k)) storageService.savePromptOverride(k, overrides[k]);
                }
            }
        }
    }

    function _clearAllCustom() {
        // 清 localStorage
        localStorage.removeItem('jxz_promptOverrides');
        localStorage.removeItem('jxz_customWorldbook');
        localStorage.removeItem('jxz_customWorldbook2');
        // 同步 storageService 缓存
        if (typeof storageService !== 'undefined') {
            storageService.saveCustomWorldbook('1', []);
            storageService.saveCustomWorldbook('2', []);
            // 批量清空 promptOverrides
            if (typeof storageService.savePromptOverrides === 'function') {
                storageService.savePromptOverrides({});
            } else {
                var all = storageService.loadPromptOverrides();
                var keys = [];
                for (var k in all) { if (all.hasOwnProperty(k)) keys.push(k); }
                keys.forEach(function(k) { storageService.resetPromptOverride(k); });
            }
        }
    }

    function _presetNames() {
        var saved = {};
        try { saved = JSON.parse(localStorage.getItem(_PRESET_LS_NAMES) || '{}') || {}; }
        catch(e) { saved = {}; }
        var result = {};
        _PRESET_MODES.forEach(function(mode) {
            var value = typeof saved[mode] === 'string' ? saved[mode].trim() : '';
            result[mode] = value ? value.slice(0, 24) : _PRESET_DEFAULT_NAMES[mode];
        });
        return result;
    }

    function _presetLabel(mode) {
        var names = _presetNames();
        return names[mode] || _PRESET_DEFAULT_NAMES[mode] || mode;
    }

    function _openPresetNameEditor() {
        var old = document.getElementById('pm-preset-name-modal');
        if (old) old.remove();
        var names = _presetNames();
        var rows = _PRESET_MODES.map(function(mode) {
            return '<div class="cfg-field"><label class="cfg-label">' + _escapeHtml(_PRESET_DEFAULT_NAMES[mode]) + '</label>' +
                '<input id="pm-preset-name-' + mode + '" class="cfg-input" maxlength="24" value="' + _escapeHtml(names[mode]) + '"></div>';
        }).join('');
        var html = '<div id="pm-preset-name-modal" class="modal viewport-overlay" style="display:flex;align-items:center;justify-content:center;position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;z-index:5200">' +
            '<div class="modal-content" style="position:relative;left:auto;top:auto;transform:none;display:flex;align-items:center;justify-content:center;width:100%;height:100%;max-width:none;max-height:none;margin:0;background:transparent;border:none;box-shadow:none;padding:8px;box-sizing:border-box;overflow:hidden">' +
            '<div class="cfg-panel" style="max-width:520px;width:100%;max-height:calc(100dvh - 16px);display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box">' +
            '<h3 class="cfg-title">编辑槽位名称</h3>' +
            '<div class="cfg-scroll-body"><p class="cfg-hint">名称只影响显示，不会合并或移动各槽位中的提示词与世界书内容。</p>' + rows + '</div>' +
            '<div class="cfg-footer">' +
            '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._closePresetNameEditor()">取消</button>' +
            '<button class="cfg-btn cfg-btn-green" onclick="promptManagerModal._savePresetNames()">保存名称</button>' +
            '</div></div></div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
    }

    function _closePresetNameEditor() {
        var modal = document.getElementById('pm-preset-name-modal');
        if (modal) modal.remove();
    }

    function _savePresetNames() {
        var next = {};
        for (var i = 0; i < _PRESET_MODES.length; i++) {
            var mode = _PRESET_MODES[i];
            var input = document.getElementById('pm-preset-name-' + mode);
            var value = input ? input.value.trim() : '';
            if (!value) {
                if (typeof showModal === 'function') showModal('槽位名称不能为空');
                return;
            }
            next[mode] = value.slice(0, 24);
        }
        localStorage.setItem(_PRESET_LS_NAMES, JSON.stringify(next));
        _closePresetNameEditor();
        _refreshRoot();
        if (typeof showModal === 'function') showModal('槽位名称已保存');
    }

    function _switchPreset(targetMode) {
        if (!_isPresetMode(targetMode)) return;
        var currentMode = _presetMode();
        if (targetMode === currentMode) return;

        // 离开本地槽位前先保存当前实时配置；上游默认不建立槽位快照，切离时丢弃其临时改动。
        if (currentMode !== 'default') {
            _savePresetBackup(currentMode, _snapshotCustom());
        }

        _clearAllCustom();
        if (targetMode !== 'default') {
            var targetSnapshot = _presetBackup(targetMode) || _emptyPresetSnapshot();
            _restoreCustom(targetSnapshot);
            // 首次进入空槽位也立即建档，确保四个槽位拥有彼此独立的持久化记录。
            if (!_presetBackup(targetMode)) _savePresetBackup(targetMode, targetSnapshot);
        }
        localStorage.setItem(_PRESET_LS_MODE, targetMode);

        if (typeof showModal === 'function') {
            showModal('已切换到「' + _escapeHtml(_presetLabel(targetMode)) + '」');
        }
        _refreshRoot();
    }

    // 保留旧入口的兼容行为：本地任一槽位 ↔ 上游默认；从上游返回时进入槽位1。
    function _togglePreset() {
        _switchPreset(_presetMode() === 'default' ? 'custom1' : 'default');
    }

    function _presetBar() {
        var mode = _presetMode();
        var isDefault = mode === 'default';
        var color = isDefault ? '#4CAF50' : '#FF9800';
        var buttons = _PRESET_MODES.map(function(candidate) {
            var active = candidate === mode;
            var candidateColor = candidate === 'default' ? '#4CAF50' : '#FF9800';
            return '<button class="cfg-btn cfg-btn-subtle" title="' + _escapeHtml(_presetLabel(candidate)) + '"' +
                ' style="width:100%;min-width:0;height:40px;padding:5px 6px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-color:' + candidateColor + ';color:' + candidateColor + ';' + (active ? 'opacity:1;background:rgba(255,255,255,0.55);font-weight:bold;' : 'opacity:0.72;background:transparent;') + '"' +
                (active ? ' disabled' : '') +
                ' onclick="promptManagerModal._switchPreset(\'' + candidate + '\')">' + _escapeHtml(_presetLabel(candidate)) + '</button>';
        }).join('');

        return '<div style="padding:4px 0 10px;margin-bottom:10px;background:transparent;border:0;border-bottom:1px solid rgba(128,128,128,0.22);border-radius:0">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">' +
            '<div style="font-size:14px;color:' + color + ';font-weight:bold;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">当前：' + _escapeHtml(_presetLabel(mode)) + '</div>' +
            '<button class="cfg-btn cfg-btn-subtle" style="flex:0 0 auto;padding:4px 9px;font-size:12px" onclick="promptManagerModal._openPresetNameEditor()">✎ 编辑名称</button>' +
            '</div>' +
            '<div class="pm-preset-grid" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;align-items:stretch">' + buttons + '</div>' +
            '<div style="font-size:11px;color:#999;margin-top:8px">切换时自动保存当前本地槽位；四个槽位的提示词覆盖、地点信息及两类世界书互相独立。</div>' +
            '</div>';
    }

    // --- 渲染整个面板 ---
    function render(root) {
        if (!root) return;

        var html = '';
        html += '<style>.pm-section > .gs-switch-row:last-child { border-bottom: none; }</style>';
        // html += '<p class="cfg-hint">以下内容按实际发送给 LLM 的拼装顺序列出。"可调"条目点开后可编辑并保存，保存为全局配置（不随存档走，所有存档共用）；"只读"条目仅供查看。</p>';

        // 分组1：PROMPT头部
        html += _pmSection([
            _pmBtn('OPENING', 'PROMPT头部', false)
        ]);

        // 分组2：叙事基调 / 故事背景
        html += _pmSection([
            _pmBtn('INFO_TONE', '叙事基调', true),
            _pmBtn('CORE_010', '故事背景', true)
        ]);

        // 分组3：地点信息
        html += _pmSection([
            _pmLocationDropdown()
        ]);

        // 世界书大类No.1（插入位置：地点信息之后、] 之前）
        html += _pmWorldbookCategory('1');

        // 分组4a：文笔风格 / 对话历史 / 防止重复要求
        html += _pmSection([
            _pmBtn('WRITING_STYLE', '文笔风格', true),
            _pmDisabledBtn('对话历史'),
            _pmNpcDropdown(),
            _pmBtn('CORE_040', '主角信息', true),
            _pmBtn('FRESH', '防止重复要求', false)
        ]);

        // 世界书大类No.2（插入位置：</fresh> 与 <user_input> 之间）
        html += _pmWorldbookCategory('2');

        // 分组4b：本次用户输入 / 行动指导 / 信息列表 / 输出格式规范
        html += _pmSection([
            _pmDisabledBtn('本次用户输入'),
            _pmActionDropdown(),
            _pmBtn('CORE_105', '信息列表', false),
            _pmBtn('CORE_110', '输出格式规范', false)
        ]);

        // 分组5：剧情生成要求 / 思维链
        html += _pmSection([
            _pmBtn('ORDER', '剧情生成要求', true),
            _pmThinkGuidanceDropdown(),
            _pmThinkToggle()
        ]);

        // 分组6：越狱前缀 / 最终指令
        html += _pmSection([
            _pmBtn('JAILBREAK_PREFILL', '越狱前缀', false),
            _pmBtn('FINAL_INSTRUCTION', '最终指令', false)
        ]);

        root.innerHTML = html;
    }

    function _pmSection(rowsHtml) {
        return '<div class="pm-section">' + rowsHtml.join('') + '</div><div style="height:3px;background:#000;margin:14px 0;border:none;"></div>';
    }

    function _hasOverrideBadge(key, editable) {
        if (!editable) return '';
        var has = (typeof promptOverrides !== 'undefined') && promptOverrides.has(key);
        return has ? ' <span style="font-size:12px;color:#4CAF50">（已自定义）</span>' : '';
    }

    function _pmBtn(key, label, editable) {
        var badge = _hasOverrideBadge(key, editable);
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">' + label + badge + '</span>' +
            '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal.open(\'' + key + '\')">' + (editable ? '编辑' : '查看') + '</button>' +
            '</div>';
    }

    function _pmDisabledBtn(label) {
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label" style="opacity:0.6">' + label + '</span>' +
            '<button class="cfg-btn cfg-btn-subtle" disabled style="opacity:0.4;cursor:not-allowed">不可调</button>' +
            '</div>';
    }

    function _pmLocationDropdown() {
        var opts = '<option value="">-- 选择地点 --</option>';
        var reg = window.LOCATION_REGISTRY || [];
        var memory = (typeof storageService !== 'undefined' && storageService.loadLocationMemory) ? storageService.loadLocationMemory() : {};
        for (var i = 0; i < reg.length; i++) {
            var overridden = !!memory[reg[i]];
            opts += '<option value="' + _escapeHtml(reg[i]) + '">' + _escapeHtml(reg[i]) + (overridden ? '（已被AI更新）' : '') + '</option>';
        }
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">地点信息</span>' +
            '<select class="cfg-input" style="flex:1 1 160px;max-width:220px;min-width:0" onchange="promptManagerModal._openLocation(this)">' + opts + '</select>' +
            '</div>';
    }

    function _pmNpcDropdown() {
        var opts = '<option value="">-- 选择NPC --</option>';
        var reg = window.NPC_REGISTRY || [];
        for (var i = 0; i < reg.length; i++) {
            var key = _npcOverrideKey(reg[i].varName);
            var overridden = (typeof promptOverrides !== 'undefined') && promptOverrides.has(key);
            opts += '<option value="' + _escapeHtml(reg[i].varName) + '">' + _escapeHtml(reg[i].name) + (overridden ? '（已自定义）' : '') + '</option>';
        }
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">主要NPC信息</span>' +
            '<select class="cfg-input" style="flex:1 1 160px;max-width:220px;min-width:0" onchange="promptManagerModal._openNpc(this)">' + opts + '</select>' +
            '</div>';
    }

    function _pmActionDropdown() {
        var opts = '<option value="">-- 选择行动 --</option>';
        var reg = window.ACTION_REGISTRY || [];
        for (var i = 0; i < reg.length; i++) {
            var key = _actionOverrideKey(reg[i].varName);
            var overridden = (typeof promptOverrides !== 'undefined') && promptOverrides.has(key);
            opts += '<option value="' + _escapeHtml(reg[i].varName) + '">' + _escapeHtml(_actionDisplayName(reg[i])) + (overridden ? '（已自定义）' : '') + '</option>';
        }
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">行动指导</span>' +
            '<select class="cfg-input" style="flex:1 1 160px;max-width:220px;min-width:0" onchange="promptManagerModal._openAction(this)">' + opts + '</select>' +
            '</div>';
    }

    function _pmThinkGuidanceDropdown() {
        var options = [
            { key: 'THINK_GUIDANCE', label: '默认（非DeepSeek模型）' },
            { key: 'THINK_GUIDANCE_DEEPSEEK', label: 'DeepSeek模型' }
        ];
        var opts = '<option value="">-- 选择模型 --</option>';
        for (var i = 0; i < options.length; i++) {
            var overridden = (typeof promptOverrides !== 'undefined') && promptOverrides.has(options[i].key);
            opts += '<option value="' + options[i].key + '">' + options[i].label + (overridden ? '（已自定义）' : '') + '</option>';
        }
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">思维链</span>' +
            '<select class="cfg-input" style="flex:1 1 160px;max-width:220px;min-width:0" onchange="promptManagerModal._openThink(this)">' + opts + '</select>' +
            '</div>';
    }

    /**
     * 显示 LLM 思维链 开关（正文区实时展示 reasoning_content）
     */
    function _pmThinkToggle() {
        var STORAGE_KEY = 'jxz_showThinking';
        var enabled = false;
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved !== null) enabled = saved === 'true';
        } catch (e) {}
        window._showThinkingEnabled = enabled;
        return '<div class="gs-switch-row">' +
            '<span class="gs-switch-label">显示思考过程</span>' +
            '<label class="gs-toggle-wrap">' +
            '<input type="checkbox" id="gs-thinking-toggle" onchange="promptManagerModal._toggleThinking(this)"' + (enabled ? ' checked' : '') + '>' +
            '<span class="gs-toggle-track"><span class="gs-toggle-thumb"></span></span>' +
            '<span class="gs-toggle-hint" id="gs-thinking-hint">' + (enabled ? '开' : '关') + '</span>' +
            '</label>' +
            '<span style="font-size:11px;color:rgba(255,255,255,0.5);margin-left:8px;">正文上方的斜体思考文字</span>' +
            '</div>';
    }

    function _toggleThinking(el) {
        var STORAGE_KEY = 'jxz_showThinking';
        var enabled = el.checked;
        try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch (e) {}
        window._showThinkingEnabled = enabled;
        var hint = document.getElementById('gs-thinking-hint');
        if (hint) hint.textContent = enabled ? '开' : '关';
        if (!enabled) {
            var display = document.getElementById('story-thinking');
            if (display) {
                display.style.display = 'none';
                display.textContent = '';
            }
        }
    }

    // --- 下拉框选中后打开编辑弹窗 ---
    function _openLocation(sel) {
        var name = sel.value;
        if (!name) return;
        _openLocationStructured(name);
        sel.selectedIndex = 0;
    }

    function _openNpc(sel) {
        var varName = sel.value;
        if (!varName) return;
        var key = _npcOverrideKey(varName);
        var reg = window.NPC_REGISTRY || [];
        var label = varName;
        for (var i = 0; i < reg.length; i++) { if (reg[i].varName === varName) { label = reg[i].name; break; } }
        open(key, '主要NPC信息 - ' + label, true, window[varName] || '');
        sel.selectedIndex = 0;
    }

    function _openAction(sel) {
        var varName = sel.value;
        if (!varName) return;
        var key = _actionOverrideKey(varName);
        var reg = window.ACTION_REGISTRY || [];
        var label = varName;
        for (var i = 0; i < reg.length; i++) { if (reg[i].varName === varName) { label = _actionDisplayName(reg[i]); break; } }
        open(key, '行动指导 - ' + label, true, window[varName] || '');
        sel.selectedIndex = 0;
    }

    function _openThink(sel) {
        var key = sel.value;
        if (!key) return;
        var label = (key === 'THINK_GUIDANCE_DEEPSEEK') ? '思维链 - DeepSeek模型' : '思维链 - 默认';
        var defaultText = (key === 'THINK_GUIDANCE_DEEPSEEK')
            ? (typeof PROMPT_THINK_GUIDANCE_DEEPSEEK !== 'undefined' ? PROMPT_THINK_GUIDANCE_DEEPSEEK : '')
            : (typeof PROMPT_THINK_GUIDANCE !== 'undefined' ? PROMPT_THINK_GUIDANCE : '');
        open(key, label, true, defaultText);
        sel.selectedIndex = 0;
    }

    // --- 固定 key -> 默认常量 / 展示名 映射（用于单按钮条目）---
    var _FIXED_MAP = {
        OPENING:            { title: 'PROMPT头部',     editable: false, get: function() { return typeof PROMPT_OPENING !== 'undefined' ? PROMPT_OPENING : ''; } },
        INFO_TONE:          { title: '叙事基调',        editable: true,  get: function() { return typeof PROMPT_INFO_TONE !== 'undefined' ? PROMPT_INFO_TONE : ''; } },
        CORE_010:           { title: '故事背景',        editable: true,  get: function() { return typeof PROMPT_CORE_010 !== 'undefined' ? PROMPT_CORE_010 : ''; } },
        CORE_040:           { title: '主角信息',        editable: true,  get: function() { return typeof PROMPT_CORE_040 !== 'undefined' ? PROMPT_CORE_040 : ''; } },
        WRITING_STYLE:      { title: '文笔风格',        editable: true,  get: function() { return typeof PROMPT_WRITING_STYLE !== 'undefined' ? PROMPT_WRITING_STYLE : ''; } },
        FRESH:              { title: '防止重复要求',    editable: false, get: function() { return typeof PROMPT_FRESH !== 'undefined' ? PROMPT_FRESH : ''; } },
        CORE_105:           { title: '信息列表',        editable: false, get: function() { return typeof PROMPT_CORE_105 !== 'undefined' ? PROMPT_CORE_105 : ''; } },
        CORE_110:           { title: '输出格式规范',    editable: false, get: function() { return typeof PROMPT_CORE_110 !== 'undefined' ? PROMPT_CORE_110 : ''; } },
        ORDER:              { title: '剧情生成要求',    editable: true,  get: function() { return typeof PROMPT_ORDER !== 'undefined' ? PROMPT_ORDER : ''; } },
        JAILBREAK_PREFILL:  { title: '越狱前缀',        editable: false, get: function() {
            var a = typeof PROMPT_JAILBREAK_PREFILL !== 'undefined' ? PROMPT_JAILBREAK_PREFILL : '';
            var b = typeof PROMPT_JAILBREAK_PREFILL_DEEPSEEK !== 'undefined' ? PROMPT_JAILBREAK_PREFILL_DEEPSEEK : '';
            return '【非DeepSeek模型版本】\n' + a + '\n\n【DeepSeek模型版本】\n' + b;
        } },
        FINAL_INSTRUCTION:  { title: '最终指令',        editable: false, get: function() { return typeof PROMPT_FINAL_INSTRUCTION !== 'undefined' ? PROMPT_FINAL_INSTRUCTION : ''; } }
    };

    /**
     * 打开编辑/查看弹窗
     * @param {string} key - 覆盖 key（不可调条目也复用同一套 key，只是不会写入覆盖）
     * @param {string} titleOverride - 可选，标题覆盖（下拉框条目用）
     * @param {boolean} editableOverride - 可选，是否可编辑（下拉框条目用）
     * @param {string} defaultTextOverride - 可选，默认内容（下拉框条目用）
     */
    function open(key, titleOverride, editableOverride, defaultTextOverride) {
        var title, editable, defaultText;
        if (typeof titleOverride !== 'undefined') {
            title = titleOverride;
            editable = !!editableOverride;
            defaultText = defaultTextOverride || '';
        } else {
            var fixed = _FIXED_MAP[key];
            if (!fixed) return;
            title = fixed.title;
            editable = fixed.editable;
            defaultText = fixed.get();
        }

        var existing = document.getElementById('prompt-editor-modal');
        if (existing) existing.remove();

        var current = editable ? ((typeof promptOverrides !== 'undefined') ? promptOverrides.get(key, defaultText) : defaultText) : defaultText;
        var hasOverride = editable && (typeof promptOverrides !== 'undefined') && promptOverrides.has(key);

        var innerHtml =
            '<h3 class="cfg-title">' + _escapeHtml(title) + (hasOverride ? ' <span style="font-size:13px;color:#4CAF50">（已自定义）</span>' : '') + '</h3>' +
            (editable
                ? '<p class="cfg-hint">修改后点击"保存"生效（全局配置，不随存档走）。点击"恢复默认"可撤销自定义，恢复出厂内容。</p>'
                : '<p class="cfg-hint">此条目为只读展示，不可编辑。</p>') +
            '<textarea id="prompt-editor-textarea" class="cfg-input" style="width:100%;height:50vh;min-height:260px;font-family:monospace;font-size:12px;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;box-sizing:border-box;resize:vertical"' +
            (editable ? '' : ' readonly') + '>' + _escapeHtml(current) + '</textarea>' +
            '<div class="modal-buttons" style="margin-top:12px">' +
            (editable
                ? '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._resetDefault(\'' + key + '\')">恢复默认</button>' +
                  '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._close()">取消</button>' +
                  '<button class="cfg-btn cfg-btn-green" onclick="promptManagerModal._save(\'' + key + '\')">保存</button>'
                : '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._close()">关闭</button>') +
            '</div>';

        var html;
        if (typeof fitModalToViewport === 'function') {
            html = '<div id="prompt-editor-modal" class="modal viewport-overlay" style="z-index:5000">' +
                '<div class="modal-content" style="display:flex;justify-content:flex-start;align-items:center;background:transparent;border:none;box-shadow:none;padding:3% 16px;box-sizing:border-box;overflow-y:auto">' +
                '<div class="cfg-panel" style="max-width:720px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div></div>';
        } else {
            html = '<div id="prompt-editor-modal" class="cfg-overlay" style="z-index:5000">' +
                '<div class="cfg-panel" style="max-width:720px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div>';
        }

        document.body.insertAdjacentHTML('beforeend', html);
        var modal = document.getElementById('prompt-editor-modal');
        if (typeof fitModalToViewport === 'function') {
            modal.style.display = 'block';
            requestAnimationFrame(function() {
                fitModalToViewport(modal);
                if (typeof bindModalAutoFit === 'function') bindModalAutoFit(modal);
            });
        } else {
            modal.style.display = 'flex';
        }
    }

    function _close() {
        var modal = document.getElementById('prompt-editor-modal');
        if (modal) modal.remove();
    }

    function _refreshRoot() {
        var root = document.getElementById('gs-prompt-manager-root');
        if (!root) return;
        // 新版弹窗由 .game-dialog-body 滚动，旧版由 .gs-panel-wrap 滚动；重绘前保存实际滚动容器的位置。
        var scroller = root.closest
            ? (root.closest('.game-dialog-body') || root.closest('.gs-panel-wrap'))
            : null;
        var scrollTop = scroller ? scroller.scrollTop : root.scrollTop;
        render(root);
        var restore = function() {
            if (scroller) scroller.scrollTop = scrollTop;
            else root.scrollTop = scrollTop;
        };
        // 同步恢复一次，再在浏览器完成新布局后恢复一次，兼容横屏和字体变化造成的重排。
        restore();
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
    }

    function _save(key) {
        var ta = document.getElementById('prompt-editor-textarea');
        if (!ta || typeof promptOverrides === 'undefined') { _close(); return; }
        promptOverrides.set(key, ta.value);
        _close();
        _refreshRoot();
        if (typeof showModal === 'function') showModal('已保存自定义提示词');
    }

    function _resetDefault(key) {
        _confirm('恢复默认提示词', '确定要恢复默认提示词吗？当前自定义内容将被移除。', function() {
            if (typeof promptOverrides !== 'undefined') promptOverrides.reset(key);
            _close();
            _refreshRoot();
        });
    }

    // ========== 地点信息结构化编辑器（v0.6：不再走 promptOverrides，直接读写 locationMemory） ==========

    var _LOC_LEVEL_OPTIONS = ['低', '较低', '中', '较高', '高'];

    // 把 locationMemory[name] 或 parseLocationText() 解析出的结构化对象，转成表单编辑用的可变状态
    function _locBuildStateFromData(name, data) {
        data = data || {};
        var danger = data['危险度'] || {};
        var friendly = data['友善度'] || {};
        var advice = Array.isArray(data['行动建议']) ? data['行动建议'] : [];
        var scenesObj = data['子场景'] || {};
        var scenes = [];
        Object.keys(scenesObj).forEach(function(sceneName) {
            var s = scenesObj[sceneName] || {};
            var labels = [];
            Object.keys(s).forEach(function(k) {
                if (k === '介绍' || k === '备注') return;
                var v = s[k];
                var valStr = Array.isArray(v) ? v.join('\n') : (typeof v === 'string' ? v : '');
                labels.push({ label: k, value: valStr });
            });
            scenes.push({
                name: sceneName,
                intro: (typeof s['介绍'] === 'string') ? s['介绍'] : '',
                note: (typeof s['备注'] === 'string') ? s['备注'] : '',
                labels: labels
            });
        });
        return {
            name: name,
            dangerLevel: danger['评级'] || '',
            dangerDesc: danger['说明'] || '',
            friendlyLevel: friendly['评级'] || '',
            friendlyDesc: friendly['说明'] || '',
            advice: advice.join('\n'),
            scenes: scenes
        };
    }

    function _locLevelSelectHtml(id, current) {
        var html = '<select id="' + id + '" class="cfg-input" style="width:100px">';
        html += '<option value=""' + (current ? '' : ' selected') + '>--</option>';
        _LOC_LEVEL_OPTIONS.forEach(function(lv) {
            html += '<option value="' + lv + '"' + (lv === current ? ' selected' : '') + '>' + lv + '</option>';
        });
        html += '</select>';
        return html;
    }

    function _locRenderSceneBlock(scene, sceneIdx) {
        var html = '<div class="loc-scene-block" style="border:1px solid rgba(128,128,128,0.35);border-radius:8px;padding:10px;margin-bottom:10px;">';
        html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">';
        html += '<input type="text" class="cfg-input loc-scene-name" data-scene-idx="' + sceneIdx + '" value="' + _escapeHtml(scene.name) + '" placeholder="子场景名" style="flex:1">';
        html += '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._locRemoveScene(' + sceneIdx + ')">删除该子场景</button>';
        html += '</div>';
        html += '<div style="margin-bottom:6px;"><label style="font-size:12px;opacity:0.7;">介绍</label><textarea class="cfg-input loc-scene-intro" data-scene-idx="' + sceneIdx + '" style="width:100%;min-height:50px;box-sizing:border-box;">' + _escapeHtml(scene.intro) + '</textarea></div>';
        scene.labels.forEach(function(lb, labelIdx) {
            html += '<div class="pm-wb-row" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
                '<button class="cfg-btn cfg-btn-subtle" style="flex:1;min-width:0;text-align:left" onclick="promptManagerModal._locOpenLabelEditor(' + sceneIdx + ',' + labelIdx + ')">' +
                _escapeHtml(lb.label || '(未命名标签)') +
                '</button>' +
                '<button onclick="promptManagerModal._locRemoveLabel(' + sceneIdx + ',' + labelIdx + ')" ' +
                'style="background:none;border:none;color:#c0392b;font-size:18px;line-height:1;cursor:pointer;padding:2px 8px;" title="删除标签">×</button>' +
                '</div>';
        });
        html += '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._locAddLabel(' + sceneIdx + ')" style="margin-bottom:6px;">+ 新增标签</button>';
        html += '<div><label style="font-size:12px;opacity:0.7;">备注</label><textarea class="cfg-input loc-scene-note" data-scene-idx="' + sceneIdx + '" style="width:100%;min-height:40px;box-sizing:border-box;">' + _escapeHtml(scene.note) + '</textarea></div>';
        html += '</div>';
        return html;
    }

    function _locRenderFormHtml() {
        var st = _locState;
        var html = '';
        html += '<div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;">';
        html += '<div><label style="font-size:12px;opacity:0.7;display:block;">危险度评级</label>' + _locLevelSelectHtml('loc-danger-level', st.dangerLevel) + '</div>';
        html += '<div style="flex:1;min-width:160px;"><label style="font-size:12px;opacity:0.7;display:block;">危险度说明</label><input type="text" id="loc-danger-desc" class="cfg-input" style="width:100%;box-sizing:border-box;" value="' + _escapeHtml(st.dangerDesc) + '"></div>';
        html += '</div>';
        html += '<div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;">';
        html += '<div><label style="font-size:12px;opacity:0.7;display:block;">友善度评级</label>' + _locLevelSelectHtml('loc-friendly-level', st.friendlyLevel) + '</div>';
        html += '<div style="flex:1;min-width:160px;"><label style="font-size:12px;opacity:0.7;display:block;">友善度说明</label><input type="text" id="loc-friendly-desc" class="cfg-input" style="width:100%;box-sizing:border-box;" value="' + _escapeHtml(st.friendlyDesc) + '"></div>';
        html += '</div>';
        html += '<div style="margin-bottom:10px;"><label style="font-size:12px;opacity:0.7;display:block;">行动建议（一行一条）</label><textarea id="loc-advice" class="cfg-input" style="width:100%;min-height:70px;box-sizing:border-box;">' + _escapeHtml(st.advice) + '</textarea></div>';
        html += '<h4 style="margin:10px 0 6px;">子场景</h4>';
        html += '<div id="loc-scenes-container">';
        st.scenes.forEach(function(scene, idx) { html += _locRenderSceneBlock(scene, idx); });
        html += '</div>';
        html += '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._locAddScene()" style="margin-bottom:10px;">+ 新增子场景</button>';
        return html;
    }

    // 把 DOM 上当前输入同步回 _locState（在任何结构性改动——增删场景/标签——之前必须先调用，防止丢失用户已输入内容）
    function _locSyncFromDom() {
        var st = _locState;
        if (!st) return;
        var dl = document.getElementById('loc-danger-level'); if (dl) st.dangerLevel = dl.value;
        var dd = document.getElementById('loc-danger-desc'); if (dd) st.dangerDesc = dd.value;
        var fl = document.getElementById('loc-friendly-level'); if (fl) st.friendlyLevel = fl.value;
        var fd = document.getElementById('loc-friendly-desc'); if (fd) st.friendlyDesc = fd.value;
        var adv = document.getElementById('loc-advice'); if (adv) st.advice = adv.value;
        document.querySelectorAll('.loc-scene-name').forEach(function(el) {
            var idx = parseInt(el.getAttribute('data-scene-idx'), 10);
            if (st.scenes[idx]) st.scenes[idx].name = el.value;
        });
        document.querySelectorAll('.loc-scene-intro').forEach(function(el) {
            var idx = parseInt(el.getAttribute('data-scene-idx'), 10);
            if (st.scenes[idx]) st.scenes[idx].intro = el.value;
        });
        document.querySelectorAll('.loc-scene-note').forEach(function(el) {
            var idx = parseInt(el.getAttribute('data-scene-idx'), 10);
            if (st.scenes[idx]) st.scenes[idx].note = el.value;
        });
    }

    function _locRefreshFormArea() {
        var container = document.getElementById('loc-editor-body');
        if (container) container.innerHTML = _locRenderFormHtml();
    }

    function _locAddScene() {
        _locSyncFromDom();
        _locState.scenes.push({ name: '', intro: '', note: '', labels: [] });
        _locRefreshFormArea();
    }

    function _locRemoveScene(idx) {
        _locSyncFromDom();
        _locState.scenes.splice(idx, 1);
        _locRefreshFormArea();
    }

    function _locAddLabel(sceneIdx) {
        _locSyncFromDom();
        _locState.scenes[sceneIdx].labels.push({ label: '', value: '' });
        _locRefreshFormArea();
        _locOpenLabelEditor(sceneIdx, _locState.scenes[sceneIdx].labels.length - 1);
    }

    function _locRemoveLabel(sceneIdx, labelIdx) {
        _locSyncFromDom();
        _locState.scenes[sceneIdx].labels.splice(labelIdx, 1);
        _locRefreshFormArea();
    }

    // 标签编辑弹窗（参考世界书条目编辑弹窗的样式，层叠在地点信息编辑弹窗之上）
    function _locOpenLabelEditor(sceneIdx, labelIdx) {
        _locSyncFromDom();
        var scene = _locState && _locState.scenes[sceneIdx];
        var lb = scene && scene.labels[labelIdx];
        if (!lb) return;

        var existing = document.getElementById('loc-label-editor-modal');
        if (existing) existing.remove();

        var innerHtml =
            '<h3 class="cfg-title">编辑标签</h3>' +
            '<div class="cfg-field"><label class="cfg-label">标签名称</label>' +
            '<input id="loc-label-editor-name" type="text" class="cfg-input" value="' + _escapeHtml(lb.label) + '" placeholder="如：建筑特色"></div>' +
            '<div class="cfg-field"><label class="cfg-label">具体介绍（一行一条）</label>' +
            '<textarea id="loc-label-editor-value" class="cfg-input" style="width:100%;height:32vh;min-height:160px;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;box-sizing:border-box;resize:vertical">' + _escapeHtml(lb.value) + '</textarea></div>' +
            '<div class="modal-buttons" style="margin-top:12px">' +
            '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._locCloseLabelEditor()">取消</button>' +
            '<button class="cfg-btn cfg-btn-green" onclick="promptManagerModal._locSaveLabelEditor(' + sceneIdx + ',' + labelIdx + ')">保存</button>' +
            '</div>';

        var html;
        if (typeof fitModalToViewport === 'function') {
            html = '<div id="loc-label-editor-modal" class="modal viewport-overlay" style="z-index:5100">' +
                '<div class="modal-content" style="display:flex;justify-content:flex-start;align-items:center;background:transparent;border:none;box-shadow:none;padding:3% 16px;box-sizing:border-box;overflow-y:auto">' +
                '<div class="cfg-panel" style="max-width:560px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div></div>';
        } else {
            html = '<div id="loc-label-editor-modal" class="cfg-overlay" style="z-index:5100">' +
                '<div class="cfg-panel" style="max-width:560px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div>';
        }
        document.body.insertAdjacentHTML('beforeend', html);
        var modal = document.getElementById('loc-label-editor-modal');
        if (typeof fitModalToViewport === 'function') {
            modal.style.display = 'block';
            requestAnimationFrame(function() {
                fitModalToViewport(modal);
                if (typeof bindModalAutoFit === 'function') bindModalAutoFit(modal);
            });
        } else {
            modal.style.display = 'flex';
        }
    }

    function _locCloseLabelEditor() {
        var modal = document.getElementById('loc-label-editor-modal');
        if (modal) modal.remove();
    }

    function _locSaveLabelEditor(sceneIdx, labelIdx) {
        var nameEl = document.getElementById('loc-label-editor-name');
        var valueEl = document.getElementById('loc-label-editor-value');
        var scene = _locState && _locState.scenes[sceneIdx];
        var lb = scene && scene.labels[labelIdx];
        if (!lb) { _locCloseLabelEditor(); return; }
        if (nameEl) lb.label = nameEl.value;
        if (valueEl) lb.value = valueEl.value;
        _locCloseLabelEditor();
        _locRefreshFormArea();
    }

    function _openLocationStructured(name) {
        var memory = (typeof storageService !== 'undefined' && storageService.loadLocationMemory) ? storageService.loadLocationMemory() : {};
        var existing = memory[name];
        var data;
        if (existing) {
            data = existing;
        } else {
            var raw = (typeof getPromptLocationDefault === 'function') ? getPromptLocationDefault(name) : '';
            data = (typeof parseLocationText === 'function') ? parseLocationText(raw) : {};
        }
        _locState = _locBuildStateFromData(name, data);

        var existingModal = document.getElementById('prompt-editor-modal');
        if (existingModal) existingModal.remove();

        var innerHtml =
            '<h3 class="cfg-title">地点信息 - ' + _escapeHtml(name) + (existing ? ' <span style="font-size:13px;color:#4CAF50">（已被AI更新过）</span>' : '') + '</h3>' +
            '<p class="cfg-hint">修改后点击“保存”生效，直接写入该地点在当前存档的 locationMemory。点击“恢复默认”会删除该地点的 locationMemory 记录，下次改由 AI 更新或编译期默认正文生效。</p>' +
            '<div id="loc-editor-body" style="max-height:55vh;overflow-y:auto;padding-right:4px;">' + _locRenderFormHtml() + '</div>' +
            '<div class="modal-buttons" style="margin-top:12px">' +
                '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._locResetDefault()">恢复默认</button>' +
                '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._close()">取消</button>' +
                '<button class="cfg-btn cfg-btn-green" onclick="promptManagerModal._locSave()">保存</button>' +
            '</div>';

        var html;
        if (typeof fitModalToViewport === 'function') {
            html = '<div id="prompt-editor-modal" class="modal viewport-overlay" style="z-index:5000">' +
                '<div class="modal-content" style="display:flex;justify-content:flex-start;align-items:center;background:transparent;border:none;box-shadow:none;padding:3% 16px;box-sizing:border-box;overflow-y:auto">' +
                '<div class="cfg-panel" style="max-width:720px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div></div>';
        } else {
            html = '<div id="prompt-editor-modal" class="cfg-overlay" style="z-index:5000">' +
                '<div class="cfg-panel" style="max-width:720px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div>';
        }

        document.body.insertAdjacentHTML('beforeend', html);
        var modal = document.getElementById('prompt-editor-modal');
        if (typeof fitModalToViewport === 'function') {
            modal.style.display = 'block';
            requestAnimationFrame(function() {
                fitModalToViewport(modal);
                if (typeof bindModalAutoFit === 'function') bindModalAutoFit(modal);
            });
        } else {
            modal.style.display = 'flex';
        }
    }

    function _locSave() {
        _locSyncFromDom();
        var st = _locState;
        if (!st || !st.name || typeof storageService === 'undefined') { _close(); return; }

        var memory = storageService.loadLocationMemory();
        var oldEntry = memory[st.name];
        var oldVersion = (oldEntry && oldEntry.version) || 0;

        var scenesObj = {};
        st.scenes.forEach(function(scene) {
            var sceneName = (scene.name || '').trim();
            if (!sceneName) return;
            var entry = {};
            if (scene.intro && scene.intro.trim()) entry['介绍'] = scene.intro.trim();
            scene.labels.forEach(function(lb) {
                var labelName = (lb.label || '').trim();
                if (!labelName) return;
                var items = (lb.value || '').split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
                if (items.length > 0) entry[labelName] = items;
            });
            if (scene.note && scene.note.trim()) entry['备注'] = scene.note.trim();
            scenesObj[sceneName] = entry;
        });

        var adviceArr = (st.advice || '').split('\n').map(function(s) { return s.trim(); }).filter(Boolean);

        memory[st.name] = {
            危险度: st.dangerLevel ? { 评级: st.dangerLevel, 说明: st.dangerDesc || '' } : null,
            友善度: st.friendlyLevel ? { 评级: st.friendlyLevel, 说明: st.friendlyDesc || '' } : null,
            行动建议: adviceArr,
            子场景: scenesObj,
            version: oldVersion + 1,
            lastUpdatedWeek: (typeof currentWeek !== 'undefined') ? currentWeek : 0,
            lastUpdatedAt: Date.now()
        };
        storageService.saveLocationMemory(memory);
        _close();
        _refreshRoot();
        if (typeof showModal === 'function') showModal('已保存地点信息');
    }

    function _locResetDefault() {
        if (typeof storageService === 'undefined' || !_locState || !_locState.name) { _close(); return; }
        var locationName = _locState.name;
        _confirm('恢复默认地点信息', '确定要恢复「' + locationName + '」的默认地点信息吗？当前自定义内容将被移除。', function() {
            var memory = storageService.loadLocationMemory();
            delete memory[locationName];
            storageService.saveLocationMemory(memory);
            _close();
            _refreshRoot();
        });
    }

    // ========== 自定义世界书 ==========

    var _pendingConfirmYes = null;

    /**
     * 一个世界书分类的完整块：插入按钮 + 条目列表，合并为同一个 pm-section（前后各一条粗分割线）
     * @param {string} slot - '1' 或 '2'
     */
    function _pmWorldbookCategory(slot) {
        var list = (typeof customWorldbook !== 'undefined') ? customWorldbook.getAll(slot) : [];

        var insertRow = '<div style="text-align:center;padding:12px 0 4px;">' +
            '<button class="cfg-btn cfg-btn-blue" onclick="promptManagerModal._openWorldbookEditor(\'' + slot + '\')">➕ 插入世界书</button>' +
            '</div>';

        var rows = '';
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            var offBadge = (e.enabled === false) ? ' <span style="font-size:12px;color:#999">（已关闭）</span>' : '';
            var upDisabled = (i === 0) ? ' disabled style="opacity:0.3;cursor:not-allowed"' : ' style="cursor:pointer"';
            var downDisabled = (i === list.length - 1) ? ' disabled style="opacity:0.3;cursor:not-allowed"' : ' style="cursor:pointer"';
            rows += '<div class="pm-wb-row" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 0;border-bottom:1px solid #f0f0f0;">' +
                '<button class="cfg-btn cfg-btn-subtle" style="flex:1 1 120px;min-width:0;text-align:left" onclick="promptManagerModal._openWorldbookEditor(\'' + slot + '\', \'' + _escapeHtml(e.id) + '\')">' +
                _escapeHtml(e.name || '(未命名世界书)') + offBadge +
                '</button>' +
                '<button onclick="promptManagerModal._wbMoveUp(\'' + slot + '\', \'' + _escapeHtml(e.id) + '\')"' + upDisabled + ' title="上移" ' +
                'class="cfg-btn cfg-btn-subtle" style="padding:2px 8px;font-size:12px;line-height:1;">▲</button>' +
                '<button onclick="promptManagerModal._wbMoveDown(\'' + slot + '\', \'' + _escapeHtml(e.id) + '\')"' + downDisabled + ' title="下移" ' +
                'class="cfg-btn cfg-btn-subtle" style="padding:2px 8px;font-size:12px;line-height:1;">▼</button>' +
                '<button onclick="promptManagerModal._confirmDeleteWorldbook(\'' + slot + '\', \'' + _escapeHtml(e.id) + '\')" ' +
                'style="background:none;border:none;color:#c0392b;font-size:18px;line-height:1;cursor:pointer;padding:2px 8px;" title="删除世界书">×</button>' +
                '</div>';
        }
        return '<div class="pm-section">' + insertRow + rows + '</div><div style="height:3px;background:#000;margin:14px 0;border:none;"></div>';
    }

    function _wbMoveUp(slot, id) {
        if (typeof customWorldbook === 'undefined') return;
        var list = customWorldbook.getAll(slot);
        var ids = list.map(function(x) { return x.id; });
        var idx = ids.indexOf(id);
        if (idx <= 0) return;
        var tmp = ids[idx - 1];
        ids[idx - 1] = ids[idx];
        ids[idx] = tmp;
        customWorldbook.reorder(slot, ids);
        _refreshRoot();
    }

    function _wbMoveDown(slot, id) {
        if (typeof customWorldbook === 'undefined') return;
        var list = customWorldbook.getAll(slot);
        var ids = list.map(function(x) { return x.id; });
        var idx = ids.indexOf(id);
        if (idx === -1 || idx >= ids.length - 1) return;
        var tmp = ids[idx + 1];
        ids[idx + 1] = ids[idx];
        ids[idx] = tmp;
        customWorldbook.reorder(slot, ids);
        _refreshRoot();
    }

    function _onWbToggle(chk) {
        var hint = chk.parentElement.querySelector('.gs-toggle-hint');
        if (hint) hint.textContent = chk.checked ? '开' : '关';
    }

    function _openWorldbookEditor(slot, id) {
        var existing = document.getElementById('wb-editor-modal');
        if (existing) existing.remove();

        var entry = null;
        if (id && typeof customWorldbook !== 'undefined') {
            var list = customWorldbook.getAll(slot);
            for (var i = 0; i < list.length; i++) { if (list[i].id === id) { entry = list[i]; break; } }
        }
        var isNew = !entry;
        var name = entry ? entry.name : '';
        var keywords = entry ? entry.keywords : '';
        var content = entry ? entry.content : '';
        var enabled = entry ? entry.enabled !== false : true;

        var innerHtml =
            '<h3 class="cfg-title">' + (isNew ? '插入世界书' : '编辑世界书') + '</h3>' +
            '<div class="cfg-field"><label class="cfg-label">世界书名称</label>' +
            '<input id="wb-name-input" type="text" class="cfg-input" value="' + _escapeHtml(name) + '" placeholder="如：西域地理设定"></div>' +
            '<div class="cfg-field"><label class="cfg-label">关键词</label>' +
            '<input id="wb-keywords-input" type="text" class="cfg-input" value="' + _escapeHtml(keywords) + '" placeholder="多个关键词用逗号或换行分隔，留空则不看关键词，只按开关插入"></div>' +
            '<div class="cfg-field"><label class="cfg-label">世界书内容</label>' +
            '<textarea id="wb-content-textarea" class="cfg-input" style="width:100%;height:32vh;min-height:180px;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;box-sizing:border-box;resize:vertical">' + _escapeHtml(content) + '</textarea></div>' +
            '<div class="gs-switch-row" style="border-bottom:none">' +
            '<span class="gs-switch-label">启用世界书</span>' +
            '<label class="gs-toggle-wrap">' +
            '<input type="checkbox" id="wb-enabled-toggle" onchange="promptManagerModal._onWbToggle(this)"' + (enabled ? ' checked' : '') + '>' +
            '<span class="gs-toggle-track"><span class="gs-toggle-thumb"></span></span>' +
            '<span class="gs-toggle-hint">' + (enabled ? '开' : '关') + '</span>' +
            '</label></div>' +
            '<div class="modal-buttons" style="margin-top:12px">' +
            '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._closeWorldbookEditor()">取消</button>' +
            '<button class="cfg-btn cfg-btn-green" onclick="promptManagerModal._saveWorldbookEntry(\'' + slot + '\', \'' + (isNew ? '' : _escapeHtml(id)) + '\')">' +
            (isNew ? '创建世界书' : '更新世界书') + '</button>' +
            '</div>';

        var html;
        if (typeof fitModalToViewport === 'function') {
            html = '<div id="wb-editor-modal" class="modal viewport-overlay" style="z-index:5100">' +
                '<div class="modal-content" style="display:flex;justify-content:flex-start;align-items:center;background:transparent;border:none;box-shadow:none;padding:3% 16px;box-sizing:border-box;overflow-y:auto">' +
                '<div class="cfg-panel" style="max-width:640px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div></div>';
        } else {
            html = '<div id="wb-editor-modal" class="cfg-overlay" style="z-index:5100">' +
                '<div class="cfg-panel" style="max-width:640px;width:100%;box-sizing:border-box">' + innerHtml + '</div>' +
                '</div>';
        }

        document.body.insertAdjacentHTML('beforeend', html);
        var modal = document.getElementById('wb-editor-modal');
        if (typeof fitModalToViewport === 'function') {
            modal.style.display = 'block';
            requestAnimationFrame(function() {
                fitModalToViewport(modal);
                if (typeof bindModalAutoFit === 'function') bindModalAutoFit(modal);
            });
        } else {
            modal.style.display = 'flex';
        }
    }

    function _closeWorldbookEditor() {
        var modal = document.getElementById('wb-editor-modal');
        if (modal) modal.remove();
    }

    function _saveWorldbookEntry(slot, id) {
        var nameEl = document.getElementById('wb-name-input');
        var keywordsEl = document.getElementById('wb-keywords-input');
        var contentEl = document.getElementById('wb-content-textarea');
        var enabledEl = document.getElementById('wb-enabled-toggle');
        if (!nameEl || !contentEl || typeof customWorldbook === 'undefined') { _closeWorldbookEditor(); return; }

        customWorldbook.upsert(slot, {
            id: id || null,
            name: nameEl.value.trim(),
            keywords: keywordsEl ? keywordsEl.value.trim() : '',
            content: contentEl.value,
            enabled: !!(enabledEl && enabledEl.checked)
        });
        _closeWorldbookEditor();
        _refreshRoot();
        if (typeof showModal === 'function') showModal(id ? '世界书已更新' : '世界书已创建');
    }

    function _confirmDeleteWorldbook(slot, id) {
        var name = id;
        if (typeof customWorldbook !== 'undefined') {
            var list = customWorldbook.getAll(slot);
            for (var i = 0; i < list.length; i++) { if (list[i].id === id) { name = list[i].name || '(未命名世界书)'; break; } }
        }
        _confirm('删除世界书', '确定删除世界书「' + name + '」吗？此操作不可撤销。', function() {
            if (typeof customWorldbook !== 'undefined') customWorldbook.remove(slot, id);
            _refreshRoot();
        });
    }

    function _confirm(title, message, onYes) {
        var existing = document.getElementById('pm-confirm-modal');
        if (existing) existing.remove();
        _pendingConfirmYes = onYes;
        // 复用 cfg-panel/cfg-title/cfg-footer，让古风主题自动应用水墨纸张、墨线边框和印章按钮。
        var html = '<div id="pm-confirm-modal" class="modal viewport-overlay" style="display:flex;align-items:center;justify-content:center;position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;z-index:6000">' +
            '<div class="modal-content" style="position:relative;left:auto;top:auto;transform:none;display:flex;align-items:center;justify-content:center;width:100%;height:100%;max-width:none;max-height:none;margin:0;background:transparent;border:none;box-shadow:none;padding:8px;box-sizing:border-box;overflow:hidden">' +
            '<div class="cfg-panel" style="max-width:440px;width:100%;max-height:calc(100dvh - 16px);display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box">' +
            '<h3 class="cfg-title">' + _escapeHtml(title || '请确认') + '</h3>' +
            '<div class="cfg-scroll-body"><p class="cfg-hint" style="font-size:14px;line-height:1.8;margin:14px 0 18px">' + _escapeHtml(message) + '</p></div>' +
            '<div class="cfg-footer">' +
            '<button class="cfg-btn cfg-btn-subtle" onclick="promptManagerModal._confirmCancel()">取消</button>' +
            '<button class="cfg-btn cfg-btn-green" onclick="promptManagerModal._confirmYes()">确定</button>' +
            '</div></div></div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
    }

    function _confirmCancel() {
        var modal = document.getElementById('pm-confirm-modal');
        if (modal) modal.remove();
        _pendingConfirmYes = null;
    }

    function _confirmYes() {
        var modal = document.getElementById('pm-confirm-modal');
        if (modal) modal.remove();
        if (typeof _pendingConfirmYes === 'function') {
            var fn = _pendingConfirmYes;
            _pendingConfirmYes = null;
            fn();
        }
    }

    return {
        render: render,
        open: open,
        _openLocation: _openLocation,
        _locAddScene: _locAddScene,
        _locRemoveScene: _locRemoveScene,
        _locAddLabel: _locAddLabel,
        _locRemoveLabel: _locRemoveLabel,
        _locOpenLabelEditor: _locOpenLabelEditor,
        _locCloseLabelEditor: _locCloseLabelEditor,
        _locSaveLabelEditor: _locSaveLabelEditor,
        _locSave: _locSave,
        _locResetDefault: _locResetDefault,
        _openNpc: _openNpc,
        _openAction: _openAction,
        _openThink: _openThink,
        _toggleThinking: _toggleThinking,
        _save: _save,
        _resetDefault: _resetDefault,
        _close: _close,
        _togglePreset: _togglePreset,
        _switchPreset: _switchPreset,
        _openPresetNameEditor: _openPresetNameEditor,
        _closePresetNameEditor: _closePresetNameEditor,
        _savePresetNames: _savePresetNames,
        captureWorkspaceConfig: _snapshotCustom,
        applyWorkspaceConfig: _restoreCustom,
        emptyWorkspaceConfig: _emptyPresetSnapshot,
        refresh: _refreshRoot,
        _wbMoveUp: _wbMoveUp,
        _wbMoveDown: _wbMoveDown,
        _onWbToggle: _onWbToggle,
        _openWorldbookEditor: _openWorldbookEditor,
        _closeWorldbookEditor: _closeWorldbookEditor,
        _saveWorldbookEntry: _saveWorldbookEntry,
        _confirmDeleteWorldbook: _confirmDeleteWorldbook,
        _confirmCancel: _confirmCancel,
        _confirmYes: _confirmYes
    };
})();
