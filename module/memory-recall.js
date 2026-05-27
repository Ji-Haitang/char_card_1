/**
 * memory-recall.js - 向量记忆召回引擎
 * Phase 3：向量化历史管理
 *
 * 功能：
 * - 启动时从 storageService 预热内存缓存（避免反复读 IDB）
 * - 余弦相似度 Top-K 召回，双重截断（topK 条数 + maxTokens）
 * - 跳过 fingerprint 不匹配的旧向量（模型切换后自动降级）
 * - 召回失败时 10 秒冷却节流弹窗
 * - 提供 Float32Array <-> ArrayBuffer 序列化工具（存档导出用）
 *
 * 依赖：embeddingService, storageService（均在本文件之前加载）
 */

var memoryRecall = (function() {
    // 内存缓存：[{ id, vector: Float32Array, text, week, fingerprint, createdAt }]
    var _cache = [];
    var _initialized = false;

    // 召回失败通知节流
    var _lastRecallFailAt = 0;
    var RECALL_FAIL_COOLDOWN = 10000; // 10 秒

    // =========================================================================
    // 工具函数
    // =========================================================================

    /**
     * Float32Array → ArrayBuffer（存档导出：JSON 无法序列化 TypedArray）
     */
    function float32ToBuffer(arr) {
        return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
    }

    /**
     * ArrayBuffer → Float32Array（存档导入恢复）
     */
    function bufferToFloat32(buffer) {
        return new Float32Array(buffer);
    }

    /**
     * 中文/英文 token 粗估（中文 1 字 ≈ 1 token，英文 4 字符 ≈ 1 token）
     */
    function _estimateTokens(text) {
        if (!text) return 0;
        var chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        var other = text.length - chinese;
        return Math.ceil(chinese + other / 4);
    }

    /**
     * 余弦相似度（纯 JS，无依赖）
     */
    function _cosineSimilarity(a, b) {
        var dot = 0, normA = 0, normB = 0;
        for (var i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        var denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom > 0 ? dot / denom : 0;
    }

    function _canNotifyRecallFail() {
        var now = Date.now();
        if (now - _lastRecallFailAt < RECALL_FAIL_COOLDOWN) return false;
        _lastRecallFailAt = now;
        return true;
    }

    // =========================================================================
    // 缓存管理
    // =========================================================================

    /**
     * 初始化：从 storageService 加载全部 embedding 到内存缓存
     * 在 storageService.init() 之后调用一次
     */
    async function init() {
        if (_initialized) return;
        try {
            var records = storageService.loadAllEmbeddings();
            _cache = records.map(function(r) {
                // vector 可能是 Float32Array（IDB 直存）或 ArrayBuffer（旧格式）
                var vec;
                if (r.vector instanceof Float32Array) {
                    vec = r.vector;
                } else if (r.vector instanceof ArrayBuffer) {
                    vec = bufferToFloat32(r.vector);
                } else if (Array.isArray(r.vector)) {
                    vec = new Float32Array(r.vector);
                } else {
                    vec = new Float32Array(0);
                }
                return {
                    id: r.id,
                    vector: vec,
                    text: r.text || '',
                    week: r.week || 0,
                    fingerprint: r.fingerprint || '',
                    createdAt: r.createdAt || 0
                };
            });
            console.log('[MemoryRecall] 初始化完成，缓存 ' + _cache.length + ' 条 embedding');
        } catch (e) {
            console.warn('[MemoryRecall] 初始化失败，缓存将为空:', e.message);
            _cache = [];
        }
        _initialized = true;
    }

    /**
     * 添加或更新一条缓存记录（每轮提交后调用）
     * @param {{ id, vector: Float32Array, text, week, fingerprint, createdAt }} record
     */
    function addToCache(record) {
        // 去重：同 id 的旧记录先移除
        _cache = _cache.filter(function(r) { return r.id !== record.id; });
        var vec = record.vector instanceof Float32Array
            ? record.vector
            : (record.vector instanceof ArrayBuffer
                ? bufferToFloat32(record.vector)
                : new Float32Array(Array.isArray(record.vector) ? record.vector : []));
        _cache.push({
            id: record.id,
            vector: vec,
            text: record.text || '',
            week: record.week || 0,
            fingerprint: record.fingerprint || '',
            createdAt: record.createdAt || Date.now()
        });
    }

    /**
     * 清空内存缓存（新游戏时调用）
     */
    function clearCache() {
        _cache = [];
        _initialized = false;
        console.log('[MemoryRecall] 缓存已清空');
    }

    /**
     * 从内存缓存中删除指定 id 的记录（重生成回退时调用）
     * @param {string} id - summaryHistory 条目的 id
     */
    function removeFromCache(id) {
        var before = _cache.length;
        _cache = _cache.filter(function(r) { return r.id !== id; });
        if (_cache.length < before) {
            console.log('[MemoryRecall] 已移除缓存记录:', id);
        }
    }

    // =========================================================================
    // 核心召回接口
    // =========================================================================

    /**
     * 语义召回相关历史记忆
     *
     * @param {string|Float32Array|number[]} queryTextOrVector - 查询文本（自动 embed）或预计算的加权向量
     * @param {number} [topK=15]  - 最多返回条数
     * @param {string[]} [excludeIds=[]] - 排除的 id（已在 RecentMemories 滑动窗口内的条目）
     * @param {number} [maxTokens=3000]  - 召回部分 token 上限
     * @param {string[]} [focusCharacters=[]] - 焦点NPC名字列表（软过滤：低置信度候选必须含其中任一名字）
     * @returns {Promise<Array<{id, text, week, similarity}>>}
     */
    async function recallRelevantMemories(queryTextOrVector, topK, excludeIds, maxTokens, focusCharacters) {
        topK = topK || 15;
        excludeIds = excludeIds || [];
        maxTokens = maxTokens || 3000;

        var MIN_SIM = 0.60;
        // 实体过滤：sim >= ENTITY_BYPASS_SIM 时绕行，低于此值的候选须含焦点NPC名（OR逻辑）
        var ENTITY_BYPASS_SIM = 0.72;

        // 前置检查
        if (!embeddingService.isEnabled()) return [];
        if (_cache.length === 0) return [];

        var queryVec;
        if (typeof queryTextOrVector === 'string') {
            // 向后兼容：传入文本字符串，自动 embed
            if (!queryTextOrVector || !queryTextOrVector.trim()) return [];
            try {
                var vectors = await embeddingService.embed([queryTextOrVector]);
                if (!vectors || !vectors[0]) {
                    if (_canNotifyRecallFail()) {
                        if (typeof showModal === 'function') {
                            showModal('【记忆召回提示】向量召回失败：embedding API 返回空结果\n\n本次已降级为普通历史截断。\n可在 API 配置中检查 Embedding 设置，或使用"重建记忆索引"补算未向量化的记录。');
                        }
                    }
                    return [];
                }
                queryVec = vectors[0];
            } catch (embedErr) {
                console.warn('[MemoryRecall] embed 失败:', embedErr && embedErr.message || embedErr);
                return [];
            }
        } else if (queryTextOrVector && typeof queryTextOrVector.length === 'number' && queryTextOrVector.length > 0) {
            // 预计算的向量（Float32Array 或普通数组），直接使用
            queryVec = queryTextOrVector;
        } else {
            return [];
        }

        try {

            // 2. 构建排除集合
            var excludeSet = {};
            for (var i = 0; i < excludeIds.length; i++) {
                excludeSet[excludeIds[i]] = true;
            }

            // 2b. 构建 focusCharacters 数组（用于实体过滤）
            var focusArr = focusCharacters && focusCharacters.length > 0 ? focusCharacters : [];

            // 3. 当前 fingerprint
            var currentFp = embeddingService.getFingerprint();

            // 4. 遍历缓存，计算相似度
            var scored = [];
            for (var j = 0; j < _cache.length; j++) {
                var r = _cache[j];
                if (excludeSet[r.id]) continue;
                // fingerprint 不匹配时跳过（旧模型的向量不能与新模型的 query 比较）
                if (r.fingerprint && currentFp && r.fingerprint !== currentFp) continue;
                if (!r.vector || r.vector.length === 0) continue;

                var sim = _cosineSimilarity(queryVec, r.vector);
                if (sim < MIN_SIM) continue;

                // 实体软过滤：有 focusNPC 且未达高置信度绕行阈值时，文本必须含任一焦点NPC
                if (focusArr.length > 0 && sim < ENTITY_BYPASS_SIM) {
                    var _entityMatch = false;
                    for (var _fi = 0; _fi < focusArr.length; _fi++) {
                        if (r.text && r.text.indexOf(focusArr[_fi]) !== -1) {
                            _entityMatch = true;
                            break;
                        }
                    }
                    if (!_entityMatch) continue;
                }

                scored.push({ id: r.id, text: r.text, week: r.week, similarity: sim });
            }

            // 5. 按相似度降序
            scored.sort(function(a, b) { return b.similarity - a.similarity; });

            // 6. 双重截断：topK 条数 + maxTokens token 上限
            var result = [];
            var usedTokens = 0;
            for (var k = 0; k < scored.length && result.length < topK; k++) {
                var item = scored[k];
                var tokens = _estimateTokens(item.text);
                if (usedTokens + tokens > maxTokens) break;
                result.push(item);
                usedTokens += tokens;
            }

            console.log('[MemoryRecall] 召回 ' + result.length + ' 条 | 候选 ' + scored.length + ' 条 | 排除 ' + excludeIds.length + ' 条 | 缓存 ' + _cache.length + ' 条'
                + (focusArr.length > 0 ? ' | focusNPC=[' + focusArr.join(',') + ']' : ' | focusNPC=无（跳过实体过滤）'));

            // 保存完整召回详情供页面 DEBUG 面板读取
            window._lastRecallDetails = {
                queryText: typeof queryTextOrVector === 'string' ? queryTextOrVector
                    : (window._lastQuerySegments
                        ? 'focus(' + (window._lastQuerySegments.focus.weight * 100).toFixed(0) + '%): ' + window._lastQuerySegments.focus.text
                          + (window._lastQuerySegments.near.text ? '\nnear(' + (window._lastQuerySegments.near.weight * 100).toFixed(0) + '%): ' + window._lastQuerySegments.near.text : '')
                          + (window._lastQuerySegments.far.text  ? '\nfar('  + (window._lastQuerySegments.far.weight  * 100).toFixed(0) + '%): ' + window._lastQuerySegments.far.text  : '')
                        : '[预计算向量]'),
                focusCharacters: focusArr,
                entityBypassSim: ENTITY_BYPASS_SIM,
                minSim: MIN_SIM,
                topK: topK,
                maxTokens: maxTokens,
                excludeCount: excludeIds.length,
                cacheCount: _cache.length,
                scored: scored.map(function(item, idx) {
                    return {
                        rank: idx + 1,
                        inResult: idx < result.length,
                        similarity: item.similarity,
                        week: item.week,
                        id: item.id,
                        text: item.text || ''
                    };
                }),
                resultCount: result.length
            };

            // 折叠详情 log（完整输出，不截断）
            console.groupCollapsed('[MemoryRecall] 召回详情（展开查看）');
            if (typeof queryTextOrVector === 'string') {
                console.log('查询输入（文本）: ' + queryTextOrVector);
            } else if (window._lastQuerySegments) {
                var _qs = window._lastQuerySegments;
                console.log('查询输入（加权向量）:');
                console.log('  focus(' + (_qs.focus.weight * 100).toFixed(0) + '%): ' + _qs.focus.text);
                if (_qs.near.text) console.log('  near(' + (_qs.near.weight * 100).toFixed(0) + '%): ' + (_qs.near.text.length > 300 ? _qs.near.text.slice(0, 300) + '...' : _qs.near.text));
                if (_qs.far.text)  console.log('  far('  + (_qs.far.weight  * 100).toFixed(0) + '%): ' + (_qs.far.text.length  > 150 ? _qs.far.text.slice(0,  150) + '...' : _qs.far.text));
            } else {
                console.log('查询输入: 预计算向量（Float32Array/Array, dim=' + queryTextOrVector.length + '）');
            }
            console.log('相似度阈值: ' + MIN_SIM + ' | 实体绕行阈值: ' + ENTITY_BYPASS_SIM + ' | focusNPC: [' + focusArr.join(', ') + '] | topK: ' + topK + ' | maxTokens: ' + maxTokens);
            if (scored.length === 0) {
                console.log('（无候选条目达到阈值）');
                // 补充扫描：找出相似度最高的5条供诊断（不受阈值限制）
                var _fallback = [];
                for (var _fbi = 0; _fbi < _cache.length; _fbi++) {
                    var _fbr = _cache[_fbi];
                    if (excludeSet[_fbr.id]) continue;
                    if (_fbr.fingerprint && currentFp && _fbr.fingerprint !== currentFp) continue;
                    if (!_fbr.vector || _fbr.vector.length === 0) continue;
                    _fallback.push({ id: _fbr.id, text: _fbr.text, week: _fbr.week, similarity: _cosineSimilarity(queryVec, _fbr.vector) });
                }
                _fallback.sort(function(a, b) { return b.similarity - a.similarity; });
                var _fbN = Math.min(5, _fallback.length);
                if (_fbN > 0) {
                    console.log('--- 最近似 Top' + _fbN + '（均未达阈值 ' + MIN_SIM + '）---');
                    for (var _fbi2 = 0; _fbi2 < _fbN; _fbi2++) {
                        var _fbt = _fallback[_fbi2];
                        console.log('[' + (_fbi2 + 1) + '] sim=' + _fbt.similarity.toFixed(4) + ' week=' + _fbt.week + ' id=' + _fbt.id);
                        console.log('    ' + (_fbt.text || ''));
                    }
                }
            } else {
                console.log('--- 全部候选（按相似度降序，含未入选）---');
                scored.forEach(function(item, idx) {
                    var inResult = idx < result.length;
                    var tag = inResult ? '✅ 入选' : '❌ 截断';
                    console.log(tag + ' [' + (idx + 1) + '] sim=' + item.similarity.toFixed(4) + ' week=' + item.week + ' id=' + item.id);
                    console.log('    ' + (item.text || ''));
                });
            }
            console.groupEnd();

            return result;

        } catch (e) {
            console.warn('[MemoryRecall] 召回异常:', e.message);
            if (_canNotifyRecallFail()) {
                if (typeof showModal === 'function') {
                    showModal('【记忆召回提示】向量召回异常：' + e.message + '\n\n本次已降级为普通历史截断。');
                }
            }
            return [];
        }
    }

    // =========================================================================
    // 统计信息
    // =========================================================================

    /**
     * 返回缓存统计信息，供调试/配置面板展示
     * @returns {{ total: number, initialized: boolean }}
     */
    function getStats() {
        return { total: _cache.length, initialized: _initialized };
    }

    // =========================================================================
    // 公开接口
    // =========================================================================

    return {
        init: init,
        addToCache: addToCache,
        clearCache: clearCache,
        removeFromCache: removeFromCache,
        recallRelevantMemories: recallRelevantMemories,
        getStats: getStats,
        float32ToBuffer: float32ToBuffer,
        bufferToFloat32: bufferToFloat32
    };
})();
