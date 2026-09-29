/**
 * workspace-manager.js - 四存档位完整游戏工作区
 *
 * 每个 Workspace 独立保存：游戏状态、对话、L0/L2 记忆及向量、地点记忆、
 * 周总结、提示词覆盖和两类自定义世界书。切换时先落盘当前 head，再恢复目标 head。
 */
var workspaceManager = (function() {
    'use strict';

    var IDS = ['custom1', 'custom2', 'custom3', 'custom4'];
    var _switching = false;
    var _pendingImportWorkspace = null;
    var _pendingImportSourceWorkspace = null;

    function _esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _active() {
        return storageService.getActiveWorkspaceId();
    }

    function _defaultName(id) {
        return '存档位 ' + (IDS.indexOf(id) + 1);
    }

    function _legacyNames() {
        try { return JSON.parse(localStorage.getItem('jxz_presetSlotNames') || '{}') || {}; }
        catch (e) { return {}; }
    }

    function _hasLegacyConfig(id) {
        return !!localStorage.getItem('jxz_presetSlot_' + id)
            || (id === 'custom1' && !!localStorage.getItem('jxz_presetBackup'));
    }

    function _legacyConfig(id) {
        var value = null;
        try { value = JSON.parse(localStorage.getItem('jxz_presetSlot_' + id) || 'null'); }
        catch (e) { value = null; }
        if (!value && id === 'custom1') {
            try { value = JSON.parse(localStorage.getItem('jxz_presetBackup') || 'null'); }
            catch (e2) { value = null; }
        }
        return {
            overrides: value && value.overrides && typeof value.overrides === 'object' ? value.overrides : {},
            wb1: value && Array.isArray(value.wb1) ? value.wb1 : [],
            wb2: value && Array.isArray(value.wb2) ? value.wb2 : []
        };
    }

    function _captureConfig() {
        if (typeof promptManagerModal !== 'undefined' && promptManagerModal.captureWorkspaceConfig) {
            return promptManagerModal.captureWorkspaceConfig();
        }
        return { overrides: {}, wb1: [], wb2: [] };
    }

    function _applyConfig(config) {
        if (typeof promptManagerModal !== 'undefined' && promptManagerModal.applyWorkspaceConfig) {
            promptManagerModal.applyWorkspaceConfig(config || { overrides: {}, wb1: [], wb2: [] });
        }
    }

    async function _ensureMetas() {
        var oldMode = localStorage.getItem('jxz_presetMode');
        var initial = IDS.indexOf(oldMode) !== -1 ? oldMode : storageService.getActiveWorkspaceId();
        storageService.setActiveWorkspaceId(initial);
        storageService.assignLegacySavesToWorkspace(initial);

        var existing = storageService.listWorkspaceMetas();
        var hasPersistedMeta = existing.some(function(m) { return !!storageService.loadWorkspaceMeta(m.id); });
        var names = _legacyNames();
        for (var i = 0; i < IDS.length; i++) {
            var id = IDS[i];
            var current = storageService.loadWorkspaceMeta(id);
            if (current) continue;
            var config = _hasLegacyConfig(id)
                ? _legacyConfig(id)
                : ((!hasPersistedMeta && id === initial) ? _captureConfig() : _legacyConfig(id));
            var legacyName = names[id] && String(names[id]).trim();
            if (legacyName === '本地槽位 ' + (i + 1)) legacyName = '';
            await storageService.saveWorkspaceMeta(id, {
                id: id,
                name: legacyName || _defaultName(id),
                initialized: false,
                config: config,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }
        return initial;
    }

    async function onGameReady(launchIntent) {
        if (typeof storageService === 'undefined' || !storageService.saveWorkspaceMeta) return;
        var pendingNew = localStorage.getItem('jxz_workspacePendingNew');
        var restoredPendingSource = false;
        if (launchIntent === 'newGame' || launchIntent === 'loadSave') {
            try {
                localStorage.removeItem('jxz_workspacePendingNew');
                localStorage.removeItem('jxz_workspacePendingSource');
            } catch (e) {}
        } else if (pendingNew) {
            // 用户从开局页返回而未创建游戏：恢复离开前的工作区，避免空槽绑定旧运行态。
            var source = storageService.normalizeWorkspaceId(localStorage.getItem('jxz_workspacePendingSource') || 'custom1');
            storageService.setActiveWorkspaceId(source);
            restoredPendingSource = true;
            try {
                localStorage.removeItem('jxz_workspacePendingNew');
                localStorage.removeItem('jxz_workspacePendingSource');
            } catch (e2) {}
        }
        var active = await _ensureMetas();
        var meta = storageService.loadWorkspaceMeta(active);
        if (meta && meta.config) {
            if (!launchIntent && meta.initialized && !restoredPendingSource) {
                // 普通刷新时当前全局配置就是该活动工作区的最新值，先回写 meta，避免覆盖刚编辑的提示词/世界书。
                meta.config = _captureConfig();
                meta.updatedAt = Date.now();
                await storageService.saveWorkspaceMeta(active, meta);
            } else {
                _applyConfig(meta.config);
            }
        }

        var hasRuntime = !!storageService.loadAppState();
        if (hasRuntime && (!meta.initialized || launchIntent === 'newGame' || launchIntent === 'loadSave')) {
            await saveCurrentHead({ quiet: true, force: true });
        }
        render(document.getElementById('workspace-manager-root'));
    }

    function _cancelBackgroundWork() {
        if (typeof summaryRunner !== 'undefined' && summaryRunner.isRunning && summaryRunner.isRunning()) summaryRunner.cancel();
        if (typeof eventRunner !== 'undefined' && eventRunner.cancel) eventRunner.cancel();
        if (typeof locationRunner !== 'undefined' && locationRunner.cancel) locationRunner.cancel();
    }

    async function saveCurrentHead(options) {
        options = options || {};
        if (typeof gameData === 'undefined' || !gameData) return null;
        var id = _active();
        var meta = storageService.loadWorkspaceMeta(id) || { id: id, name: _defaultName(id) };
        if (typeof syncGameDataFromVariables === 'function') syncGameDataFromVariables();
        gameData._activeEvent = (typeof currentRandomEvent !== 'undefined' && currentRandomEvent)
            || (typeof currentBattleEvent !== 'undefined' && currentBattleEvent) || null;
        var payload;
        try {
            payload = storageService.buildSavePayload('[工作区] ' + (meta.name || _defaultName(id)), true);
        } finally {
            delete gameData._activeEvent;
        }
        payload.workspaceId = id;
        await storageService.saveWorkspaceHead(id, payload);
        meta.initialized = true;
        meta.config = _captureConfig();
        meta.previewWeek = gameData.currentWeek || 1;
        meta.previewLocation = Number(gameData.GameMode) === 1
            ? (gameData.mapLocation || '')
            : (gameData.userLocation || gameData.mapLocation || '');
        meta.updatedAt = Date.now();
        await storageService.saveWorkspaceMeta(id, meta);
        if (!options.quiet) render(document.getElementById('workspace-manager-root'));
        return payload;
    }

    async function _activate(id, saveId) {
        id = storageService.normalizeWorkspaceId(id);
        var meta = storageService.loadWorkspaceMeta(id);
        if (!meta || !meta.initialized) return false;
        storageService.setActiveWorkspaceId(id);
        _applyConfig(meta.config);
        var head = saveId ? storageService.loadSave(saveId) : storageService.loadWorkspaceHead(id);
        if (!head) throw new Error('该存档位缺少工作区快照');
        var key = head.id;
        if (!key || !storageService.loadSave(key)) {
            // 传入的是普通存档 payload 时已经存在于缓存；工作区 head 同样以固定 id 存放。
            throw new Error('工作区快照不可读取');
        }
        if (typeof loadSaveSlot !== 'function') throw new Error('读档函数尚未就绪');
        loadSaveSlot(key, { silent: true, workspaceSwitch: true, skipWorkspaceHead: true });
        if (saveId) await saveCurrentHead({ quiet: true, force: true });
        render(document.getElementById('workspace-manager-root'));
        if (typeof promptManagerModal !== 'undefined' && promptManagerModal.refresh) promptManagerModal.refresh();
        return true;
    }

    async function select(id) {
        id = storageService.normalizeWorkspaceId(id);
        if (_switching || id === _active()) return;
        if (typeof pipeline !== 'undefined' && pipeline.isStreaming && pipeline.isStreaming()) {
            if (typeof showModal === 'function') showModal('生成过程中不能切换存档位');
            return;
        }
        var target = storageService.loadWorkspaceMeta(id);
        if (!target || !target.initialized) {
            _showEmptyDialog(id);
            return;
        }
        var sourceId = _active();
        _switching = true;
        var busy = typeof GameSceneBridge !== 'undefined' && GameSceneBridge;
        if (busy) busy.setBusy('workspace-switch', true);
        try {
            _cancelBackgroundWork();
            await saveCurrentHead({ quiet: true });
            await _activate(id);
            if (typeof showModal === 'function') showModal('已切换到「' + _esc(target.name || _defaultName(id)) + '」');
        } catch (e) {
            console.error('[Workspace] 切换失败:', e);
            try {
                storageService.setActiveWorkspaceId(sourceId);
                var sourceMeta = storageService.loadWorkspaceMeta(sourceId);
                if (sourceMeta) _applyConfig(sourceMeta.config);
                var sourceHead = storageService.loadWorkspaceHead(sourceId);
                if (sourceHead && typeof loadSaveSlot === 'function') {
                    loadSaveSlot(sourceHead.id, { silent: true, workspaceSwitch: true, skipWorkspaceHead: true });
                }
            } catch (rollbackError) {
                console.error('[Workspace] 切换回滚失败:', rollbackError);
            }
            if (typeof showModal === 'function') showModal('存档位切换失败：' + (e && e.message || e));
        } finally {
            if (busy) busy.setBusy('workspace-switch', false);
            _switching = false;
        }
    }

    function _showEmptyDialog(id) {
        var old = document.getElementById('workspace-empty-modal');
        if (old) old.remove();
        var meta = storageService.loadWorkspaceMeta(id) || { name: _defaultName(id) };
        var html = '<div id="workspace-empty-modal" class="modal viewport-overlay" data-self-managed-viewport="true" style="display:flex!important;position:fixed!important;inset:0!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;max-width:none!important;max-height:none!important;margin:0!important;transform:none!important;box-sizing:border-box!important;padding:max(10px,env(safe-area-inset-top,0px)) max(10px,env(safe-area-inset-right,0px)) max(10px,env(safe-area-inset-bottom,0px)) max(10px,env(safe-area-inset-left,0px))!important;overflow:hidden!important;z-index:100002!important;align-items:center;justify-content:center">' +
            '<style>@media (orientation:landscape) and (max-height:300px){#workspace-empty-modal .workspace-empty-content{border-width:8px!important;border-image-width:10px!important;padding:6px!important}#workspace-empty-modal .workspace-empty-content h3{font-size:16px!important;margin-bottom:3px!important}#workspace-empty-modal .workspace-empty-content p{margin:3px 0!important;line-height:1.35!important}#workspace-empty-modal .workspace-empty-actions{padding-top:3px!important;gap:4px!important}#workspace-empty-modal .workspace-empty-actions .modal-btn{min-height:34px!important;padding:3px 8px!important}}</style>' +
            '<div class="modal-content workspace-empty-content" style="position:relative!important;inset:auto!important;left:auto!important;top:auto!important;transform:none!important;width:min(92vw,430px)!important;max-width:430px!important;height:auto!important;min-height:0!important;max-height:calc(100vh - 20px)!important;max-height:calc(100dvh - 20px)!important;margin:0!important;box-sizing:border-box!important;overflow-y:auto!important;overscroll-behavior:contain"><h3>' + _esc(meta.name || _defaultName(id)) + '</h3>' +
            '<p style="line-height:1.7">这是一个空存档位。请选择创建新游戏，或直接导入已有存档。</p>' +
            '<div class="modal-buttons workspace-empty-actions" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px">' +
            '<button class="modal-btn" onclick="workspaceManager.startNew(\'' + id + '\')">新开游戏</button>' +
            '<button class="modal-btn" onclick="workspaceManager.importInto(\'' + id + '\')">导入存档</button>' +
            '<button class="modal-btn cancel" style="grid-column:1/-1" onclick="workspaceManager.closeEmptyDialog()">取消</button>' +
            '</div></div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
    }

    function closeEmptyDialog() {
        var el = document.getElementById('workspace-empty-modal');
        if (el) el.remove();
    }

    function _startScreenUrl() {
        return /(?:^|\/)game\.html$/i.test(location.pathname) ? 'index.html' : 'start-screen-noST.html';
    }

    async function startNew(id) {
        if (_switching) return;
        _switching = true;
        try {
            _cancelBackgroundWork();
            await saveCurrentHead({ quiet: true });
            localStorage.setItem('jxz_workspacePendingSource', _active());
            storageService.setActiveWorkspaceId(id);
            var meta = storageService.loadWorkspaceMeta(id) || { id: id, name: _defaultName(id), config: _legacyConfig(id) };
            _applyConfig(meta.config);
            localStorage.setItem('jxz_workspacePendingNew', id);
            closeEmptyDialog();
            location.href = _startScreenUrl();
        } catch (e) {
            _switching = false;
            if (typeof showModal === 'function') showModal('创建存档位失败：' + (e && e.message || e));
        }
    }

    async function importInto(id) {
        if (_switching) return;
        _switching = true;
        try {
            _cancelBackgroundWork();
            await saveCurrentHead({ quiet: true });
            _pendingImportSourceWorkspace = _active();
            _pendingImportWorkspace = id;
            closeEmptyDialog();
            if (typeof closeGameSettings === 'function') closeGameSettings();
            _switching = false;
            if (typeof importSave === 'function') importSave();
        } catch (e) {
            _switching = false;
            if (typeof showModal === 'function') showModal('导入准备失败：' + (e && e.message || e));
        }
    }

    function preparePendingImport(payload) {
        if (!_pendingImportWorkspace) return _active();
        var id = storageService.setActiveWorkspaceId(_pendingImportWorkspace);
        var meta = storageService.loadWorkspaceMeta(id) || { id: id, name: _defaultName(id), config: _legacyConfig(id) };
        if (payload && payload.workspaceConfig) meta.config = payload.workspaceConfig;
        _applyConfig(meta.config);
        return id;
    }

    function cancelPendingImport() {
        var sourceId = _pendingImportSourceWorkspace;
        _pendingImportWorkspace = null;
        _pendingImportSourceWorkspace = null;
        if (sourceId && _active() !== sourceId) {
            storageService.setActiveWorkspaceId(sourceId);
            var meta = storageService.loadWorkspaceMeta(sourceId);
            if (meta) _applyConfig(meta.config);
            var head = storageService.loadWorkspaceHead(sourceId);
            if (head && typeof loadSaveSlot === 'function') {
                loadSaveSlot(head.id, { silent: true, workspaceSwitch: true, skipWorkspaceHead: true });
            }
        }
    }

    async function afterPayloadApplied() {
        var id = _pendingImportWorkspace || _active();
        storageService.setActiveWorkspaceId(id);
        _pendingImportWorkspace = null;
        _pendingImportSourceWorkspace = null;
        await saveCurrentHead({ quiet: true, force: true });
        render(document.getElementById('workspace-manager-root'));
    }

    async function loadOwnedSave(workspaceId, saveId) {
        workspaceId = storageService.normalizeWorkspaceId(workspaceId);
        _switching = true;
        try {
            _cancelBackgroundWork();
            if (_active() !== workspaceId) await saveCurrentHead({ quiet: true });
            var meta = storageService.loadWorkspaceMeta(workspaceId);
            storageService.setActiveWorkspaceId(workspaceId);
            _applyConfig(meta && meta.config);
            loadSaveSlot(saveId, { silent: true, workspaceSwitch: true, skipWorkspaceHead: true });
            await saveCurrentHead({ quiet: true, force: true });
            if (typeof showModal === 'function') showModal('已加载「' + _esc(meta && meta.name || _defaultName(workspaceId)) + '」的存档');
        } finally {
            _switching = false;
        }
    }

    async function selectFromSaveModal(id) {
        if (typeof closeLoadModal === 'function') closeLoadModal();
        await select(id);
        if (_active() === storageService.normalizeWorkspaceId(id) && typeof showLoadModal === 'function') showLoadModal();
    }

    function getSlots() {
        return storageService.listWorkspaceMetas().map(function(meta) {
            var saves = storageService.listSaves(meta.id);
            var autos = saves.filter(function(s) { return s.saveName && s.saveName.indexOf('[自动]') === 0; });
            return {
                id: meta.id,
                name: meta.name || _defaultName(meta.id),
                initialized: !!meta.initialized,
                current: meta.id === _active(),
                updatedAt: meta.updatedAt || 0,
                previewWeek: meta.previewWeek,
                previewLocation: meta.previewLocation,
                autoCount: autos.length
            };
        });
    }

    function render(root) {
        if (!root) return;
        var cards = getSlots().map(function(slot) {
            var status = slot.initialized
                ? ('第' + (slot.previewWeek || '?') + '周 · ' + _esc(slot.previewLocation || '未知地点'))
                : '空存档位';
            return '<button class="workspace-slot-card' + (slot.current ? ' active' : '') + '" onclick="workspaceManager.select(\'' + slot.id + '\')"' + (slot.current ? ' disabled' : '') + '>' +
                '<span class="workspace-slot-name">' + _esc(slot.name) + '</span>' +
                '<span class="workspace-slot-status">' + status + '</span>' +
                '<span class="workspace-slot-meta">自动存档 ' + slot.autoCount + '/3' + (slot.current ? ' · 当前' : '') + '</span>' +
                '</button>';
        }).join('');
        root.innerHTML = '<style>' +
            '.workspace-slot-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}' +
            '.workspace-slot-card{min-width:0;min-height:112px;padding:12px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:7px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:rgba(255,255,255,.04);color:inherit;text-align:left;cursor:pointer}' +
            '.workspace-slot-card.active{border-color:#c8a96e;box-shadow:0 0 0 2px rgba(200,169,110,.22);background:rgba(200,169,110,.12)}' +
            '.workspace-slot-name{font-size:15px;font-weight:bold}.workspace-slot-status{font-size:12px;opacity:.78}.workspace-slot-meta{font-size:11px;opacity:.58}' +
            '</style><p class="cfg-hint">每个存档位拥有独立的游戏进度、对话、L0/L2记忆与向量、地点记忆、提示词和世界书。切换时会自动保存当前状态。</p>' +
            '<div class="workspace-slot-grid">' + cards + '</div>';
    }

    return {
        onGameReady: onGameReady,
        saveCurrentHead: saveCurrentHead,
        select: select,
        startNew: startNew,
        importInto: importInto,
        closeEmptyDialog: closeEmptyDialog,
        preparePendingImport: preparePendingImport,
        cancelPendingImport: cancelPendingImport,
        afterPayloadApplied: afterPayloadApplied,
        loadOwnedSave: loadOwnedSave,
        selectFromSaveModal: selectFromSaveModal,
        getActiveId: _active,
        getSlots: getSlots,
        render: render
    };
})();
