/**
 * reranker.js - 交叉编码重排序（硅基流动 bge-reranker-v2-m3）
 * 向量化方案优化2 · 3.5 重排序
 *
 * 用途：L2 双路 RRF 粗排后、因果链/挂载之前，对 L2 候选事件做一道精排，
 *       取 top-N 精事件再去做因果追溯与挂载。
 *
 * - 模型：BAAI/bge-reranker-v2-m3，硅基 /rerank（OpenAI 风格 documents/query）
 * - 单 key（本项目暂无多 key 设施）：复用 embeddingService 的 endpoint/apiKey
 * - 超时 / 失败 → fallback 回 RRF 粗排顺序（不阻断主流程）
 *
 * 依赖：embeddingService（取 endpoint/apiKey）
 */

var reranker = (function() {

    var DEFAULT_MODEL = 'BAAI/bge-reranker-v2-m3';
    var DEFAULT_TIMEOUT = 15000;

    /**
     * 取单 key（embeddingService 的 apiKey 可能多 key 分隔，这里只取第一个）
     */
    function _getKey() {
        if (typeof embeddingService === 'undefined') return null;
        var cfg = embeddingService.getConfig();
        var raw = String(cfg.apiKey || '');
        var keys = raw.split(/[,;|\n]+/).map(function(k) { return k.trim(); }).filter(function(k) { return k.length > 0; });
        return keys.length > 0 ? keys[0] : null;
    }

    function _getBaseUrl() {
        var cfg = (typeof embeddingService !== 'undefined') ? embeddingService.getConfig() : {};
        return (cfg.endpoint || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
    }

    function _getModel() {
        var cfg = (typeof embeddingService !== 'undefined') ? embeddingService.getConfig() : {};
        return cfg.rerankModel || DEFAULT_MODEL;
    }

    /**
     * 对候选列表重排序。
     * @param {string} query - 自然语言查询（焦点在前）
     * @param {Array} candidates - [{ id, text, ... }]，text 为可读文本
     * @param {object} [options] - { topN=10, minScore=0.10, timeout }
     * @returns {Promise<Array>} 重排后的候选子集（保留原对象，附加 rerankScore）。
     *          失败/超时返回原 candidates（fallback，不截断）。
     */
    async function rerankEvents(query, candidates, options) {
        options = options || {};
        var topN = typeof options.topN === 'number' ? options.topN : 10;
        var minScore = typeof options.minScore === 'number' ? options.minScore : 0.10;
        var timeout = options.timeout || DEFAULT_TIMEOUT;

        if (!Array.isArray(candidates) || candidates.length === 0) return [];
        if (!query || !query.trim()) return candidates.slice(0, topN);
        // 候选不超过 topN 时无需精排
        if (candidates.length <= 1) return candidates.slice(0, topN);

        var key = _getKey();
        if (!key) {
            console.warn('[Reranker] 未配置 API Key，跳过重排，回退 RRF 顺序');
            return candidates.slice(0, topN);
        }

        var documents = candidates.map(function(c) { return c.text || ''; });
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, timeout);

        try {
            var response = await fetch(_getBaseUrl() + '/rerank', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: _getModel(),
                    query: query,
                    documents: documents,
                    top_n: Math.min(documents.length, Math.max(topN, 1)),
                    return_documents: false
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                var errText = '';
                try { errText = await response.text(); } catch (_) {}
                throw new Error('HTTP ' + response.status + ': ' + errText.slice(0, 200));
            }

            var data = await response.json();
            if (!data || !Array.isArray(data.results)) {
                throw new Error('响应格式异常：缺少 results 字段');
            }

            // results: [{ index, relevance_score }]，按 relevance_score 降序
            var ranked = data.results.slice().sort(function(a, b) {
                return (b.relevance_score || 0) - (a.relevance_score || 0);
            });

            var out = [];
            for (var i = 0; i < ranked.length && out.length < topN; i++) {
                var idx = ranked[i].index;
                var score = ranked[i].relevance_score || 0;
                if (idx == null || idx < 0 || idx >= candidates.length) continue;
                if (score < minScore) continue;
                var item = candidates[idx];
                item.rerankScore = score;
                out.push(item);
            }

            console.log('[Reranker] 精排 ' + candidates.length + ' → ' + out.length + ' 条（topN=' + topN + ', minScore=' + minScore + '）');
            // 全被 minScore 滤掉时，保底返回粗排前 1 条，避免完全空召回
            if (out.length === 0 && candidates.length > 0) {
                return candidates.slice(0, 1);
            }
            return out;

        } catch (e) {
            if (e.name === 'AbortError') {
                console.warn('[Reranker] 重排超时（>' + timeout + 'ms），回退 RRF 顺序');
            } else {
                console.warn('[Reranker] 重排失败，回退 RRF 顺序:', e && e.message || e);
            }
            return candidates.slice(0, topN);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    return {
        rerankEvents: rerankEvents
    };
})();
