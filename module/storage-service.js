/**
 * storage-service.js - localStorage 存储抽象
 * 
 * Phase 1 的轻量存储层，区分 UI 历史与 SUMMARY 历史。
 * 大数据后续 Phase 2 升级到 IndexedDB。
 * 
 * 依赖：无
 */

var storageService = (function() {
    var APP_STATE_KEY = 'jxz_appState';
    var UI_CONV_KEY = 'jxz_uiConversation';
    var SNAPSHOT_KEY = 'jxz_snapshot';

    /** 加载运行态数据 */
    function loadAppState() {
        try {
            var raw = localStorage.getItem(APP_STATE_KEY);
            if (raw) {
                return JSON.parse(raw);
            }
        } catch (e) {
            console.warn('loadAppState 失败', e);
        }
        return null;
    }

    /** 保存运行态数据 */
    function saveAppState(state) {
        try {
            localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('saveAppState 失败', e);
        }
    }

    /** 加载 UI 对话历史（页面展示用） */
    function loadUIConversation() {
        try {
            var raw = localStorage.getItem(UI_CONV_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    /** 追加一条 UI 对话记录 */
    function appendUIConversation(msg) {
        var history = loadUIConversation();
        history.push(msg);
        try {
            localStorage.setItem(UI_CONV_KEY, JSON.stringify(history));
        } catch (e) {
            console.warn('appendUIConversation 失败', e);
        }
    }

    /** 清空 UI 对话历史（新游戏时调用） */
    function clearUIConversation() {
        localStorage.removeItem(UI_CONV_KEY);
    }

    /** 清空摘要历史（新游戏时调用） */
    function clearSummaryHistory() {
        localStorage.removeItem('jxz_summaryHistory');
    }

    /** 弹出最后一条 assistant 消息（用于重新生成） */
    function popLastAssistantUI() {
        var history = loadUIConversation();
        for (var i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'assistant') {
                history.splice(i, 1);
                break;
            }
        }
        try {
            localStorage.setItem(UI_CONV_KEY, JSON.stringify(history));
        } catch (e) {
            console.warn('popLastAssistantUI 失败', e);
        }
    }

    /** 构建存档 payload */
    function buildSavePayload(saveName) {
        return {
            saveName: saveName,
            gameData: gameData,
            summaryHistory: summaryHistoryService.getAll(),
            uiConversation: loadUIConversation(),
            snapshot: loadSnapshot(),
            createdAt: Date.now()
        };
    }

    /** 导出存档为 JSON */
    function exportSaveToJson(saveName) {
        var payload = buildSavePayload(saveName);
        return JSON.stringify(payload, null, 2);
    }

    /** 从 JSON 导入存档 */
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

    /** 下载 JSON 文件 */
    function downloadJson(filename, jsonString) {
        var blob = new Blob([jsonString], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /** 浏览器内存档列表（Phase 1 用 localStorage 简存） */
    var SAVES_KEY = 'jxz_saves';

    function listSaves() {
        try {
            var raw = localStorage.getItem(SAVES_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function createSave(saveName) {
        var saves = listSaves();
        var id = 'save_' + Date.now();
        var payload = {
            id: id,
            saveName: saveName,
            gameData: gameData,
            summaryHistory: summaryHistoryService.getAll(),
            uiConversation: loadUIConversation(),
            snapshot: loadSnapshot(),
            previewWeek: gameData && gameData.currentWeek,
            previewLocation: gameData && gameData.mapLocation,
            createdAt: Date.now()
        };
        saves.push(payload);
        // 限制最多 10 个存档
        if (saves.length > 10) saves.shift();
        localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
        return id;
    }

    function loadSave(saveId) {
        var saves = listSaves();
        for (var i = 0; i < saves.length; i++) {
            if (saves[i].id === saveId) return saves[i];
        }
        return null;
    }

    function deleteSave(saveId) {
        var saves = listSaves().filter(function(s) { return s.id !== saveId; });
        localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
    }

    /** 保存发送时快照（用于重生成回退） */
    function saveSnapshot(gd) {
        try {
            localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(gd));
        } catch (e) {
            console.warn('saveSnapshot 失败', e);
        }
    }

    /** 加载发送时快照 */
    function loadSnapshot() {
        try {
            var raw = localStorage.getItem(SNAPSHOT_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.warn('loadSnapshot 失败', e);
            return null;
        }
    }

    /** 是否有快照可回退 */
    function hasSnapshot() {
        return localStorage.getItem(SNAPSHOT_KEY) !== null;
    }

    /** 清除快照 */
    function clearSnapshot() {
        localStorage.removeItem(SNAPSHOT_KEY);
    }

    return {
        loadAppState: loadAppState,
        saveAppState: saveAppState,
        loadUIConversation: loadUIConversation,
        appendUIConversation: appendUIConversation,
        clearUIConversation: clearUIConversation,
        clearSummaryHistory: clearSummaryHistory,
        popLastAssistantUI: popLastAssistantUI,
        buildSavePayload: buildSavePayload,
        exportSaveToJson: exportSaveToJson,
        importSaveFromJson: importSaveFromJson,
        downloadJson: downloadJson,
        listSaves: listSaves,
        createSave: createSave,
        loadSave: loadSave,
        deleteSave: deleteSave,
        saveSnapshot: saveSnapshot,
        loadSnapshot: loadSnapshot,
        hasSnapshot: hasSnapshot,
        clearSnapshot: clearSnapshot
    };
})();
