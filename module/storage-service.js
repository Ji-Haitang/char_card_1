/**
 * storage-service.js - 存储服务（Write-Through Cache + IndexedDB 后端）
 * 
 * Phase 2.2：内存缓存 + IndexedDB 持久化，对外同步 API 不变。
 * 启动时需 await storageService.init() 加载缓存。
 * IDB 不可用时自动降级到纯 localStorage。
 * 
 * 依赖：idb-storage.js
 */

var storageService = (function() {
    // --- Key 定义 ---
    var KEY_APP_STATE = 'appState';
    var KEY_UI_CONV = 'uiConversation';
    var KEY_SNAPSHOT = 'snapshot';
    var KEY_SUMMARY_HISTORY = 'summaryHistory';
    var KEY_LAST_TURN_COMMITTED = 'lastTurnCommitted';
    var KEY_SAVE_INDEX = 'saveIndex';

    // localStorage key（兼容旧格式）
    var LS_APP_STATE = 'jxz_appState';
    var LS_UI_CONV = 'jxz_uiConversation';
    var LS_SNAPSHOT = 'jxz_snapshot';
    var LS_SUMMARY_HISTORY = 'jxz_summaryHistory';
    var LS_LAST_TURN_COMMITTED = 'jxz_lastTurnCommitted';
    var LS_SAVES = 'jxz_saves';

    // --- 内部状态 ---
    var _cache = {};
    var _idbAvailable = false;
    var _initialized = false;

    // --- 辅助函数 ---
    function _logErr(context, err) {
        console.warn('[Storage][IDB] ' + context + ' 异步写入失败:', err && err.message || err);
    }

    function _idbPut(key, value) {
        if (!_idbAvailable) return;
        idbStorage.put(key, value).catch(function(e) { _logErr('put ' + key, e); });
    }

    function _idbRemove(key) {
        if (!_idbAvailable) return;
        idbStorage.remove(key).catch(function(e) { _logErr('remove ' + key, e); });
    }

    function _lsGet(key) {
        try {
            var raw = localStorage.getItem(key);
            if (!raw || raw === 'undefined' || raw === 'null') return null;
            return JSON.parse(raw);
        } catch (e) { return null; }
    }

    function _lsSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }

    function _lsRemove(key) {
        try { localStorage.removeItem(key); } catch (e) {}
    }

    // --- 初始化 & 迁移 ---

    /**
     * 初始化存储服务（异步，启动时调用一次）
     * 1. 打开 IDB
     * 2. 加载 IDB 数据到缓存
     * 3. 如有必要从 localStorage 迁移
     */
    async function init() {
        if (_initialized) return;
        try {
            await idbStorage.open();
            _idbAvailable = true;
            console.log('[Storage] IndexedDB 可用');

            // 从 IDB 加载全部数据到缓存
            var allData = await idbStorage.getAll();
            var idbKeyCount = Object.keys(allData).length;

            if (idbKeyCount > 0) {
                _cache = allData;
                console.log('[Storage] 从 IndexedDB 加载 ' + idbKeyCount + ' 个 key');
            } else {
                // IDB 为空，尝试从 localStorage 迁移
                await _migrateFromLocalStorage();
            }
        } catch (e) {
            _idbAvailable = false;
            console.warn('[Storage] IndexedDB 不可用，降级到 localStorage:', e.message || e);
            // 降级：从 localStorage 填充缓存
            _loadCacheFromLocalStorage();
        }
        _initialized = true;
    }

    async function _migrateFromLocalStorage() {
        console.log('[Storage] 检测到 IndexedDB 为空，开始从 localStorage 迁移...');
        var migrated = 0;

        // 迁移 appState
        var appState = _lsGet(LS_APP_STATE);
        if (appState) {
            _cache[KEY_APP_STATE] = appState;
            await idbStorage.put(KEY_APP_STATE, appState);
            migrated++;
        }

        // 迁移 uiConversation
        var uiConv = _lsGet(LS_UI_CONV);
        if (uiConv) {
            _cache[KEY_UI_CONV] = uiConv;
            await idbStorage.put(KEY_UI_CONV, uiConv);
            migrated++;
        }

        // 迁移 snapshot
        var snapshot = _lsGet(LS_SNAPSHOT);
        if (snapshot) {
            _cache[KEY_SNAPSHOT] = snapshot;
            await idbStorage.put(KEY_SNAPSHOT, snapshot);
            migrated++;
        }

        // 迁移 summaryHistory
        var summaryHistory = _lsGet(LS_SUMMARY_HISTORY);
        if (summaryHistory) {
            _cache[KEY_SUMMARY_HISTORY] = summaryHistory;
            await idbStorage.put(KEY_SUMMARY_HISTORY, summaryHistory);
            migrated++;
        }

        var lastTurnCommitted = _lsGet(LS_LAST_TURN_COMMITTED);
        if (typeof lastTurnCommitted === 'boolean') {
            _cache[KEY_LAST_TURN_COMMITTED] = lastTurnCommitted;
            await idbStorage.put(KEY_LAST_TURN_COMMITTED, lastTurnCommitted);
            migrated++;
        }

        // 迁移存档列表（拆分为独立 key）
        var saves = _lsGet(LS_SAVES);
        if (saves && Array.isArray(saves) && saves.length > 0) {
            var index = [];
            for (var i = 0; i < saves.length; i++) {
                var s = saves[i];
                var saveKey = 'save_' + (s.id || Date.now() + '_' + i);
                _cache[saveKey] = s;
                await idbStorage.put(saveKey, s);
                index.push({
                    id: s.id || saveKey,
                    saveName: s.saveName,
                    previewWeek: s.previewWeek,
                    previewLocation: s.previewLocation,
                    createdAt: s.createdAt
                });
            }
            _cache[KEY_SAVE_INDEX] = index;
            await idbStorage.put(KEY_SAVE_INDEX, index);
            migrated += saves.length + 1;
        }

        if (migrated > 0) {
            console.log('[Storage] 迁移完成，共 ' + migrated + ' 个 key 写入 IndexedDB');
        } else {
            console.log('[Storage] localStorage 无数据需要迁移');
        }
    }

    function _loadCacheFromLocalStorage() {
        var appState = _lsGet(LS_APP_STATE);
        if (appState) _cache[KEY_APP_STATE] = appState;

        var uiConv = _lsGet(LS_UI_CONV);
        if (uiConv) _cache[KEY_UI_CONV] = uiConv;

        var snapshot = _lsGet(LS_SNAPSHOT);
        if (snapshot) _cache[KEY_SNAPSHOT] = snapshot;

        var summaryHistory = _lsGet(LS_SUMMARY_HISTORY);
        if (summaryHistory) _cache[KEY_SUMMARY_HISTORY] = summaryHistory;

        var lastTurnCommitted = _lsGet(LS_LAST_TURN_COMMITTED);
        if (typeof lastTurnCommitted === 'boolean') _cache[KEY_LAST_TURN_COMMITTED] = lastTurnCommitted;

        // 旧格式存档 → 转为索引 + 独立 key（仅缓存中）
        var saves = _lsGet(LS_SAVES);
        if (saves && Array.isArray(saves)) {
            var index = [];
            for (var i = 0; i < saves.length; i++) {
                var s = saves[i];
                var saveKey = 'save_' + (s.id || i);
                _cache[saveKey] = s;
                index.push({
                    id: s.id || saveKey,
                    saveName: s.saveName,
                    previewWeek: s.previewWeek,
                    previewLocation: s.previewLocation,
                    createdAt: s.createdAt
                });
            }
            _cache[KEY_SAVE_INDEX] = index;
        }
    }

    // --- AppState ---

    function loadAppState() {
        return _cache[KEY_APP_STATE] || null;
    }

    function saveAppState(state) {
        _cache[KEY_APP_STATE] = state;
        _idbPut(KEY_APP_STATE, state);
        _lsSet(LS_APP_STATE, state);
    }

    // --- UI Conversation ---

    function loadUIConversation() {
        return _cache[KEY_UI_CONV] || [];
    }

    function appendUIConversation(msg) {
        var history = loadUIConversation();
        history.push(msg);
        _cache[KEY_UI_CONV] = history;
        _idbPut(KEY_UI_CONV, history);
        _lsSet(LS_UI_CONV, history);
    }

    /** 替换整个 UI 对话历史 */
    function replaceUIConversation(history) {
        _cache[KEY_UI_CONV] = history;
        _idbPut(KEY_UI_CONV, history);
        _lsSet(LS_UI_CONV, history);
    }

    function clearUIConversation() {
        delete _cache[KEY_UI_CONV];
        _idbRemove(KEY_UI_CONV);
        _lsRemove(LS_UI_CONV);
    }

    function clearSummaryHistory() {
        delete _cache[KEY_SUMMARY_HISTORY];
        _idbRemove(KEY_SUMMARY_HISTORY);
        _lsRemove(LS_SUMMARY_HISTORY);
    }

    function popLastAssistantUI() {
        var history = loadUIConversation();
        for (var i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'assistant') {
                history.splice(i, 1);
                break;
            }
        }
        _cache[KEY_UI_CONV] = history;
        _idbPut(KEY_UI_CONV, history);
        _lsSet(LS_UI_CONV, history);
    }

    // --- Snapshot ---

    function saveSnapshot(gd) {
        _cache[KEY_SNAPSHOT] = gd;
        _idbPut(KEY_SNAPSHOT, gd);
        _lsSet(LS_SNAPSHOT, gd);
    }

    function loadSnapshot() {
        return _cache[KEY_SNAPSHOT] || null;
    }

    function hasSnapshot() {
        return _cache[KEY_SNAPSHOT] != null;
    }

    function clearSnapshot() {
        delete _cache[KEY_SNAPSHOT];
        _idbRemove(KEY_SNAPSHOT);
        _lsRemove(LS_SNAPSHOT);
    }

    function setLastTurnCommitted(committed) {
        var value = !!committed;
        _cache[KEY_LAST_TURN_COMMITTED] = value;
        _idbPut(KEY_LAST_TURN_COMMITTED, value);
        _lsSet(LS_LAST_TURN_COMMITTED, value);
    }

    function didLastTurnCommit() {
        return _cache[KEY_LAST_TURN_COMMITTED] === true;
    }

    // --- Summary History (供 summaryHistoryService 使用) ---

    function loadSummaryHistory() {
        return _cache[KEY_SUMMARY_HISTORY] || [];
    }

    function saveSummaryHistory(history) {
        _cache[KEY_SUMMARY_HISTORY] = history;
        _idbPut(KEY_SUMMARY_HISTORY, history);
        _lsSet(LS_SUMMARY_HISTORY, history);
    }

    // --- 存档系统 ---

    function _getSaveIndex() {
        return _cache[KEY_SAVE_INDEX] || [];
    }

    function _setSaveIndex(index) {
        _cache[KEY_SAVE_INDEX] = index;
        _idbPut(KEY_SAVE_INDEX, index);
        // 同时维护 localStorage 兼容格式（只存索引元数据，不存完整存档）
        _lsSet(LS_SAVES + '_index', index);
    }

    function listSaves() {
        return _getSaveIndex();
    }

    function createSave(saveName) {
        var id = 'save_' + Date.now();
        var payload = {
            id: id,
            saveName: saveName,
            gameData: (typeof gameData !== 'undefined') ? structuredClone(gameData) : null,
            summaryHistory: (typeof summaryHistoryService !== 'undefined') ? structuredClone(summaryHistoryService.getAll()) : [],
            uiConversation: structuredClone(loadUIConversation()),
            snapshot: structuredClone(loadSnapshot()),
            previewWeek: (typeof gameData !== 'undefined' && gameData) ? gameData.currentWeek : null,
            previewLocation: (typeof gameData !== 'undefined' && gameData) ? gameData.mapLocation : null,
            createdAt: Date.now()
        };

        // 写入独立 key
        _cache[id] = payload;
        _idbPut(id, payload);

        // 更新索引
        var index = _getSaveIndex();
        index.push({
            id: id,
            saveName: saveName,
            previewWeek: payload.previewWeek,
            previewLocation: payload.previewLocation,
            createdAt: payload.createdAt
        });
        _setSaveIndex(index);

        // 兼容：同时写 localStorage 完整存档（降级用）
        _syncSavesToLocalStorage();

        console.log('[Storage] 存档创建: ' + id + ' (' + saveName + ')');
        return id;
    }

    function loadSave(saveId) {
        // 优先从缓存读
        if (_cache[saveId]) return _cache[saveId];
        // 降级：从 localStorage 旧格式读
        var saves = _lsGet(LS_SAVES);
        if (saves && Array.isArray(saves)) {
            for (var i = 0; i < saves.length; i++) {
                if (saves[i].id === saveId) return saves[i];
            }
        }
        return null;
    }

    function deleteSave(saveId) {
        delete _cache[saveId];
        _idbRemove(saveId);

        var index = _getSaveIndex().filter(function(s) { return s.id !== saveId; });
        _setSaveIndex(index);

        _syncSavesToLocalStorage();
        console.log('[Storage] 存档删除: ' + saveId);
    }

    /** 导入完整存档 payload（从 JSON 文件导入时使用） */
    function importSavePayload(payload) {
        var id = 'save_' + Date.now();
        payload.id = id;
        if (!payload.createdAt) payload.createdAt = Date.now();

        // 写入独立 key
        _cache[id] = payload;
        _idbPut(id, payload);

        // 更新索引
        var index = _getSaveIndex();
        index.push({
            id: id,
            saveName: payload.saveName || '导入存档',
            previewWeek: payload.gameData && payload.gameData.currentWeek,
            previewLocation: payload.gameData && payload.gameData.mapLocation,
            createdAt: payload.createdAt
        });
        _setSaveIndex(index);
        _syncSavesToLocalStorage();

        console.log('[Storage] 存档导入: ' + id + ' (' + (payload.saveName || '导入存档') + ')');
        return id;
    }

    /** 将存档同步到 localStorage（兼容降级） */
    function _syncSavesToLocalStorage() {
        var index = _getSaveIndex();
        var saves = [];
        for (var i = 0; i < index.length; i++) {
            var payload = _cache[index[i].id];
            if (payload) saves.push(payload);
        }
        _lsSet(LS_SAVES, saves);
    }

    // --- 导入导出 ---

    function buildSavePayload(saveName) {
        return {
            saveName: saveName,
            gameData: (typeof gameData !== 'undefined') ? gameData : null,
            summaryHistory: (typeof summaryHistoryService !== 'undefined') ? summaryHistoryService.getAll() : [],
            uiConversation: loadUIConversation(),
            snapshot: loadSnapshot(),
            createdAt: Date.now()
        };
    }

    function exportSaveToJson(saveName) {
        var payload = buildSavePayload(saveName);
        return JSON.stringify(payload, null, 2);
    }

    function importSaveFromJson(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var payload = JSON.parse(e.target.result);
                    if (!payload.gameData || !payload.saveName) {
                        reject(new Error('存档格式无效'));
                        return;
                    }
                    resolve(payload);
                } catch (err) {
                    reject(new Error('JSON 解析失败'));
                }
            };
            reader.onerror = function() { reject(new Error('文件读取失败')); };
            reader.readAsText(file);
        });
    }

    function downloadJson(filename, jsonString) {
        var blob = new Blob([jsonString], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // --- 公开接口 ---

    return {
        init: init,
        loadAppState: loadAppState,
        saveAppState: saveAppState,
        loadUIConversation: loadUIConversation,
        appendUIConversation: appendUIConversation,
        replaceUIConversation: replaceUIConversation,
        clearUIConversation: clearUIConversation,
        clearSummaryHistory: clearSummaryHistory,
        popLastAssistantUI: popLastAssistantUI,
        saveSnapshot: saveSnapshot,
        loadSnapshot: loadSnapshot,
        hasSnapshot: hasSnapshot,
        clearSnapshot: clearSnapshot,
        setLastTurnCommitted: setLastTurnCommitted,
        didLastTurnCommit: didLastTurnCommit,
        loadSummaryHistory: loadSummaryHistory,
        saveSummaryHistory: saveSummaryHistory,
        buildSavePayload: buildSavePayload,
        exportSaveToJson: exportSaveToJson,
        importSaveFromJson: importSaveFromJson,
        downloadJson: downloadJson,
        listSaves: listSaves,
        createSave: createSave,
        loadSave: loadSave,
        deleteSave: deleteSave,
        importSavePayload: importSavePayload
    };
})();
