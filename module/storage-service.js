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
    // L2 剧情事件层（向量化方案优化2）
    var KEY_EVENT_HISTORY = 'eventHistory';
    var KEY_EVENT_META = 'eventMeta';
    var KEY_EVENT_WATERMARK = 'eventWatermark';
    var KEY_EVENT_STEP = 'eventStep';
    var EVENT_STEP_DEFAULT = 20;
    // L-地点 记忆层（地点信息迭代，仿 L2 事件层的独立 key 模式）
    var KEY_LOCATION_MEMORY = 'locationMemory';
    var KEY_LOCATION_BUFF = 'locationBuff';
    // 提示词管理：全局配置（不随存档走，所有存档共用一份），结构 { [promptKey]: string }
    var KEY_PROMPT_OVERRIDES = 'promptOverrides';
    // 自定义世界书：全局配置（不随存档走），结构 [{id,name,keywords,content,enabled}]，数组顺序即插入顺序
    // 两个独立的分类/插入位置：1=主角信息后/] 之前，2=</fresh>与<user_input>之间
    var KEY_CUSTOM_WORLDBOOK = 'customWorldbook';
    var KEY_CUSTOM_WORLDBOOK_2 = 'customWorldbook2';

    // localStorage key（兼容旧格式）
    var LS_APP_STATE = 'jxz_appState';
    var LS_UI_CONV = 'jxz_uiConversation';
    var LS_SUMMARY_HISTORY = 'jxz_summaryHistory';
    var LS_WEEK_HISTORY = 'jxz_weekHistory';
    var LS_SAVES = 'jxz_saves';
    var LS_MARK_WEEK_UI_INDEX = 'jxz_markWeekUiIndex';
    var LS_SUMMARY_BUFF = 'jxz_summaryBuff';
    var LS_EVENT_HISTORY = 'jxz_eventHistory';
    var LS_EVENT_META = 'jxz_eventMeta';
    var LS_EVENT_WATERMARK = 'jxz_eventWatermark';
    var LS_EVENT_STEP = 'jxz_eventStep';
    var LS_LOCATION_MEMORY = 'jxz_locationMemory';
    var LS_LOCATION_BUFF = 'jxz_locationBuff';
    var LS_PROMPT_OVERRIDES = 'jxz_promptOverrides';
    var LS_CUSTOM_WORLDBOOK = 'jxz_customWorldbook';
    var LS_CUSTOM_WORLDBOOK_2 = 'jxz_customWorldbook2';

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

    // --- 写入错误与旧副本清理记录（诊断用，只含 key 名与错误类型，不含数据内容）---
    var _lastWriteError = null;
    var _notifiedWriteError = {};
    var _legacyCleanup = null;
    var _snapshotLsUnpersisted = false;
    // 旧 localStorage 副本备份到主库时使用的 key 前缀（不加载进内存缓存）
    var LS_BACKUP_PREFIX = 'lsBackup:';

    // --- 辅助函数 ---
    function _errorCode(err) {
        if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014)) return 'QuotaExceededError';
        if (err && err.name) return String(err.name);
        return 'Error';
    }

    /**
     * 记录持久化失败：只输出 key 与错误类型；每种存储每次会话最多弹一次提示，避免刷屏。
     * @param {'indexedDB'|'snapshotDB'|'localStorage'} target
     */
    function _reportWriteError(target, key, err) {
        var code = _errorCode(err);
        _lastWriteError = { target: target, key: String(key), code: code, at: Date.now() };
        console.error('[Storage] ' + target + ' 写入失败 [' + code + '] key=' + key);
        if (_notifiedWriteError[target]) return;
        _notifiedWriteError[target] = true;
        var msg = '游戏进度未能写入浏览器存储（' + code + '）。请尽快导出存档备份，不要直接清除网站数据。';
        try {
            if (typeof showToast === 'function') showToast(msg, { duration: 8000 });
        } catch (e) {}
    }

    function _idbPut(key, value) {
        if (!_idbAvailable) return;
        idbStorage.put(key, value).catch(function(e) { _reportWriteError('indexedDB', key, e); });
    }

    function _idbRemove(key) {
        if (!_idbAvailable) return;
        idbStorage.remove(key).catch(function(e) { _reportWriteError('indexedDB', key, e); });
    }

    function _lsRaw(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function _lsGet(key) {
        try {
            var raw = localStorage.getItem(key);
            if (!raw || raw === 'undefined' || raw === 'null') return null;
            return JSON.parse(raw);
        } catch (e) { return null; }
    }

    /**
     * localStorage 只作为 IndexedDB 不可用时的降级存储。
     * IDB 可用时不再镜像游戏数据：这些副本会随游玩持续膨胀，挤占 API 配置等小配置的 localStorage 配额。
     */
    function _lsSet(key, value) {
        if (_idbAvailable) return;
        _lsWrite(key, value);
    }

    /** 快照降级副本：仅在快照库不可用时写 localStorage */
    function _lsSnapSet(key, value) {
        if (_idbSnapshotAvailable) return;
        _lsWrite(key, value);
    }

    function _lsWrite(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch (e) { _reportWriteError('localStorage', key, e); }
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

            // 从 IDB 加载全部数据到缓存（旧 localStorage 副本的备份不进内存缓存）
            var allData = await idbStorage.getAll();
            var backupKeys = [];
            Object.keys(allData).forEach(function(k) {
                if (k.indexOf(LS_BACKUP_PREFIX) === 0) { backupKeys.push(k); delete allData[k]; }
            });
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
                        try {
                            await idbSnapshot.put('appState', oldLsSnap);
                            console.log('[Storage] 已从 localStorage 迁移旧 snapshot 到 snapshot_db');
                        } catch (snapMigrateErr) {
                            // 未迁移成功：清理阶段会把它当作不一致副本处理（先备份再删），这里不让 cache 假装已同步
                            _snapshotCache = { appState: oldLsSnap };
                            _snapshotLsUnpersisted = true;
                        }
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

        // IDB 可用时，把旧版本镜像到 localStorage 的游戏数据安全移出，释放给 API 配置等小配置使用
        if (_idbAvailable) {
            try {
                await _cleanupLegacyLocalStorage();
            } catch (cleanupErr) {
                console.warn('[Storage] 旧 localStorage 副本清理中止 [' + _errorCode(cleanupErr) + ']，原数据保留');
            }
        }
    }

    function _saveIndexEntry(id, s) {
        return {
            id: id,
            saveName: s.saveName,
            previewWeek: s.previewWeek,
            previewLocation: s.previewLocation,
            createdAt: s.createdAt
        };
    }

    // 明确列出由本服务写过的 localStorage 游戏数据 key（只处理这些，绝不按前缀批量删除）
    function _legacyMirrorKeys() {
        return [
            [LS_APP_STATE, KEY_APP_STATE], [LS_UI_CONV, KEY_UI_CONV],
            [LS_SUMMARY_HISTORY, KEY_SUMMARY_HISTORY], [LS_WEEK_HISTORY, KEY_WEEK_HISTORY],
            [LS_MARK_WEEK_UI_INDEX, KEY_MARK_WEEK_UI_INDEX], [LS_SUMMARY_BUFF, KEY_SUMMARY_BUFF],
            [LS_EVENT_HISTORY, KEY_EVENT_HISTORY], [LS_EVENT_META, KEY_EVENT_META],
            [LS_EVENT_WATERMARK, KEY_EVENT_WATERMARK], [LS_EVENT_STEP, KEY_EVENT_STEP],
            [LS_LOCATION_MEMORY, KEY_LOCATION_MEMORY], [LS_LOCATION_BUFF, KEY_LOCATION_BUFF],
            [LS_PROMPT_OVERRIDES, KEY_PROMPT_OVERRIDES],
            [LS_CUSTOM_WORLDBOOK, KEY_CUSTOM_WORLDBOOK], [LS_CUSTOM_WORLDBOOK_2, KEY_CUSTOM_WORLDBOOK_2],
            [LS_SAVES + '_index', KEY_SAVE_INDEX]
        ];
    }

    function _sameJson(raw, value) {
        if (value === undefined) return false;
        try { return raw === JSON.stringify(value); } catch (e) { return false; }
    }

    /**
     * 旧 localStorage 副本 → IndexedDB 的保守清理（可重复执行，中途中断也安全）：
     * 1. 与 IDB 当前数据完全一致的副本：直接删除 localStorage 副本。
     * 2. 与 IDB 不一致或 IDB 缺失的副本：无法判断新旧，原样备份到 IDB 的 lsBackup:<key>，
     *    事务提交并读回校验一致后，才删除 localStorage 副本；当前游戏使用的 IDB 数据保持不变。
     * 3. 存档索引里只能从 localStorage 读到的完整存档：先补写进 IDB（与索引 id 同名）并校验，再删除。
     * 任一步写入/校验失败：该 key 的 localStorage 原数据保留。
     */
    async function _cleanupLegacyLocalStorage() {
        var report = { removedKeys: 0, backedUpKeys: 0, restoredSaves: 0, keptKeys: 0, freedChars: 0, errors: [] };
        _legacyCleanup = report;

        async function backupThenRemove(lsKey, raw) {
            var backupKey = LS_BACKUP_PREFIX + lsKey;
            var existing = await idbStorage.get(backupKey);
            if (existing !== raw) {
                if (typeof existing === 'string') backupKey += ':' + Date.now();
                await idbStorage.put(backupKey, raw);
                if ((await idbStorage.get(backupKey)) !== raw) throw new Error('backup verify failed');
                report.backedUpKeys++;
            }
            removeLs(lsKey, raw);
        }

        function removeLs(lsKey, raw) {
            // 删除前再次确认内容未被其他标签页改动
            if (_lsRaw(lsKey) !== raw) { report.keptKeys++; return; }
            _lsRemove(lsKey);
            report.removedKeys++;
            report.freedChars += lsKey.length + raw.length;
        }

        async function handle(lsKey, idbValue) {
            var raw = _lsRaw(lsKey);
            if (raw === null) return;
            try {
                if (_sameJson(raw, idbValue)) removeLs(lsKey, raw);
                else await backupThenRemove(lsKey, raw);
            } catch (e) {
                report.keptKeys++;
                report.errors.push(lsKey + ':' + _errorCode(e));
            }
        }

        var simple = _legacyMirrorKeys();
        for (var i = 0; i < simple.length; i++) {
            await handle(simple[i][0], _cache[simple[i][1]]);
        }

        // 完整存档列表：确保索引中的每个存档都能从 IDB 读取，再处理 localStorage 副本
        var savesRaw = _lsRaw(LS_SAVES);
        if (savesRaw !== null) {
            try {
                var lsSaves = JSON.parse(savesRaw);
                if (Array.isArray(lsSaves)) {
                    var indexIds = {};
                    _getSaveIndex().forEach(function(e) { if (e && e.id) indexIds[e.id] = true; });
                    for (var j = 0; j < lsSaves.length; j++) {
                        var s = lsSaves[j];
                        if (!s || !s.id || !indexIds[s.id] || _cache[s.id]) continue;
                        // 旧迁移把存档写在 'save_' + id 下、索引却用 id，loadSave 一直靠 localStorage 兜底读取
                        var copy = s;
                        await idbStorage.put(s.id, copy);
                        var check = await idbStorage.get(s.id);
                        if (!_sameJson(JSON.stringify(copy), check)) throw new Error('save verify failed');
                        _cache[s.id] = copy;
                        report.restoredSaves++;
                    }
                }
            } catch (e) {
                report.keptKeys++;
                report.errors.push(LS_SAVES + ':' + _errorCode(e));
                savesRaw = null; // 存档补写未完成：不动 localStorage 中的存档
            }
            if (savesRaw !== null) {
                var expected = [];
                _getSaveIndex().forEach(function(e) { if (e && _cache[e.id]) expected.push(_cache[e.id]); });
                await handle(LS_SAVES, expected);
            }
        }

        // 快照降级副本：快照库可用时同样移出
        if (_idbSnapshotAvailable) {
            var snapOk = _snapshotCache && !_snapshotLsUnpersisted;
            await handle(LS_SNAPSHOT_APPSTATE, snapOk ? _snapshotCache.appState : undefined);
            await handle(LS_SNAPSHOT_LAST_MSG, snapOk ? _snapshotCache.lastUserMessage : undefined);
        }

        if (report.removedKeys || report.errors.length) {
            console.log('[Storage] 旧 localStorage 副本清理：移除 ' + report.removedKeys + ' 个 key（约 ' +
                Math.round(report.freedChars / 1024) + 'K 字符），备份到 IndexedDB ' + report.backedUpKeys +
                ' 个，补写存档 ' + report.restoredSaves + ' 个，保留 ' + report.keptKeys + ' 个' +
                (report.errors.length ? '，失败: ' + report.errors.join(', ') : ''));
        }
        return report;
    }

    /**
     * 存储诊断：只返回分类、字符数与错误类型，不含 Key、配置或对话内容。
     * localStorage 按 UTF-16 存储，字符数约等于实际占用的一半字节量级，仅作相对参考。
     */
    function getStorageDiagnostics() {
        var legacy = {};
        _legacyMirrorKeys().forEach(function(p) { legacy[p[0]] = true; });
        legacy[LS_SAVES] = true; legacy[LS_SNAPSHOT_APPSTATE] = true; legacy[LS_SNAPSHOT_LAST_MSG] = true;
        var usage = { total: 0, apiConfig: 0, legacyGameData: 0, other: 0, keyCount: 0 };
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                var size = k.length + (localStorage.getItem(k) || '').length;
                usage.total += size;
                usage.keyCount++;
                if (/^jxz_apiConfig/.test(k)) usage.apiConfig += size;
                else if (legacy[k]) usage.legacyGameData += size;
                else usage.other += size;
            }
        } catch (e) { usage.error = _errorCode(e); }
        return {
            indexedDB: _idbAvailable,
            snapshotDB: _idbSnapshotAvailable,
            localStorageChars: usage,
            lastWriteError: _lastWriteError ? Object.assign({}, _lastWriteError) : null,
            legacyCleanup: _legacyCleanup ? JSON.parse(JSON.stringify(_legacyCleanup)) : null
        };
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

        // 迁移其他旧版本镜像过的数据（事件层、地点层、提示词、世界书等），避免清理副本时与当前数据脱节
        var extra = [
            [LS_WEEK_HISTORY, KEY_WEEK_HISTORY], [LS_MARK_WEEK_UI_INDEX, KEY_MARK_WEEK_UI_INDEX],
            [LS_SUMMARY_BUFF, KEY_SUMMARY_BUFF], [LS_EVENT_HISTORY, KEY_EVENT_HISTORY],
            [LS_EVENT_META, KEY_EVENT_META], [LS_EVENT_WATERMARK, KEY_EVENT_WATERMARK],
            [LS_EVENT_STEP, KEY_EVENT_STEP], [LS_LOCATION_MEMORY, KEY_LOCATION_MEMORY],
            [LS_LOCATION_BUFF, KEY_LOCATION_BUFF], [LS_PROMPT_OVERRIDES, KEY_PROMPT_OVERRIDES],
            [LS_CUSTOM_WORLDBOOK, KEY_CUSTOM_WORLDBOOK], [LS_CUSTOM_WORLDBOOK_2, KEY_CUSTOM_WORLDBOOK_2]
        ];
        for (var x = 0; x < extra.length; x++) {
            var v = _lsGet(extra[x][0]);
            if (v === null) continue;
            _cache[extra[x][1]] = v;
            await idbStorage.put(extra[x][1], v);
            migrated++;
        }

        // 迁移存档列表（拆分为独立 key；key 必须与索引 id 一致，loadSave 才能命中缓存）
        var saves = _lsGet(LS_SAVES);
        if (saves && Array.isArray(saves) && saves.length > 0) {
            var index = [];
            for (var i = 0; i < saves.length; i++) {
                var s = saves[i];
                if (!s || typeof s !== 'object') continue;
                var saveKey = s.id || ('save_' + Date.now() + '_' + i);
                _cache[saveKey] = s;
                await idbStorage.put(saveKey, s);
                index.push(_saveIndexEntry(saveKey, s));
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

        var weekHistory = _lsGet(LS_WEEK_HISTORY);
        if (Array.isArray(weekHistory)) _cache[KEY_WEEK_HISTORY] = weekHistory;

        // 降级：从 localStorage 读取快照 appState
        var snapAppState = _lsGet(LS_SNAPSHOT_APPSTATE);
        if (snapAppState) {
            _snapshotCache = { appState: snapAppState };
        }

        var markWeekUiIndex = _lsGet(LS_MARK_WEEK_UI_INDEX);
        if (typeof markWeekUiIndex === 'number') _cache[KEY_MARK_WEEK_UI_INDEX] = markWeekUiIndex;

        var summaryBuff = _lsGet(LS_SUMMARY_BUFF);
        _cache[KEY_SUMMARY_BUFF] = _normalizeSummaryBuffQueue(summaryBuff);

        // L2 剧情事件层
        var eventHistory = _lsGet(LS_EVENT_HISTORY);
        if (Array.isArray(eventHistory)) _cache[KEY_EVENT_HISTORY] = eventHistory;
        var eventMeta = _lsGet(LS_EVENT_META);
        if (eventMeta && typeof eventMeta === 'object') _cache[KEY_EVENT_META] = eventMeta;
        var eventWatermark = _lsGet(LS_EVENT_WATERMARK);
        if (typeof eventWatermark === 'number') _cache[KEY_EVENT_WATERMARK] = eventWatermark;
        var eventStep = _lsGet(LS_EVENT_STEP);
        if (typeof eventStep === 'number') _cache[KEY_EVENT_STEP] = eventStep;

        // L-地点 记忆层
        var locationMemory = _lsGet(LS_LOCATION_MEMORY);
        if (locationMemory && typeof locationMemory === 'object') _cache[KEY_LOCATION_MEMORY] = locationMemory;
        var locationBuff = _lsGet(LS_LOCATION_BUFF);
        if (Array.isArray(locationBuff)) _cache[KEY_LOCATION_BUFF] = locationBuff;

        // 提示词管理覆盖表
        var promptOverrides = _lsGet(LS_PROMPT_OVERRIDES);
        if (promptOverrides && typeof promptOverrides === 'object') _cache[KEY_PROMPT_OVERRIDES] = promptOverrides;

        // 自定义世界书
        var customWorldbook = _lsGet(LS_CUSTOM_WORLDBOOK);
        if (Array.isArray(customWorldbook)) _cache[KEY_CUSTOM_WORLDBOOK] = customWorldbook;
        var customWorldbook2 = _lsGet(LS_CUSTOM_WORLDBOOK_2);
        if (Array.isArray(customWorldbook2)) _cache[KEY_CUSTOM_WORLDBOOK_2] = customWorldbook2;

        // 旧格式存档 → 转为索引 + 独立 key（仅缓存中）
        var saves = _lsGet(LS_SAVES);
        if (saves && Array.isArray(saves)) {
            var index = [];
            for (var i = 0; i < saves.length; i++) {
                var s = saves[i];
                if (!s || typeof s !== 'object') continue;
                var saveKey = s.id || ('save_' + i);
                _cache[saveKey] = s;
                index.push(_saveIndexEntry(saveKey, s));
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
        // L2 向量同步清空（与 L0 一起重置，避免不同存档/新游戏污染）
        clearL2Embeddings();
    }

    // --- L2 剧情事件向量（wevt_<id>，向量化方案优化2）---

    /**
     * 保存一条 L2 事件向量记录
     * @param {string} id - 事件 id（evt-N）
     * @param {Float32Array} vector
     * @param {object} metadata - { text, week, fingerprint, createdAt }
     */
    function saveL2Embedding(id, vector, metadata) {
        if (!id) return;
        var key = 'wevt_' + id;
        var record = Object.assign({ id: id, vector: vector, type: 'event' }, metadata || {});
        _cache[key] = record;
        if (_idbAvailable) {
            idbStorage.put(key, record).catch(function(e) {
                console.warn('[Storage][L2Embedding] IDB 写入失败:', e && e.message || e);
            });
        }
    }

    /**
     * 加载全部 L2 事件向量记录（启动时预热 _cacheL2 用）
     */
    function loadAllL2Embeddings() {
        var result = [];
        var keys = Object.keys(_cache);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('wevt_') === 0) {
                result.push(_cache[keys[i]]);
            }
        }
        return result;
    }

    /**
     * 删除指定 L2 事件向量记录
     */
    function deleteL2Embedding(id) {
        var key = 'wevt_' + id;
        delete _cache[key];
        _idbRemove(key);
    }

    /**
     * 清空全部 L2 事件向量记录
     */
    function clearL2Embeddings() {
        var keys = Object.keys(_cache);
        var n = 0;
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('wevt_') === 0) {
                _idbRemove(keys[i]);
                delete _cache[keys[i]];
                n++;
            }
        }
        if (n > 0) console.log('[Storage] 已清空 ' + n + ' 条 L2 事件向量');
    }

    // --- L2 事件历史 / 元数据 / watermark / step ---

    function loadEventHistory() {
        return _cache[KEY_EVENT_HISTORY] || [];
    }

    function saveEventHistory(history) {
        // 深拷贝隔断与旧存档/快照 payload 的共享引用（_restoreL2FromPayload 直接把 payload.eventHistory 传进来，
        // event-history-service.js 的 appendEvents() 会对返回对象 push/sort/换槽，若不拷贝会直接污染旧 payload）
        var h = Array.isArray(history) ? structuredClone(history) : [];
        _cache[KEY_EVENT_HISTORY] = h;
        _idbPut(KEY_EVENT_HISTORY, h);
        _lsSet(LS_EVENT_HISTORY, h);
    }

    function loadEventMeta() {
        return _cache[KEY_EVENT_META] || { arcs: {}, facts: {} };
    }

    function saveEventMeta(meta) {
        // 深拷贝隔断与旧存档/快照 payload 的共享引用（event-history-service.js 会对 meta.arcs/meta.facts 原地修改）
        var m = (meta && typeof meta === 'object') ? structuredClone(meta) : { arcs: {}, facts: {} };
        _cache[KEY_EVENT_META] = m;
        _idbPut(KEY_EVENT_META, m);
        _lsSet(LS_EVENT_META, m);
    }

    function loadEventWatermark() {
        var v = _cache[KEY_EVENT_WATERMARK];
        return typeof v === 'number' ? v : 0;
    }

    function saveEventWatermark(pos) {
        var value = typeof pos === 'number' ? pos : 0;
        _cache[KEY_EVENT_WATERMARK] = value;
        _idbPut(KEY_EVENT_WATERMARK, value);
        _lsSet(LS_EVENT_WATERMARK, value);
    }

    function loadEventStep() {
        var v = _cache[KEY_EVENT_STEP];
        return typeof v === 'number' ? v : EVENT_STEP_DEFAULT;
    }

    function saveEventStep(step) {
        var value = typeof step === 'number' ? step : EVENT_STEP_DEFAULT;
        _cache[KEY_EVENT_STEP] = value;
        _idbPut(KEY_EVENT_STEP, value);
        _lsSet(LS_EVENT_STEP, value);
    }

    function clearEventLayer() {
        saveEventHistory([]);
        saveEventMeta({ arcs: {}, facts: {} });
        saveEventWatermark(0);
        saveEventStep(EVENT_STEP_DEFAULT);
        clearL2Embeddings();
        console.log('[Storage] 已清空 L2 事件层（eventHistory/eventMeta/watermark/step/wevt_）');
    }

    // --- L-地点 记忆层（地点信息迭代，独立 key，架构对齐 eventHistory/eventMeta）---

    /** 加载地点记忆字典：{ 地点名: {危险度,友善度,行动建议,子场景,version,lastUpdatedWeek,lastUpdatedAt} } */
    function loadLocationMemory() {
        var v = _cache[KEY_LOCATION_MEMORY];
        return (v && typeof v === 'object') ? v : {};
    }

    function saveLocationMemory(memory) {
        // 深拷贝后再存入 _cache：防止传入的 memory 引用自某个已缓存的存档/快照 payload（如 loadSaveSlot/importSavePayload/restoreFromSnapshot），
        // 若不拷贝直接引用赋值，后续 location-runner.js 等处对返回的对象做原地修改（memory[loc]=...）会“泄漏”回那个旧 payload，造成串台
        var m = (memory && typeof memory === 'object') ? structuredClone(memory) : {};
        _cache[KEY_LOCATION_MEMORY] = m;
        _idbPut(KEY_LOCATION_MEMORY, m);
        _lsSet(LS_LOCATION_MEMORY, m);
    }

    // --- locationBuff 队列（地点访问采集缓冲，FIFO，完全仿 summaryBuff，不做合并/去重）---

    function loadLocationBuffQueue() {
        var v = _cache[KEY_LOCATION_BUFF];
        return Array.isArray(v) ? v : [];
    }

    function _persistLocationBuffQueue(queue) {
        // 同上：深拷贝隔断与旧存档/快照 payload 的共享引用（enqueue/dequeue 都走这里）
        var q = Array.isArray(queue) ? structuredClone(queue) : [];
        _cache[KEY_LOCATION_BUFF] = q;
        _idbPut(KEY_LOCATION_BUFF, q);
        _lsSet(LS_LOCATION_BUFF, q);
    }

    /** 查看队首（最早一条待处理访问），不出队 */
    function peekLocationBuff() {
        var q = loadLocationBuffQueue();
        return q.length > 0 ? q[0] : null;
    }

    /** 入队：追加到队尾，不去重不合并（讨论后确认，同一地点连续两次访问严格按时序串行处理） */
    function enqueueLocationBuff(buff) {
        if (!buff || !buff.location || !buff.targetVisitId) return;
        var q = loadLocationBuffQueue();
        q.push(buff);
        _persistLocationBuffQueue(q);
        console.log('[Storage] locationBuff 入队, location=' + buff.location + ', targetVisitId=' + buff.targetVisitId + ', 队列长度=' + q.length);
    }

    /** 出队：按 targetVisitId 精确移除（不影响队列里其它地点/其它次访问） */
    function dequeueLocationBuff(targetVisitId) {
        var q = loadLocationBuffQueue();
        if (q.length === 0) return;
        var before = q.length;
        q = q.filter(function(b) { return b.targetVisitId !== targetVisitId; });
        _persistLocationBuffQueue(q);
        console.log('[Storage] locationBuff 出队, targetVisitId=' + targetVisitId + ', ' + before + ' → ' + q.length);
    }

    /** 覆盖整个队列（供快照/存档恢复使用） */
    function setLocationBuffQueue(raw) {
        _persistLocationBuffQueue(Array.isArray(raw) ? raw : []);
    }

    /** 清空整个队列（新游戏/ST导入时使用） */
    function clearLocationBuff() {
        _persistLocationBuffQueue([]);
    }

    /** 新游戏/ST导入时清空整个 L-地点 记忆层（locationMemory + locationBuff + gameData.locationVisit） */
    function clearLocationLayer() {
        saveLocationMemory({});
        clearLocationBuff();
        if (typeof gameData !== 'undefined' && gameData) gameData.locationVisit = null;
        console.log('[Storage] 已清空 L-地点 记忆层（locationMemory/locationBuff/locationVisit）');
    }

    // --- 提示词管理（promptOverrides，全局配置，不随存档走）---

    function loadPromptOverrides() {
        var v = _cache[KEY_PROMPT_OVERRIDES];
        return (v && typeof v === 'object') ? v : {};
    }

    function savePromptOverride(key, text) {
        var all = loadPromptOverrides();
        var next = {};
        for (var k in all) { if (all.hasOwnProperty(k)) next[k] = all[k]; }
        next[key] = text;
        _cache[KEY_PROMPT_OVERRIDES] = next;
        _idbPut(KEY_PROMPT_OVERRIDES, next);
        _lsSet(LS_PROMPT_OVERRIDES, next);
    }

    function resetPromptOverride(key) {
        var all = loadPromptOverrides();
        if (!all.hasOwnProperty(key)) return;
        var next = {};
        for (var k in all) { if (all.hasOwnProperty(k) && k !== key) next[k] = all[k]; }
        _cache[KEY_PROMPT_OVERRIDES] = next;
        _idbPut(KEY_PROMPT_OVERRIDES, next);
        _lsSet(LS_PROMPT_OVERRIDES, next);
    }

    // --- 自定义世界书（customWorldbook，全局配置，不随存档走）---

    function _wbKey(slot) { return (slot === '2') ? KEY_CUSTOM_WORLDBOOK_2 : KEY_CUSTOM_WORLDBOOK; }
    function _wbLsKey(slot) { return (slot === '2') ? LS_CUSTOM_WORLDBOOK_2 : LS_CUSTOM_WORLDBOOK; }

    function loadCustomWorldbook(slot) {
        var v = _cache[_wbKey(slot)];
        return Array.isArray(v) ? v : [];
    }

    function saveCustomWorldbook(slot, list) {
        var value = Array.isArray(list) ? list : [];
        var key = _wbKey(slot);
        _cache[key] = value;
        _idbPut(key, value);
        _lsSet(_wbLsKey(slot), value);
    }

    // --- 全量快照（snapshot_db）---

    function _idbSnapshotPut(key, value) {
        if (!_idbSnapshotAvailable) return;
        idbSnapshot.put(key, value).catch(function(e) {
            _reportWriteError('snapshotDB', key, e);
        });
    }

    var _SNAPSHOT_KEYS = ['appState', 'uiConversation', 'summaryHistory', 'weekHistory', 'markWeekUiIndex', 'summaryBuff', 'lastUserMessage', 'eventHistory', 'eventMeta', 'eventWatermark', 'eventStep', 'locationMemory', 'locationBuff'];

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
            summaryBuff:     structuredClone(getSummaryBuffQueue()),
            lastUserMessage: (typeof lastUserMessage !== 'undefined') ? lastUserMessage : '',
            eventHistory:    structuredClone(loadEventHistory()),
            eventMeta:       structuredClone(loadEventMeta()),
            eventWatermark:  loadEventWatermark(),
            eventStep:       loadEventStep(),
            locationMemory:  structuredClone(loadLocationMemory()),
            locationBuff:    structuredClone(loadLocationBuffQueue())
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
                idbSnapshot.put('lastUserMessage', snap.lastUserMessage),
                idbSnapshot.put('eventHistory',    snap.eventHistory),
                idbSnapshot.put('eventMeta',       snap.eventMeta),
                idbSnapshot.put('eventWatermark',  snap.eventWatermark),
                idbSnapshot.put('eventStep',       snap.eventStep),
                idbSnapshot.put('locationMemory',  snap.locationMemory),
                idbSnapshot.put('locationBuff',    snap.locationBuff)
            ]);
        }
        // localStorage 降级：仅在快照库不可用时存体积可控的字段
        _lsSnapSet(LS_SNAPSHOT_APPSTATE, snap.appState);
        _lsSnapSet(LS_SNAPSHOT_LAST_MSG, snap.lastUserMessage);
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
            // 深拷贝隔断：snap.appState.gameData 虽是快照创建时 structuredClone 出来的独立对象，
            // 但 mergeWithDefaults 不克隆数组字段，合并后仍会与 _snapshotCache 共享引用；
            // 这里再克隆一次，避免下一次读取 _snapshotCache 时被此前的原地修改污染
            var _snapGameDataClone = structuredClone(snap.appState.gameData);
            if (typeof mergeWithDefaults === 'function' && typeof defaultGameData !== 'undefined') {
                gameData = mergeWithDefaults(_snapGameDataClone, defaultGameData);
            } else if (typeof gameData !== 'undefined') {
                gameData = _snapGameDataClone;
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

        // 还原 summaryBuff 队列（兼容旧单槽格式）
        setSummaryBuffQueue(snap.summaryBuff);

        // 还原 L2 事件层（wevt_ 向量不在快照，由下一轮 _syncL2 删孤补缺自愈）
        saveEventHistory(Array.isArray(snap.eventHistory) ? snap.eventHistory : []);
        saveEventMeta(snap.eventMeta || { arcs: {}, facts: {} });
        saveEventWatermark(typeof snap.eventWatermark === 'number' ? snap.eventWatermark : 0);
        saveEventStep(typeof snap.eventStep === 'number' ? snap.eventStep : EVENT_STEP_DEFAULT);

        // 还原 L-地点 记忆层
        saveLocationMemory(snap.locationMemory || {});
        setLocationBuffQueue(snap.locationBuff);

        console.log('[Storage] 已从快照还原状态');
        // 存档回滚：GAL 演出硬重置（同步清层，不播翻页纸，清 commit 记忆）
        if (typeof galPresentation !== 'undefined' && galPresentation && typeof galPresentation.reset === 'function') {
            try { galPresentation.reset(); } catch (e) {}
        }
        // The data is already restored. Reconcile only presentation, preserving special pages.
        if (typeof window !== 'undefined' && window.GameSceneBridge) {
            window.GameSceneBridge.afterRestore('snapshot-restored', true);
        }
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
        _lsSnapSet(LS_SNAPSHOT_LAST_MSG, msg);
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

    // --- summaryBuff 队列（周总结优化：待总结的正文缓冲，FIFO 队列）---

    // 归一化为数组：兼容旧单槽格式（单对象）与新队列格式（数组）
    function _normalizeSummaryBuffQueue(raw) {
        if (Array.isArray(raw)) {
            return raw.filter(function(b) { return b && typeof b === 'object'; });
        }
        if (raw && typeof raw === 'object') return [raw];
        return [];
    }

    function _persistSummaryBuffQueue(queue) {
        var q = Array.isArray(queue) ? queue : [];
        _cache[KEY_SUMMARY_BUFF] = q;
        _idbPut(KEY_SUMMARY_BUFF, q);
        _lsSet(LS_SUMMARY_BUFF, q);
    }

    // 读取整个队列（FIFO，队首为最早待总结条目）
    function getSummaryBuffQueue() {
        return _normalizeSummaryBuffQueue(_cache[KEY_SUMMARY_BUFF]);
    }

    // 覆盖整个队列（兼容旧单槽格式，供存档 / 快照还原使用）
    function setSummaryBuffQueue(raw) {
        _persistSummaryBuffQueue(_normalizeSummaryBuffQueue(raw));
    }

    // 查看队首（最早一条），不出队
    function peekSummaryBuff() {
        var q = getSummaryBuffQueue();
        return q.length > 0 ? q[0] : null;
    }

    // 入队：追加到队尾；若已存在同一 targetMarkWeek 条目则原地替换（避免同周重复堆积）
    function enqueueSummaryBuff(buff) {
        if (!buff || !buff.targetMarkWeek) return;
        var q = getSummaryBuffQueue();
        var replaced = false;
        for (var i = 0; i < q.length; i++) {
            if (q[i].targetMarkWeek === buff.targetMarkWeek) {
                q[i] = buff;
                replaced = true;
                break;
            }
        }
        if (!replaced) q.push(buff);
        _persistSummaryBuffQueue(q);
        console.log('[Storage] summaryBuff 入队' + (replaced ? '(替换)' : '') + ', targetMarkWeek=' + buff.targetMarkWeek + ', 队列长度=' + q.length);
    }

    // 出队：移除指定 targetMarkWeek 条目；未指定则移除队首
    function dequeueSummaryBuff(targetMarkWeek) {
        var q = getSummaryBuffQueue();
        if (q.length === 0) return;
        var before = q.length;
        if (typeof targetMarkWeek === 'undefined' || targetMarkWeek === null) {
            q.shift();
        } else {
            q = q.filter(function(b) { return b.targetMarkWeek !== targetMarkWeek; });
        }
        _persistSummaryBuffQueue(q);
        console.log('[Storage] summaryBuff 出队, targetMarkWeek=' + targetMarkWeek + ', ' + before + ' → ' + q.length);
    }

    // 轮转：将指定 targetMarkWeek 条目移到队尾（失败重试时调用，避免队头阻塞后续周）
    // 按 targetMarkWeek 精确定位，与队列位置无关；runSummary 替换 runTurn 也是按 targetMarkWeek 匹配，不受轮转影响
    function rotateSummaryBuff(targetMarkWeek) {
        var q = getSummaryBuffQueue();
        if (q.length <= 1) return; // 0 或 1 条无需轮转（原地重试即可）
        var idx = -1;
        for (var i = 0; i < q.length; i++) {
            if (q[i].targetMarkWeek === targetMarkWeek) { idx = i; break; }
        }
        if (idx === -1) return; // 不在队列中（可能已出队）
        var item = q.splice(idx, 1)[0];
        q.push(item);
        _persistSummaryBuffQueue(q);
        console.log('[Storage] summaryBuff 轮转至队尾, targetMarkWeek=' + targetMarkWeek + ', 队列长度=' + q.length);
    }

    // 清空整个队列（新游戏 / 读档重置）
    function clearSummaryBuff() {
        _persistSummaryBuffQueue([]);
    }

    // --- Summary History (供 summaryHistoryService 使用) ---

    function loadSummaryHistory() {
        return _cache[KEY_SUMMARY_HISTORY] || [];
    }

    function saveSummaryHistory(history) {
        // 深拷贝隔断与旧存档/快照 payload 的共享引用（同 saveEventHistory/saveWeekHistory 等的加固）
        var h = Array.isArray(history) ? structuredClone(history) : [];
        _cache[KEY_SUMMARY_HISTORY] = h;
        _idbPut(KEY_SUMMARY_HISTORY, h);
        _lsSet(LS_SUMMARY_HISTORY, h);
    }

    // --- Week History (供 weekHistoryService 使用，仅 index 独立前端链路) ---

    function loadWeekHistory() {
        return _cache[KEY_WEEK_HISTORY] || [];
    }

    function saveWeekHistory(history) {
        // 深拷贝隔断与旧存档/快照 payload 的共享引用（week-history-service.js 的 replaceByMarkWeek() 会对记录元素原地改 summaryText/source）
        var h = Array.isArray(history) ? structuredClone(history) : [];
        _cache[KEY_WEEK_HISTORY] = h;
        _idbPut(KEY_WEEK_HISTORY, h);
        _lsSet(LS_WEEK_HISTORY, h);
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

    // 序列化 L2 事件向量（Float32Array → number[]，供存档导出）
    function _serializeL2Embeddings() {
        var recs = loadAllL2Embeddings();
        return recs.map(function(r) {
            var vec = r.vector;
            var arr = (vec instanceof Float32Array) ? Array.from(vec) : (Array.isArray(vec) ? vec : []);
            return { id: r.id, vector: arr, text: r.text || '', week: r.week || 0, fingerprint: r.fingerprint || '', createdAt: r.createdAt || 0, type: 'event' };
        });
    }

    // 恢复 L2 事件层（存档导入/读档用）：先清空再写入 eventHistory/eventMeta/watermark/step + wevt_
    function _restoreL2FromPayload(payload) {
        clearL2Embeddings();
        saveEventHistory(Array.isArray(payload.eventHistory) ? payload.eventHistory : []);
        saveEventMeta(payload.eventMeta || { arcs: {}, facts: {} });
        saveEventWatermark(typeof payload.eventWatermark === 'number' ? payload.eventWatermark : 0);
        saveEventStep(typeof payload.eventStep === 'number' ? payload.eventStep : EVENT_STEP_DEFAULT);
        if (Array.isArray(payload.l2Embeddings) && payload.l2Embeddings.length > 0) {
            for (var i = 0; i < payload.l2Embeddings.length; i++) {
                var er = payload.l2Embeddings[i];
                if (!er || !er.id) continue;
                var f32 = new Float32Array(Array.isArray(er.vector) ? er.vector : []);
                saveL2Embedding(er.id, f32, {
                    text: er.text || '', week: er.week || 0,
                    fingerprint: er.fingerprint || '', createdAt: er.createdAt || 0
                });
            }
            console.log('[Storage] 已恢复 ' + payload.l2Embeddings.length + ' 条 L2 事件向量');
        }
        if (typeof memoryRecall !== 'undefined' && memoryRecall.clearCacheL2) {
            memoryRecall.clearCacheL2();
            if (memoryRecall.initL2) memoryRecall.initL2();
        }
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
        var l2Export = _serializeL2Embeddings();
        var payload = {
            id: id,
            saveName: saveName,
            gameData: (typeof gameData !== 'undefined') ? structuredClone(gameData) : null,
            summaryHistory: (typeof summaryHistoryService !== 'undefined') ? structuredClone(summaryHistoryService.getAll()) : [],
            weekHistory: (typeof weekHistoryService !== 'undefined') ? structuredClone(weekHistoryService.getAll()) : [],
            markWeekUiIndex: getMarkWeekUiIndex(),
            summaryBuff: structuredClone(getSummaryBuffQueue()),
            uiConversation: structuredClone(loadUIConversation()),
            embeddings: embExport,
            eventHistory: structuredClone(loadEventHistory()),
            eventMeta: structuredClone(loadEventMeta()),
            eventWatermark: loadEventWatermark(),
            eventStep: loadEventStep(),
            l2Embeddings: l2Export,
            locationMemory: structuredClone(loadLocationMemory()),
            locationBuff: structuredClone(loadLocationBuffQueue()),
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
        setSummaryBuffQueue(payload.summaryBuff);
        console.log('[Storage] 已恢复 summaryBuff 队列, 条数=' + getSummaryBuffQueue().length);

        // 恢复 L2 事件层（eventHistory/eventMeta/watermark/step + wevt_ 向量）
        _restoreL2FromPayload(payload);

        // 恢复 L-地点 记忆层（locationMemory/locationBuff；老存档/ST导入无此字段时回退空字典/空队列）
        saveLocationMemory(payload.locationMemory || {});
        setLocationBuffQueue(payload.locationBuff);
        console.log('[Storage] 已恢复 locationMemory(' + Object.keys(payload.locationMemory || {}).length + '个地点) / locationBuff(' + (Array.isArray(payload.locationBuff) ? payload.locationBuff.length : 0) + '条)');

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

    function buildSavePayload(saveName, includeVectors) {
        // includeVectors 默认 true；传 false 时不写入 embeddings/l2Embeddings，可大幅减小体积
        var _inclVec = (includeVectors !== false);
        var embExport = [];
        if (_inclVec) {
            // Phase 3：序列化 embeddings（Float32Array → number[] 保证 JSON 兼容）
            var embRecords = loadAllEmbeddings();
            embExport = embRecords.map(function(r) {
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
        }
        return {
            saveName: saveName,
            gameData: (typeof gameData !== 'undefined') ? gameData : null,
            summaryHistory: (typeof summaryHistoryService !== 'undefined') ? summaryHistoryService.getAll() : [],
            weekHistory: (typeof weekHistoryService !== 'undefined') ? weekHistoryService.getAll() : [],
            markWeekUiIndex: getMarkWeekUiIndex(),
            summaryBuff: getSummaryBuffQueue(),
            uiConversation: loadUIConversation(),
            embeddings: embExport,
            eventHistory: loadEventHistory(),
            eventMeta: loadEventMeta(),
            eventWatermark: loadEventWatermark(),
            eventStep: loadEventStep(),
            l2Embeddings: _inclVec ? _serializeL2Embeddings() : [],
            locationMemory: loadLocationMemory(),
            locationBuff: loadLocationBuffQueue(),
            createdAt: Date.now()
        };
    }

    function exportSaveToJson(saveName, includeVectors) {
        var payload = buildSavePayload(saveName, includeVectors);
        return JSON.stringify(payload);
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
        // 安卓 WebView 环境：优先系统分享，失败则弹复制框
        var isCapacitorWebView = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        if (isCapacitorWebView) {
            // 使用 Capacitor 原生插件：写文件 → 调用 Android 原生分享 Intent
            var Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
            var Share = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
            if (Filesystem && Share) {
                return Filesystem.writeFile({
                    path: filename,
                    data: jsonString,
                    directory: 'CACHE',
                    encoding: 'utf8'
                }).then(function(result) {
                    return Share.share({
                        title: filename,
                        files: [result.uri]
                    });
                }).then(function() {
                    return 'shared';
                }).catch(function(e) {
                    console.log('[exportSave] native share error:', e.name, e.message);
                    if (e && (e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('cancel')))) return 'abort';
                    _showJsonCopyModal(filename, jsonString);
                    return 'modal';
                });
            }
            // Capacitor 插件不可用时：弹复制框兜底
            console.log('[exportSave] Capacitor plugins not available, showing copy modal');
            _showJsonCopyModal(filename, jsonString);
            return Promise.resolve('modal');
        }
        // 网页 / ST 环境：普通 <a download>
        _downloadJsonFallback(blob, filename);
        return Promise.resolve('download');
    }

    // 在 WebView 中弹出 JSON 内容框，供用户手动复制
    function _showJsonCopyModal(filename, jsonString) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:99999;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px;';
        var inner = document.createElement('div');
        inner.style.cssText = 'background:#1a1a2e;border:1px solid #555;border-radius:12px;padding:16px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-sizing:border-box;gap:8px;';
        var title = document.createElement('div');
        title.style.cssText = 'color:#c8a96e;font-size:14px;';
        title.textContent = '导出存档';
        var hint = document.createElement('div');
        hint.style.cssText = 'color:#888;font-size:11px;';
        hint.textContent = filename + ' — 全选复制后粘贴保存';
        var ta = document.createElement('textarea');
        ta.readOnly = true;
        ta.value = jsonString;
        ta.style.cssText = 'flex:1;min-height:180px;height:180px;background:#111;color:#ccc;border:1px solid #333;border-radius:6px;padding:8px;font-size:10px;resize:none;font-family:monospace;word-break:break-all;';
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;';
        var copyBtn = document.createElement('button');
        copyBtn.textContent = '全选复制';
        copyBtn.style.cssText = 'flex:1;padding:10px;background:#4a7c59;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;';
        copyBtn.onclick = function() {
            ta.select();
            ta.setSelectionRange(0, 99999);
            var ok = false;
            try { ok = document.execCommand('copy'); } catch(e) {}
            if (!ok && navigator.clipboard) {
                navigator.clipboard.writeText(jsonString).catch(function(){});
                ok = true;
            }
            copyBtn.textContent = ok ? '✓ 已复制' : '复制失败，请手动选中';
        };
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = 'flex:1;padding:10px;background:#444;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;';
        closeBtn.onclick = function() { document.body.removeChild(overlay); };
        btnRow.appendChild(copyBtn);
        btnRow.appendChild(closeBtn);
        inner.appendChild(title);
        inner.appendChild(hint);
        inner.appendChild(ta);
        inner.appendChild(btnRow);
        overlay.appendChild(inner);
        document.body.appendChild(overlay);
    }

    function _downloadJsonFallback(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- 公开接口 ---

    return {
        init: init,
        getStorageDiagnostics: getStorageDiagnostics,
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
        getSummaryBuffQueue: getSummaryBuffQueue,
        setSummaryBuffQueue: setSummaryBuffQueue,
        peekSummaryBuff: peekSummaryBuff,
        enqueueSummaryBuff: enqueueSummaryBuff,
        dequeueSummaryBuff: dequeueSummaryBuff,
        rotateSummaryBuff: rotateSummaryBuff,
        clearSummaryBuff: clearSummaryBuff,
        loadSummaryHistory: loadSummaryHistory,
        saveSummaryHistory: saveSummaryHistory,
        loadWeekHistory: loadWeekHistory,
        saveWeekHistory: saveWeekHistory,
        saveEmbedding: saveEmbedding,
        loadAllEmbeddings: loadAllEmbeddings,
        deleteEmbedding: deleteEmbedding,
        clearEmbeddings: clearEmbeddings,
        saveL2Embedding: saveL2Embedding,
        loadAllL2Embeddings: loadAllL2Embeddings,
        deleteL2Embedding: deleteL2Embedding,
        clearL2Embeddings: clearL2Embeddings,
        loadEventHistory: loadEventHistory,
        saveEventHistory: saveEventHistory,
        loadEventMeta: loadEventMeta,
        saveEventMeta: saveEventMeta,
        loadEventWatermark: loadEventWatermark,
        saveEventWatermark: saveEventWatermark,
        loadEventStep: loadEventStep,
        saveEventStep: saveEventStep,
        clearEventLayer: clearEventLayer,
        loadLocationMemory: loadLocationMemory,
        saveLocationMemory: saveLocationMemory,
        loadLocationBuffQueue: loadLocationBuffQueue,
        peekLocationBuff: peekLocationBuff,
        enqueueLocationBuff: enqueueLocationBuff,
        dequeueLocationBuff: dequeueLocationBuff,
        setLocationBuffQueue: setLocationBuffQueue,
        clearLocationBuff: clearLocationBuff,
        clearLocationLayer: clearLocationLayer,
        loadPromptOverrides: loadPromptOverrides,
        savePromptOverride: savePromptOverride,
        resetPromptOverride: resetPromptOverride,
        loadCustomWorldbook: loadCustomWorldbook,
        saveCustomWorldbook: saveCustomWorldbook,
        restoreL2FromPayload: _restoreL2FromPayload,
        serializeL2Embeddings: _serializeL2Embeddings,
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