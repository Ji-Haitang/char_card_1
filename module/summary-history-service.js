/**
 * summary-history-service.js - 摘要历史管理
 * 保存 <SUMMARY> 历史、构建 <RecentHistory>、超窗丢弃旧摘要
 * 
 * Phase 2.2：委托 storageService 进行持久化（Write-Through Cache）
 * 依赖：storageService（可选，降级到 localStorage）
 */

var summaryHistoryService = (function() {
    var STORAGE_KEY = 'jxz_summaryHistory';
    var MAX_ITEMS = 20;
    var MAX_TOKENS = 2000;

    /** 加载已保存的摘要历史 */
    function load() {
        // 优先通过 storageService（走缓存，同步）
        if (typeof storageService !== 'undefined' && storageService.loadSummaryHistory) {
            return storageService.loadSummaryHistory();
        }
        // 降级
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw || raw === 'undefined' || raw === 'null') return [];
            return JSON.parse(raw) || [];
        } catch (e) {
            console.warn('加载摘要历史失败', e);
            return [];
        }
    }

    /** 保存摘要历史 */
    function save(summaryHistory) {
        if (typeof storageService !== 'undefined' && storageService.saveSummaryHistory) {
            storageService.saveSummaryHistory(summaryHistory);
            return;
        }
        // 降级
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(summaryHistory));
        } catch (e) {
            console.warn('保存摘要历史失败', e);
        }
    }

    /** 添加新的摘要记录 */
    // @param {string} [source] - 来源标记：'llm'（默认，LLM正常生成）| 'special_event'（预设特殊剧情）
    // @param {string} [UIid] - 对应 uiConversation 中 assistant 消息的 id（用于向量化时关联地点/NPC元数据）
    function append(summaries, source, UIid) {
        var history = load();
        if (!summaries || summaries.length === 0) return history;
        var recordSource = source || 'llm';

        for (var i = 0; i < summaries.length; i++) {
            var _record = {
                id: _uuid(),
                week: typeof currentWeek !== 'undefined' ? currentWeek : 1,
                gameTime: typeof currentGameTime !== 'undefined' ? currentGameTime : '',
                summaryText: summaries[i],
                source: recordSource,
                createdAt: Date.now()
            };
            if (UIid) _record.UIid = UIid;
            history.push(_record);
        }

        trim(history);
        save(history);
        return history;
    }

    /** 弹出最近一条摘要（用于重新生成） */
    function popLast() {
        var history = load();
        history.pop();
        save(history);
        return history;
    }

    /** 获取摘要历史 */
    function getAll() {
        return load();
    }

    /** 窗口裁剪（保留完整历史，不做裁剪；prompt 层按 token 预算自行选取） */
    function trim(history) {
        return history;
    }

    function trimWindow() {
        // 不再裁剪，完整保留所有摘要历史
    }

    function _fastEstimateTokens(text) {
        if (typeof tokenUtils !== 'undefined') return tokenUtils.estimate(text);
        if (!text) return 0;
        var cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length;
        var raw = Math.ceil(cjk * 1.5 + (text.length - cjk) / 4);
        return Math.ceil(raw * 1.1);
    }

    function _uuid() {
        return 's' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    }

    /** 清空所有摘要历史 */
    function clear() {
        save([]);
    }

    /** 导入全部摘要历史（读档用） */
    function importAll(arr) {
        var history = Array.isArray(arr) ? arr.slice() : [];
        save(history);
    }

    /** 从 summary_Small 字符串重建摘要历史（降级方案，用于老存档 summaryHistory 为空的情况） */
    function rebuildFromSummarySmall(summarySmallStr) {
        if (!summarySmallStr || typeof summarySmallStr !== 'string') return;
        var blocks = summarySmallStr.split(/\n\n/).filter(function(b) { return b.trim(); });
        var history = [];
        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i].trim();
            var text = block.replace(/^\[第\d+年第\d+月第\d+周\]\n?/, '').trim();
            if (text) {
                history.push({
                    id: _uuid(),
                    week: 1,
                    summaryText: text,
                    createdAt: Date.now()
                });
            }
        }
        if (history.length > 0) {
            save(history);
        }
    }

    return { load: load, save: save, append: append, popLast: popLast, getAll: getAll, trimWindow: trimWindow, clear: clear, importAll: importAll, rebuildFromSummarySmall: rebuildFromSummarySmall };
})();
