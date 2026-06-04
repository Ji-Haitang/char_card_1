/**
 * storage-service.js - 存储服务（Write-Through Cache + IndexedDB 后端）
 *
 * Phase 2.2：内存缓存 + IndexedDB 持久化，对外同步 API 不变。
 * 启动时需 await storageService.init() 加载缓存。
 * IDB 不可用时自动降级到纯 localStorage。
 *
 * 快照（snapshot）独立存储于 jxz_snapshot_db，与主库 jxz_db 平级。
 * 快照在用户每次发送消息前写入，覆盖所有需要回退的字段，用于重生成和错误恢复。
 *
 * 依赖：idb-storage.js, idb-snapshot.js
 */

var storageService = (function() {
    // --- Key 定义（主库 jxz_db）---
    var KEY_APP_STATE = 'appState';
    var KEY_UI_CONV = 'uiConversation';
    var KEY_SUMMARY_HISTORY = 'summaryHistory';
    var KEY_WEEK_HISTORY = 'weekHistory';
    var KEY_SAVE_INDEX = 'saveIndex';
    var KEY_MARK_WEEK_UI_INDEX = 'markWeekUiIndex';
    var KEY_SUMMARY_BUFF = 'summaryBuff';

    // localStorage key（兼容旧格式）
    var LS_APP_STATE = 'jxz_appState';
    var LS_UI_CONV = 'jxz_uiConversation';
    var LS_SUMMARY_HISTORY = 'jxz_summaryHistory';
    var LS_WEEK_HISTORY = 'jxz_weekHistory';
    var LS_SAVES = 'jxz_saves';
    var LS_MARK_WEEK_UI_INDEX = 'jxz_markWeekUiIndex';
    var LS_SUMMARY_BUFF = 'jxz_summaryBuff';

    // localStorage key（快照降级，仅存体积可控的字段）
    var LS_SNAPSHOT_APPSTATE = 'jxz_snapshot';
    var LS_SNAPSHOT_LAST_MSG = 'jxz_snapshot_lastMsg';

    // --- 内部状态 ---
    var _cache = {};
    var _idbAvailable = false;
    var _initialized = false;

    // --- 快照内存缓存（对应 jxz_snapshot_db）---
    var _snapshotCache = null;
    var _idbSnapshotAvailable = false;

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
        // 清理旧架构遗留的 stale key（snapshot, lastTurnCommitted）
        if (_idbAvailable) {
            idbStorage.remove('snapshot').catch(function() {});
            idbStorage.remove('lastTurnCommitted').catch(function() {});
        }

        // 初始化快照数据库（jxz_snapshot_db，独立于主库）
        try {
            if (typeof idbSnapshot !== 'undefined') {
                await idbSnapshot.open();
                _idbSnapshotAvailable = true;
                var snapData = await idbSnapshot.getAll();
                if (Object.keys(snapData).length > 0) {
                    _snapshotCache = snapData;
                    console.log('[Storage] snapshot_db 已加载，快照存在');
                } else {
                    // 尝试从旧 LS jxz_snapshot 迁移 appState 部分
                    var oldLsSnap = _lsGet(LS_SNAPSHOT_APPSTATE);
                    if (oldLsSnap) {
                        _snapshotCache = { appState: oldLsSnap };
                        idbSnapshot.put('appState', oldLsSnap).catch(function() {});
                        console.log('[Storage] 已从 localStorage 迁移旧 snapshot 到 snapshot_db');
                    }
                }
            }
        } catch (snapErr) {
            _idbSnapshotAvailable = false;
            console.warn('[Storage] snapshot_db 不可用:', snapErr && snapErr.message || snapErr);
            // 降级：从 localStorage 读取 appState 快照
            var _lsSnapFallback = _lsGet(LS_SNAPSHOT_APPSTATE);
            if (_lsSnapFallback) {
                _snapshotCache = { appState: _lsSnapFallback };
            }
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

        // 迁移 summaryHistory
        var summaryHistory = _lsGet(LS_SUMMARY_HISTORY);
        if (summaryHistory) {
            _cache[KEY_SUMMARY_HISTORY] = summaryHistory;
            await idbStorage.put(KEY_SUMMARY_HISTORY, summaryHistory);
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

        var summaryHistory = _lsGet(LS_SUMMARY_HISTORY);
        if (summaryHistory) _cache[KEY_SUMMARY_HISTORY] = summaryHistory;

        // 降级：从 localStorage 读取快照 appState
        var snapAppState = _lsGet(LS_SNAPSHOT_APPSTATE);
        if (snapAppState) {
            _snapshotCache = { appState: snapAppState };
        }

        var markWeekUiIndex = _lsGet(LS_MARK_WEEK_UI_INDEX);
        if (typeof markWeekUiIndex === 'number') _cache[KEY_MARK_WEEK_UI_INDEX] = markWeekUiIndex;

        var summaryBuff = _lsGet(LS_SUMMARY_BUFF);
        _cache[KEY_SUMMARY_BUFF] = (summaryBuff && typeof summaryBuff === 'object') ? summaryBuff : null;

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
        // 必须深拷贝，防止与 _snapshotCache 共享引用（appendUIConversation 原地 push 会污染快照）
        var cloned = history ? history.slice() : [];
        _cache[KEY_UI_CONV] = cloned;
        _idbPut(KEY_UI_CONV, cloned);
        _lsSet(LS_UI_CONV, cloned);
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

    // --- Embeddings（Phase 3 向量存储）---
    // key 格式：emb_<summaryId>，复用同一 IDB keyval store

    /**
     * 保存一条 embedding 记录
     * @param {string} id - summaryHistory 条目的 id
     * @param {Float32Array} vector - 1024 维向量
     * @param {object} metadata - { text, week, fingerprint, createdAt }
     */
    function saveEmbedding(id, vector, metadata) {
        if (!id) return;
        var key = 'emb_' + id;
        var record = Object.assign({ id: id, vector: vector }, metadata || {});
        _cache[key] = record;
        if (_idbAvailable) {
            idbStorage.put(key, record).catch(function(e) {
                console.warn('[Storage][Embedding] IDB 写入失败:', e && e.message || e);
            });
        }
    }

    /**
     * 加载全部 embedding 记录（启动时预热内存缓存用）
     * @returns {Array}
     */
    function loadAllEmbeddings() {
        var result = [];
        var keys = Object.keys(_cache);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('emb_') === 0) {
                result.push(_cache[keys[i]]);
            }
        }
        return result;
    }

    /**
     * 删除指定 embedding 记录
     * @param {string} id - summaryHistory 条目的 id
     */
    function deleteEmbedding(id) {
        var key = 'emb_' + id;
        delete _cache[key];
        _idbRemove(key);
    }

    /**
     * 清空全部 embedding 记录（新游戏时调用）
     */
    function clearEmbeddings() {
        var keys = Object.keys(_cache);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('emb_') === 0) {
                _idbRemove(keys[i]);
                delete _cache[keys[i]];
            }
        }
        console.log('[Storage] 已清空所有 embedding 记录');
    }

    // --- 全量快照（snapshot_db）---

    function _idbSnapshotPut(key, value) {
        if (!_idbSnapshotAvailable) return;
        idbSnapshot.put(key, value).catch(function(e) {
            console.warn('[Storage][IDB-Snapshot] put ' + key + ' 失败:', e && e.message || e);
        });
    }

    var _SNAPSHOT_KEYS = ['appState', 'uiConversation', 'summaryHistory', 'weekHistory', 'markWeekUiIndex', 'summaryBuff', 'lastUserMessage'];

    function _idbSnapshotRemoveAll() {
        if (!_idbSnapshotAvailable) return;
        _SNAPSHOT_KEYS.forEach(function(k) {
            idbSnapshot.remove(k).catch(function() {});
        });
    }

    /**
     * 保存全量快照（异步）
     * 保存 gameData, uiConversation, summaryHistory, weekHistory,
     * markWeekUiIndex, summaryBuff, lastUserMessage
     */
    async function saveFullSnapshot() {
        var snap = {
            appState:        { gameData: (typeof gameData !== 'undefined') ? structuredClone(gameData) : null },
            uiConversation:  structuredClone(loadUIConversation()),
            summaryHistory:  (typeof summaryHistoryService !== 'undefined') ? structuredClone(summaryHistoryService.getAll()) : [],
            weekHistory:     (typeof weekHistoryService !== 'undefined') ? structuredClone(weekHistoryService.getAll()) : [],
            markWeekUiIndex: getMarkWeekUiIndex(),
            summaryBuff:     getSummaryBuff() ? structuredClone(getSummaryBuff()) : null,
            lastUserMessage: (typeof lastUserMessage !== 'undefined') ? lastUserMessage : ''
        };
        _snapshotCache = snap;
        if (_idbSnapshotAvailable) {
            await Promise.all([
                idbSnapshot.put('appState',        snap.appState),
                idbSnapshot.put('uiConversation',  snap.uiConversation),
                idbSnapshot.put('summaryHistory',  snap.summaryHistory),
                idbSnapshot.put('weekHistory',     snap.weekHistory),
                idbSnapshot.put('markWeekUiIndex', snap.markWeekUiIndex),
                idbSnapshot.put('summaryBuff',     snap.summaryBuff),
                idbSnapshot.put('lastUserMessage', snap.lastUserMessage)
            ]);
        }
        // localStorage 降级：仅存体积可控的字段
        _lsSet(LS_SNAPSHOT_APPSTATE, snap.appState);
        _lsSet(LS_SNAPSHOT_LAST_MSG, snap.lastUserMessage);
        console.log('[Storage] 全量快照已写入 snapshot_db');
    }

    /**
     * 从快照应用所有字段（同步）
     * @returns {boolean} 是否成功应用
     */
    function restoreFromSnapshot() {
        var snap = _snapshotCache;
        if (!snap || !snap.appState) return false;

        // 还原 gameData
        if (snap.appState.gameData) {
            if (typeof mergeWithDefaults === 'function' && typeof defaultGameData !== 'undefined') {
                gameData = mergeWithDefaults(snap.appState.gameData, defaultGameData);
            } else if (typeof gameData !== 'undefined') {
                gameData = snap.appState.gameData;
            }
            if (typeof syncVariablesFromGameData === 'function') syncVariablesFromGameData();
            saveAppState({ gameData: gameData });
        }

        // 还原 uiConversation
        replaceUIConversation(snap.uiConversation || []);

        // 还原 summaryHistory
        if (typeof summaryHistoryService !== 'undefined') {
            summaryHistoryService.importAll(snap.summaryHistory || []);
        }

        // 还原 weekHistory
        if (typeof weekHistoryService !== 'undefined') {
            weekHistoryService.importAll(snap.weekHistory || []);
        }

        // 还原 markWeekUiIndex
        setMarkWeekUiIndex(typeof snap.markWeekUiIndex === 'number' ? snap.markWeekUiIndex : 0);

        // 还原 summaryBuff
        if (snap.summaryBuff) {
            setSummaryBuff(snap.summaryBuff);
        } else {
            clearSummaryBuff();
        }

        console.log('[Storage] 已从快照还原状态');
        return true;
    }

    /**
     * 是否存在快照
     */
    function hasSnapshot() {
        return _snapshotCache != null && _snapshotCache.appState != null;
    }

    /**
     * 清空快照
     */
    function clearSnapshot() {
        _snapshotCache = null;
        _idbSnapshotRemoveAll();
        _lsRemove(LS_SNAPSHOT_APPSTATE);
        _lsRemove(LS_SNAPSHOT_LAST_MSG);
        console.log('[Storage] 快照已清空');
    }

    /**
     * 获取快照中保存的最后一条用户消息
     */
    function getSnapshotLastUserMessage() {
        if (!_snapshotCache) return '';
        return _snapshotCache.lastUserMessage || '';
    }

    /**
     * 更新快照中的最后一条用户消息（重生成编辑消息时使用）
     */
    function updateSnapshotLastUserMessage(msg) {
        if (!_snapshotCache) return;
        _snapshotCache.lastUserMessage = msg;
        _idbSnapshotPut('lastUserMessage', msg);
        _lsSet(LS_SNAPSHOT_LAST_MSG, msg);
    }
    // --- markWeekUiIndex（周总结优化：记录上次写入初版总结时 uiConversation 的长度）---

    function getMarkWeekUiIndex() {
        var v = _cache[KEY_MARK_WEEK_UI_INDEX];
        return typeof v === 'number' ? v : 0;
    }

    function setMarkWeekUiIndex(index) {
        var value = typeof index === 'number' ? index : 0;
        _cache[KEY_MARK_WEEK_UI_INDEX] = value;
        _idbPut(KEY_MARK_WEEK_UI_INDEX, value);
        _lsSet(LS_MARK_WEEK_UI_INDEX, value);
    }

    // --- summaryBuff（周总结优化：待总结的正文缓冲）---

    function getSummaryBuff() {
        return _cache[KEY_SUMMARY_BUFF] || null;
    }

    function setSummaryBuff(buff) {
        _cache[KEY_SUMMARY_BUFF] = buff;
        _idbPut(KEY_SUMMARY_BUFF, buff);
        _lsSet(LS_SUMMARY_BUFF, buff);
    }

    function clearSummaryBuff() {
        _cache[KEY_SUMMARY_BUFF] = null;
        _idbPut(KEY_SUMMARY_BUFF, null);
        _lsSet(LS_SUMMARY_BUFF, null);
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

    // --- Week History (供 weekHistoryService 使用，仅 index 独立前端链路) ---

    function loadWeekHistory() {
        return _cache[KEY_WEEK_HISTORY] || [];
    }

    function saveWeekHistory(history) {
        _cache[KEY_WEEK_HISTORY] = history;
        _idbPut(KEY_WEEK_HISTORY, history);
        _lsSet(LS_WEEK_HISTORY, history);
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
        // Phase 3：序列化 embeddings（Float32Array → number[]）
        var embRecords = loadAllEmbeddings();
        var embExport = embRecords.map(function(r) {
            var vec = r.vector;
            var arr = (vec instanceof Float32Array) ? Array.from(vec) : (Array.isArray(vec) ? vec : []);
            return { id: r.id, vector: arr, text: r.text || '', week: r.week || 0, fingerprint: r.fingerprint || '', createdAt: r.createdAt || 0 };
        });
        var payload = {
            id: id,
            saveName: saveName,
            gameData: (typeof gameData !== 'undefined') ? structuredClone(gameData) : null,
            summaryHistory: (typeof summaryHistoryService !== 'undefined') ? structuredClone(summaryHistoryService.getAll()) : [],
            weekHistory: (typeof weekHistoryService !== 'undefined') ? structuredClone(weekHistoryService.getAll()) : [],
            markWeekUiIndex: getMarkWeekUiIndex(),
            summaryBuff: getSummaryBuff() ? structuredClone(getSummaryBuff()) : null,
            uiConversation: structuredClone(loadUIConversation()),
            embeddings: embExport,
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

        // Phase 3：恢复 embeddings（number[] → Float32Array → saveEmbedding）
        if (Array.isArray(payload.embeddings) && payload.embeddings.length > 0) {
            for (var ei = 0; ei < payload.embeddings.length; ei++) {
                var er = payload.embeddings[ei];
                if (!er || !er.id) continue;
                var vecArr = Array.isArray(er.vector) ? er.vector : [];
                var f32 = new Float32Array(vecArr);
                saveEmbedding(er.id, f32, {
                    text: er.text || '',
                    week: er.week || 0,
                    fingerprint: er.fingerprint || '',
                    createdAt: er.createdAt || 0
                });
            }
            // 刷新内存召回缓存
            if (typeof memoryRecall !== 'undefined') {
                memoryRecall.clearCache();
                memoryRecall.init();
            }
            console.log('[Storage] 已恢复 ' + payload.embeddings.length + ' 条 embedding 记录');
        }

        // 恢复 weekHistory
        if (Array.isArray(payload.weekHistory)) {
            saveWeekHistory(payload.weekHistory);
            console.log('[Storage] 已恢复 ' + payload.weekHistory.length + ' 条 weekHistory 记录');
        }

        // 恢复 markWeekUiIndex 和 summaryBuff（周总结优化；老存档无此字段时默认为存档 uiConversation 长度）
        var _mwIdx = typeof payload.markWeekUiIndex === 'number' ? payload.markWeekUiIndex : (Array.isArray(payload.uiConversation) ? payload.uiConversation.length : 0);
        setMarkWeekUiIndex(_mwIdx);
        console.log('[Storage] 已恢复 markWeekUiIndex=' + _mwIdx);
        if (payload.summaryBuff && typeof payload.summaryBuff === 'object') {
            setSummaryBuff(payload.summaryBuff);
            console.log('[Storage] 已恢复 summaryBuff, targetMarkWeek=' + payload.summaryBuff.targetMarkWeek);
        } else {
            clearSummaryBuff();
        }

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
        // Phase 3：序列化 embeddings（Float32Array → number[] 保证 JSON 兼容）
        var embRecords = loadAllEmbeddings();
        var embExport = embRecords.map(function(r) {
            var vec = r.vector;
            var arr;
            if (vec instanceof Float32Array) {
                arr = Array.from(vec);
            } else if (Array.isArray(vec)) {
                arr = vec;
            } else {
                arr = [];
            }
            return {
                id: r.id,
                vector: arr,
                text: r.text || '',
                week: r.week || 0,
                fingerprint: r.fingerprint || '',
                createdAt: r.createdAt || 0
            };
        });
        return {
            saveName: saveName,
            gameData: (typeof gameData !== 'undefined') ? gameData : null,
            summaryHistory: (typeof summaryHistoryService !== 'undefined') ? summaryHistoryService.getAll() : [],
            weekHistory: (typeof weekHistoryService !== 'undefined') ? weekHistoryService.getAll() : [],
            markWeekUiIndex: getMarkWeekUiIndex(),
            summaryBuff: getSummaryBuff(),
            uiConversation: loadUIConversation(),
            embeddings: embExport,
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
        saveFullSnapshot: saveFullSnapshot,
        restoreFromSnapshot: restoreFromSnapshot,
        hasSnapshot: hasSnapshot,
        clearSnapshot: clearSnapshot,
        getSnapshotLastUserMessage: getSnapshotLastUserMessage,
        updateSnapshotLastUserMessage: updateSnapshotLastUserMessage,
        getMarkWeekUiIndex: getMarkWeekUiIndex,
        setMarkWeekUiIndex: setMarkWeekUiIndex,
        getSummaryBuff: getSummaryBuff,
        setSummaryBuff: setSummaryBuff,
        clearSummaryBuff: clearSummaryBuff,
        loadSummaryHistory: loadSummaryHistory,
        saveSummaryHistory: saveSummaryHistory,
        loadWeekHistory: loadWeekHistory,
        saveWeekHistory: saveWeekHistory,
        saveEmbedding: saveEmbedding,
        loadAllEmbeddings: loadAllEmbeddings,
        deleteEmbedding: deleteEmbedding,
        clearEmbeddings: clearEmbeddings,
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
