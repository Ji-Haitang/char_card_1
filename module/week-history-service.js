/**
 * week-history-service.js - 周摘要历史管理（仅 index 独立前端链路）
 *
 * 每当 newWeek===1 时，当轮 SUMMARY 进入 weekHistory，不进入 summaryHistory，
 * 不进行向量化，不参与召回。
 *
 * 依赖：storageService（在本文件之前加载）
 */

var weekHistoryService = (function() {

    function load() {
        if (typeof storageService !== 'undefined' && storageService.loadWeekHistory) {
            return storageService.loadWeekHistory();
        }
        try {
            var raw = localStorage.getItem('jxz_weekHistory');
            if (!raw || raw === 'undefined' || raw === 'null') return [];
            return JSON.parse(raw) || [];
        } catch (e) { return []; }
    }

    function save(history) {
        if (typeof storageService !== 'undefined' && storageService.saveWeekHistory) {
            storageService.saveWeekHistory(history);
            return;
        }
        try { localStorage.setItem('jxz_weekHistory', JSON.stringify(history)); } catch (e) {}
    }

    function _uuid() {
        return 'w' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    }

    /**
     * 添加一条周摘要记录
     * @param {string[]} summaries - SUMMARY 文本数组
     * @param {string} [source] - 来源标记
     */
    function append(summaries, source) {
        var history = load();
        if (!summaries || summaries.length === 0) return history;
        var recordSource = source || 'runTurn';
        var _cw = typeof currentWeek !== 'undefined' ? currentWeek : 1;
        var _suffix = '\n[至' + (_cw - 1) + '周的历史记录]';
        for (var i = 0; i < summaries.length; i++) {
            history.push({
                id: _uuid(),
                week: _cw,
                markWeek: typeof markWeek !== 'undefined' ? markWeek : 1,
                summaryText: summaries[i] + _suffix,
                source: recordSource,
                createdAt: Date.now()
            });
        }
        save(history);
        console.log('[WeekHistory] 已添加周摘要，当前共 ' + history.length + ' 条');
        return history;
    }

    function getAll() { return load(); }

    /** 弹出最近一条周摘要（重生成回退用） */
    function popLast() {
        var history = load();
        if (history.length === 0) return history;
        history.pop();
        save(history);
        console.log('[WeekHistory] popLast，剩余 ' + history.length + ' 条');
        return history;
    }

    function clear() { save([]); }

    function importAll(arr) {
        save(Array.isArray(arr) ? arr.slice() : []);
    }

    /**
     * 检查是否已存在 source==='runSummary' 的最终版本条目
     * @param {number} targetMarkWeek
     */
    function hasRunSummaryEntry(targetMarkWeek) {
        var history = load();
        for (var i = 0; i < history.length; i++) {
            if (history[i].markWeek === targetMarkWeek && history[i].source === 'runSummary') {
                return true;
            }
        }
        return false;
    }

    /**
     * 按 markWeek 替换条目的 summaryText 和 source（找不到则静默跳过）
     * 注意：不更新 createdAt，保留初版写入时的时间戳，供 _confirmRegenerate 时序比较使用
     * @param {number} targetMarkWeek
     * @param {string} newText
     * @param {string} newSource
     */
    function replaceByMarkWeek(targetMarkWeek, newText, newSource) {
        var history = load();
        var found = false;
        for (var i = 0; i < history.length; i++) {
            if (history[i].markWeek === targetMarkWeek) {
                var _cw = history[i].week || targetMarkWeek;
                var _suffix = '\n[至' + (_cw - 1) + '周的历史记录]';
                history[i].summaryText = newText + _suffix;
                history[i].source = newSource || 'runSummary';
                // 不更新 createdAt：保留初版写入时的原始时间戳
                found = true;
                break;
            }
        }
        if (found) {
            save(history);
            console.log('[WeekHistory] replaceByMarkWeek 成功, markWeek=' + targetMarkWeek + ', source=' + (newSource || 'runSummary'));
        } else {
            console.log('[WeekHistory] replaceByMarkWeek 未找到条目, markWeek=' + targetMarkWeek + ', 跳过');
        }
        return found;
    }

    return { append: append, getAll: getAll, popLast: popLast, clear: clear, importAll: importAll, load: load, save: save, hasRunSummaryEntry: hasRunSummaryEntry, replaceByMarkWeek: replaceByMarkWeek };
})();
