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

    // L2 剧情事件层独立缓存（装 wevt_ 向量，结构同 _cache，与 L0 完全分开）
    var _cacheL2 = [];
    var _initializedL2 = false;

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
    // L2 缓存管理（与 L0 完全分开：_cacheL2 / wevt_）
    // =========================================================================

    function _normalizeVector(v) {
        if (v instanceof Float32Array) return v;
        if (v instanceof ArrayBuffer) return bufferToFloat32(v);
        if (Array.isArray(v)) return new Float32Array(v);
        return new Float32Array(0);
    }

    /**
     * 初始化 L2 缓存：从 storageService 加载全部 wevt_ 向量
     */
    async function initL2() {
        if (_initializedL2) return;
        try {
            var records = (storageService.loadAllL2Embeddings ? storageService.loadAllL2Embeddings() : []);
            _cacheL2 = records.map(function(r) {
                return {
                    id: r.id,
                    vector: _normalizeVector(r.vector),
                    text: r.text || '',
                    week: r.week || 0,
                    fingerprint: r.fingerprint || '',
                    createdAt: r.createdAt || 0
                };
            });
            console.log('[MemoryRecall] L2 初始化完成，缓存 ' + _cacheL2.length + ' 条事件向量');
        } catch (e) {
            console.warn('[MemoryRecall] L2 初始化失败，缓存将为空:', e.message);
            _cacheL2 = [];
        }
        _initializedL2 = true;
        _rebuildLexicalIndex();
    }

    function addToCacheL2(record) {
        _cacheL2 = _cacheL2.filter(function(r) { return r.id !== record.id; });
        _cacheL2.push({
            id: record.id,
            vector: _normalizeVector(record.vector),
            text: record.text || '',
            week: record.week || 0,
            fingerprint: record.fingerprint || '',
            createdAt: record.createdAt || Date.now()
        });
        // 词法倒排索引同步（keywords/npc/location 由调用方随 record 一并传入）
        _deindexEventTerms(record.id); // 先清旧词（覆盖写场景）
        _indexEventTerms(record.id, record.keywords, record.npc, record.location);
    }

    function removeFromCacheL2(id) {
        var before = _cacheL2.length;
        _cacheL2 = _cacheL2.filter(function(r) { return r.id !== id; });
        if (_cacheL2.length < before) {
            console.log('[MemoryRecall] L2 已移除缓存记录:', id);
        }
        _deindexEventTerms(id);
    }

    function clearCacheL2() {
        _cacheL2 = [];
        _initializedL2 = false;
        _invertedIndex = new Map();
        _termMatchFactor = new Map();
        _docTerms = new Map();
        _docOriginalTerms = new Map();
        console.log('[MemoryRecall] L2 缓存已清空');
    }

    // =========================================================================
    // 词法检索：倒排索引 / 别名表 / 打分（Section 六）
    // =========================================================================

    var _invertedIndex     = new Map(); // Map<term, Set<eventId>>
    var _termMatchFactor   = new Map(); // Map<term, number>  原始=1.0 / 子串=0.5
    var _docTerms          = new Map(); // Map<eventId, Set<term>>  用于精准删除
    var _docOriginalTerms  = new Map(); // Map<eventId, Set<term>>  仅原始词（未展开子串），用于打分去重
    var _aliasMap          = new Map(); // Map<alias, canonical>  动态，从 eventMeta.aliases 加载

    var LEXICAL_BASE = 0.5;        // 词法路 RRF 基准权重（固定常数，不乘 lengthFactor）
    var LEXICAL_BYPASS_CAP = 5;    // 词法旁路上限（实际旁路数 = min(此值, ceil(全L2事件数×20%))）

    /**
     * 子串展开最小长度：ceil(词长/2)，但至少 2（2 字词不再细分，避免单字噪声）
     */
    function _substringMinLen(len) {
        return Math.max(2, Math.ceil(len / 2));
    }

    function _indexTerm(term, eventId, factor) {
        if (!term) return;
        if (!_invertedIndex.has(term)) _invertedIndex.set(term, new Set());
        _invertedIndex.get(term).add(eventId);
        var prev = _termMatchFactor.get(term);
        if (prev == null || factor > prev) _termMatchFactor.set(term, factor);
        if (!_docTerms.has(eventId)) _docTerms.set(eventId, new Set());
        _docTerms.get(eventId).add(term);
    }

    /**
     * 将一条事件的 keywords ∪ npc ∪ [location] 写入倒排索引（含子串展开）
     */
    function _indexEventTerms(eventId, keywords, npc, location) {
        if (!eventId) return;
        var raw = [];
        if (Array.isArray(keywords)) raw = raw.concat(keywords);
        if (Array.isArray(npc)) raw = raw.concat(npc);
        if (location) raw.push(location);
        var seen = {};
        var originalSet = _docOriginalTerms.get(eventId);
        if (!originalSet) { originalSet = new Set(); _docOriginalTerms.set(eventId, originalSet); }
        for (var i = 0; i < raw.length; i++) {
            var k = (raw[i] || '').toString().trim();
            if (!k || seen[k]) continue;
            seen[k] = true;
            originalSet.add(k);
            _indexTerm(k, eventId, 1.0);
            var minLen = _substringMinLen(k.length);
            if (minLen < k.length) {
                for (var subLen = minLen; subLen < k.length; subLen++) {
                    for (var start = 0; start + subLen <= k.length; start++) {
                        var sub = k.substring(start, start + subLen);
                        if (sub) _indexTerm(sub, eventId, 0.5);
                    }
                }
            }
        }
    }

    /**
     * 精准清理某事件在倒排索引中的所有 term（含子串）
     */
    function _deindexEventTerms(eventId) {
        var terms = _docTerms.get(eventId);
        if (!terms) return;
        terms.forEach(function(term) {
            var set = _invertedIndex.get(term);
            if (set) {
                set.delete(eventId);
                if (set.size === 0) {
                    _invertedIndex.delete(term);
                    _termMatchFactor.delete(term);
                }
            }
        });
        _docTerms.delete(eventId);
        _docOriginalTerms.delete(eventId);
    }

    /**
     * 全量重建倒排索引（初始化/存档恢复后调用）。
     * keywords/npc/location 数据来源于 eventHistoryService（wevt_ 向量记录本身不携带这些字段）。
     */
    function _rebuildLexicalIndex() {
        _invertedIndex = new Map();
        _termMatchFactor = new Map();
        _docTerms = new Map();
        _docOriginalTerms = new Map();
        if (typeof eventHistoryService === 'undefined' || !eventHistoryService.getAll) return;
        try {
            var events = eventHistoryService.getAll();
            for (var i = 0; i < events.length; i++) {
                var ev = events[i];
                if (!ev || !ev.id) continue;
                _indexEventTerms(ev.id, ev.keywords, ev.npc, ev.location);
            }
            console.log('[MemoryRecall] 词法倒排索引重建完成，索引词 ' + _invertedIndex.size + ' 个，覆盖事件 ' + _docTerms.size + ' 条');
        } catch (e) {
            console.warn('[MemoryRecall] 词法倒排索引重建失败:', e && e.message || e);
        }
    }

    /**
     * 用 eventMeta.aliases 重建内存别名表（alias → canonical）。
     * 调用时机：应用初始化、读存档/导入完成、每次 applyMetaUpdates() 执行后。
     */
    function _refreshAliasMap(eventMeta) {
        _aliasMap = new Map();
        var aliases = eventMeta && eventMeta.aliases;
        if (aliases && typeof aliases === 'object') {
            var keys = Object.keys(aliases);
            for (var i = 0; i < keys.length; i++) {
                var alias = keys[i];
                var canonical = aliases[alias];
                if (alias && canonical) _aliasMap.set(alias, canonical);
            }
        }
        console.log('[MemoryRecall] 别名表已刷新，共 ' + _aliasMap.size + ' 条');
    }

    /**
     * 词法打分：关键词倒查原文（遍历倒排索引键，对 intentText/contextText 做 includes），
     * 不对用户输入分词。含别名扩展（alias 命中 → canonical 对应事件集追加分）。
     *
     * 去重规则：按「事件」为单位打分——同一事件内，若某个纯子串展开项（非原始词）被一个
     * 已命中的更长词（原始词或另一子串）完整包含，则视为同一信号的重复，跳过其贡献，
     * 避免长关键词因展开出多个子串而被反复计分（例：「洞庭君」命中时，其子串「洞庭」「庭君」
     * 不再重复加分；但若「洞庭」本身也是该事件的独立原始词，则仍照常计分）。
     *
     * @returns {Map<eventId, {score:number, hits:Array<{term,side,matchFactor,idf}>}>}
     */
    function _scoreLexical(intentText, contextText) {
        var result = new Map();
        intentText = intentText || '';
        contextText = contextText || '';
        if (!intentText && !contextText) return result;
        if (_invertedIndex.size === 0) return result;

        var N = _cacheL2.length;
        function idfOf(term) {
            var set = _invertedIndex.get(term);
            var df = set ? set.size : 0;
            return Math.log((N + 1) / (df + 1));
        }
        function sideOf(term) {
            var inIntent = intentText.indexOf(term) !== -1;
            var inContext = contextText.indexOf(term) !== -1;
            if (inIntent && inContext) return { w: 1.5, side: 'both' };
            if (inIntent) return { w: 1.5, side: 'intent' };
            if (inContext) return { w: 1.0, side: 'context' };
            return null;
        }

        _docTerms.forEach(function(terms, id) {
            var hitsRaw = [];
            terms.forEach(function(term) {
                var sw = sideOf(term);
                if (!sw) return;
                hitsRaw.push({ term: term, side: sw.side, w: sw.w, factor: _termMatchFactor.get(term) || 1.0 });
            });
            if (hitsRaw.length === 0) return;

            // 优先保留更长（更精确）的命中，短子串若已被已保留的长词包含则跳过
            hitsRaw.sort(function(a, b) { return b.term.length - a.term.length; });
            var originalSet = _docOriginalTerms.get(id);
            var accepted = [];
            for (var i = 0; i < hitsRaw.length; i++) {
                var h = hitsRaw[i];
                var isOriginal = originalSet && originalSet.has(h.term);
                if (!isOriginal) {
                    var subsumed = false;
                    for (var j = 0; j < accepted.length; j++) {
                        if (accepted[j].term.length > h.term.length && accepted[j].term.indexOf(h.term) !== -1) {
                            subsumed = true;
                            break;
                        }
                    }
                    if (subsumed) continue;
                }
                accepted.push(h);
            }

            var entry = { score: 0, hits: [] };
            for (var k = 0; k < accepted.length; k++) {
                var a = accepted[k];
                var idf = idfOf(a.term);
                entry.score += a.w * a.factor * idf;
                entry.hits.push({ term: a.term, side: a.side, matchFactor: a.factor, idf: idf });
            }
            result.set(id, entry);
        });

        // 别名扩展：alias 命中 intentText/contextText → 给 canonical 对应事件集追加 matchFactor=0.9 分
        if (_aliasMap.size > 0) {
            _aliasMap.forEach(function(canonical, alias) {
                var sw = sideOf(alias);
                if (!sw) return;
                var idSet = _invertedIndex.get(canonical);
                if (!idSet) return;
                var idf = idfOf(canonical);
                var contrib = sw.w * 0.9 * idf;
                idSet.forEach(function(id) {
                    if (!result.has(id)) result.set(id, { score: 0, hits: [] });
                    var entry = result.get(id);
                    entry.score += contrib;
                    entry.hits.push({ term: alias + '→' + canonical, side: 'alias', matchFactor: 0.9, idf: idf });
                });
            });
        }

        return result;
    }

    // =========================================================================
    // 核心召回接口
    // =========================================================================

    // =========================================================================
    // RRF 加权参数（§3.3 双路 RRF：基准偏置 × 长度因子，与设计文档对齐）
    // =========================================================================
    var INTENT_BASE  = 0.6;   // intent 路基准权重（主路：用户当前意图）
    var CONTEXT_BASE = 0.4;   // context 路基准权重（辅路：上轮 AI 回复）

    /**
     * 长度因子：n>=50→1.0，n<=0→0.35，线性插值，下限 0.35。
     * 用户输入很短时压低 intent 路权重，防泛化 RRF 分把噪声顶进候选。
     */
    function _lengthFactor(n) {
        if (n >= 100) return 1.0;
        if (n <= 0)   return 0.35;
        return 0.35 + 0.65 * (n / 100);
    }

    /**
     * 语义召回相关历史记忆
     *
     * @param {string|Float32Array|number[]} queryTextOrVector - 查询文本（自动 embed）或预计算的加权向量
     * @param {number} [topK=15]  - 最多返回条数
     * @param {string[]} [excludeIds=[]] - 排除的 id（已在 RecentMemories 滑动窗口内的条目）
     * @param {number} [maxTokens=3000]  - 召回部分 token 上限
     * @param {string[]} [focusCharacters=[]] - 焦点NPC名字列表（软过滤：低置信度候选必须含其中任一名字）
     * @param {number} [intentTextLen=50] - intent 文本字数（用于长度因子，由 pipeline 传入）
     * @param {number} [contextTextLen=200] - context 文本字数（用于长度因子，由 pipeline 传入）
     * @returns {Promise<Array<{id, text, week, similarity}>>}
     */
    async function recallRelevantMemories(queryTextOrVector, topK, excludeIds, maxTokens, focusCharacters, contextVec, intentTextLen, contextTextLen, rerankQuery) {
        topK = topK || 15;
        excludeIds = excludeIds || [];
        maxTokens = maxTokens || 3000;

        var MIN_SIM = 0.60;
        // 实体过滤：sim >= ENTITY_BYPASS_SIM 时绕行，低于此值的候选须含焦点NPC名（OR逻辑）
        var ENTITY_BYPASS_SIM = 0.72;
        // RRF 常数 + 双路加权（基准偏置 × 长度因子）
        var RRF_K = 15;
        var _wIntent  = INTENT_BASE  * _lengthFactor(typeof intentTextLen  === 'number' ? intentTextLen  : 50);
        var _wContext = CONTEXT_BASE * _lengthFactor(typeof contextTextLen === 'number' ? contextTextLen : 200);

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

        // contextVec：第二路查询向量（可选），用于 RRF 融合
        var hasContextVec = contextVec && typeof contextVec.length === 'number' && contextVec.length > 0;

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

            // 4. 遍历缓存，对两路分别打分
            var intentScored = [];   // Q_intent 路（主路）
            var contextScored = [];  // Q_context 路（辅路，可选）

            for (var j = 0; j < _cache.length; j++) {
                var r = _cache[j];
                if (excludeSet[r.id]) continue;
                if (r.fingerprint && currentFp && r.fingerprint !== currentFp) continue;
                if (!r.vector || r.vector.length === 0) continue;

                var simIntent = _cosineSimilarity(queryVec, r.vector);
                intentScored.push({ id: r.id, text: r.text, week: r.week, sim: simIntent });

                if (hasContextVec) {
                    var simCtx = _cosineSimilarity(contextVec, r.vector);
                    contextScored.push({ id: r.id, sim: simCtx });
                }
            }

            // 5. 两路分别按相似度降序排名
            intentScored.sort(function(a, b) { return b.sim - a.sim; });
            if (hasContextVec) {
                contextScored.sort(function(a, b) { return b.sim - a.sim; });
            }

            // 6. 加权 RRF 融合：score(d) = w_intent/(k+rank_intent) + w_context/(k+rank_context)
            //    w = BASE × lengthFactor(字数)；intent 基准 0.6、context 基准 0.4（降权管排序）
            var rrfMap = {};
            for (var ri = 0; ri < intentScored.length; ri++) {
                var _id = intentScored[ri].id;
                rrfMap[_id] = { id: _id, text: intentScored[ri].text, week: intentScored[ri].week,
                    simIntent: intentScored[ri].sim, simContext: null,
                    rrfScore: _wIntent / (RRF_K + ri + 1) };
            }
            if (hasContextVec) {
                for (var ci = 0; ci < contextScored.length; ci++) {
                    var _cid = contextScored[ci].id;
                    if (rrfMap[_cid]) {
                        rrfMap[_cid].simContext = contextScored[ci].sim;
                        rrfMap[_cid].rrfScore += _wContext / (RRF_K + ci + 1);
                    }
                    // 仅出现在 context 路但不在 intent 路的条目（理论上不存在，两路扫相同缓存）
                }
            }

            // 7. 将 RRF map 转成数组，按 rrfScore 降序，再做实体过滤和最低阈值过滤
            //    阈值：intent 路的相似度必须 >= MIN_SIM（保证语义相关性的底线）
            var scored = [];
            var _rrfList = Object.keys(rrfMap).map(function(k) { return rrfMap[k]; });
            _rrfList.sort(function(a, b) { return b.rrfScore - a.rrfScore; });

            for (var si = 0; si < _rrfList.length; si++) {
                var item = _rrfList[si];
                // 过阈值：两路取大（max 管闸门，与降权管排序互补）
                var _simMax = Math.max(item.simIntent, item.simContext != null ? item.simContext : 0);
                if (_simMax < MIN_SIM) continue;

                // 实体软过滤：两路最大 sim 未达高置信度时，文本须含任一焦点NPC
                if (focusArr.length > 0 && _simMax < ENTITY_BYPASS_SIM) {
                    var _entityMatch = false;
                    for (var _fi = 0; _fi < focusArr.length; _fi++) {
                        if (item.text && item.text.indexOf(focusArr[_fi]) !== -1) {
                            _entityMatch = true;
                            break;
                        }
                    }
                    if (!_entityMatch) continue;
                }

                scored.push({ id: item.id, text: item.text, week: item.week,
                    similarity: item.simIntent, simContext: item.simContext, rrfScore: item.rrfScore });
            }

            // 8. Rerank 精排（可选）：取 scored 前 20 送 bge-reranker，精排后再截断
            var RERANK_CANDIDATE_LIMIT = 20;
            var _didRerank = false;
            if (rerankQuery && typeof rerankQuery === 'string' && rerankQuery.trim()
                && typeof reranker !== 'undefined' && scored.length > 1) {
                var _rrCands = scored.slice(0, RERANK_CANDIDATE_LIMIT);
                try {
                    var _rrResult = await reranker.rerankEvents(rerankQuery, _rrCands, { topN: topK, minScore: 0.10 });
                    // Rerank 前→后对比日志
                    console.groupCollapsed('[MemoryRecall][L0] Rerank 前→后对比（送入 ' + _rrCands.length + ' 条→精排后 ' + _rrResult.length + ' 条）');
                    console.log('── 精排前（RRF 分降序，送入 ' + _rrCands.length + ' 条）──');
                    var _rrLogN = Math.min(10, _rrCands.length);
                    for (var _rri = 0; _rri < _rrLogN; _rri++) {
                        var _rrc = _rrCands[_rri];
                        console.log('[' + (_rri + 1) + '] rrf=' + (_rrc.rrfScore || 0).toFixed(5)
                            + ' intent=' + (_rrc.similarity || 0).toFixed(4)
                            + (_rrc.simContext != null ? ' ctx=' + _rrc.simContext.toFixed(4) : '')
                            + ' | ' + _rrc.id);
                        console.log('    ' + (_rrc.text || '').slice(0, 100));
                    }
                    console.log('── 精排后（Rerank 分降序）──');
                    for (var _rrai = 0; _rrai < _rrResult.length; _rrai++) {
                        var _rrac = _rrResult[_rrai];
                        var _prevRank = -1;
                        for (var _rrpi = 0; _rrpi < _rrCands.length; _rrpi++) {
                            if (_rrCands[_rrpi].id === _rrac.id) { _prevRank = _rrpi + 1; break; }
                        }
                        var _rrDelta = _prevRank > 0
                            ? (_prevRank - (_rrai + 1) > 0 ? '↑' + (_prevRank - _rrai - 1)
                               : (_prevRank === _rrai + 1 ? '─' : '↓' + (_rrai + 1 - _prevRank))) : '?';
                        console.log('[' + (_rrai + 1) + '] rerank=' + (_rrac.rerankScore || 0).toFixed(4)
                            + ' (原RRF排' + _prevRank + ' ' + _rrDelta + ') | ' + _rrac.id);
                        console.log('    ' + (_rrac.text || '').slice(0, 100));
                    }
                    console.groupEnd();
                    if (_rrResult.length > 0) {
                        scored = _rrResult;
                        _didRerank = true;
                    } else {
                        console.log('[MemoryRecall][L0] Rerank 全被 minScore 过滤，回退 RRF 顺序');
                    }
                } catch (rrErr) {
                    console.warn('[MemoryRecall][L0] Rerank 失败，回退 RRF 顺序:', rrErr && rrErr.message || rrErr);
                }
            }

            // 9. 双重截断：topK 条数 + maxTokens token 上限
            var result = [];
            var usedTokens = 0;
            for (var k = 0; k < scored.length && result.length < topK; k++) {
                var ritem = scored[k];
                var tokens = _estimateTokens(ritem.text);
                if (usedTokens + tokens > maxTokens) break;
                result.push(ritem);
                usedTokens += tokens;
            }

            console.log('[MemoryRecall] 召回 ' + result.length + ' 条 | 候选 ' + scored.length + ' 条 | 排除 ' + excludeIds.length + ' 条 | 缓存 ' + _cache.length + ' 条'
                + (hasContextVec ? ' | 双路RRF' : ' | 单路')
                + (_didRerank ? ' | +Rerank' : '')
                + (focusArr.length > 0 ? ' | focusNPC=[' + focusArr.join(',') + ']' : ' | focusNPC=无（跳过实体过滤）'));

            // 保存完整召回详情供页面 DEBUG 面板读取
            window._lastRecallDetails = {
                queryText: typeof queryTextOrVector === 'string' ? queryTextOrVector
                    : (window._lastQuerySegments
                        ? 'Q_intent: ' + (window._lastQuerySegments.intent ? window._lastQuerySegments.intent.text : '')
                          + (window._lastQuerySegments.context && window._lastQuerySegments.context.text ? '\nQ_context: ' + window._lastQuerySegments.context.text : '')
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
                        simContext: item.simContext,
                        rrfScore: item.rrfScore,
                        week: item.week,
                        id: item.id,
                        text: item.text || ''
                    };
                }),
                resultCount: result.length
            };

            // 折叠详情 log（四段式：① Intent路 ② Context路 ③ RRF融合前十 ④ 最终入选）
            console.groupCollapsed('[MemoryRecall][L0] 召回详情（展开查看）');
            if (typeof queryTextOrVector === 'string') {
                console.log('查询输入（文本）: ' + queryTextOrVector);
            } else if (window._lastQuerySegments) {
                var _qs = window._lastQuerySegments;
                console.log('查询输入（双路向量）:');
                if (_qs.intent) console.log('  Q_intent: ' + (_qs.intent.text || ''));
                if (_qs.context && _qs.context.text) console.log('  Q_context: ' + (_qs.context.text.length > 300 ? _qs.context.text.slice(0, 300) + '...' : _qs.context.text));
            } else {
                console.log('查询输入: 预计算向量（dim=' + queryVec.length + '）' + (hasContextVec ? ' + contextVec(dim=' + contextVec.length + ')' : ''));
            }
            console.log('相似度阈值: ' + MIN_SIM + ' | 实体绕行阈值: ' + ENTITY_BYPASS_SIM + ' | RRF_K: ' + RRF_K
                + ' | focusNPC: [' + focusArr.join(', ') + '] | topK: ' + topK + ' | maxTokens: ' + maxTokens
                + ' | w_intent=' + _wIntent.toFixed(3) + ' w_context=' + _wContext.toFixed(3));

            // --- ① Intent 路 Top 10 ---
            console.groupCollapsed('① Intent 路 Top10（共 ' + intentScored.length + ' 条，w=' + _wIntent.toFixed(3) + '）');
            var _l0iTop = Math.min(10, intentScored.length);
            for (var _l0ii = 0; _l0ii < _l0iTop; _l0ii++) {
                var _l0is = intentScored[_l0ii];
                console.log('[' + (_l0ii + 1) + '] sim=' + _l0is.sim.toFixed(4) + ' | ' + _l0is.id);
                console.log('    ' + (_l0is.text || '').slice(0, 100));
            }
            console.groupEnd();

            // --- ② Context 路 Top 10 ---
            if (hasContextVec) {
                var _l0TextById = {};
                for (var _l0ti = 0; _l0ti < intentScored.length; _l0ti++) _l0TextById[intentScored[_l0ti].id] = intentScored[_l0ti].text;
                console.groupCollapsed('② Context 路 Top10（共 ' + contextScored.length + ' 条，w=' + _wContext.toFixed(3) + '）');
                var _l0cTop = Math.min(10, contextScored.length);
                for (var _l0ci = 0; _l0ci < _l0cTop; _l0ci++) {
                    var _l0cs = contextScored[_l0ci];
                    console.log('[' + (_l0ci + 1) + '] sim=' + _l0cs.sim.toFixed(4) + ' | ' + _l0cs.id);
                    console.log('    ' + (_l0TextById[_l0cs.id] || '').slice(0, 100));
                }
                console.groupEnd();
            }

            // --- ③ RRF 融合 Top 10（阈值过滤前）---
            console.groupCollapsed('③ RRF 融合 Top10（过滤前，共 ' + _rrfList.length + ' 条）');
            var _l0rTop = Math.min(10, _rrfList.length);
            for (var _l0ri = 0; _l0ri < _l0rTop; _l0ri++) {
                var _l0rr = _rrfList[_l0ri];
                var _l0simMax = Math.max(_l0rr.simIntent, _l0rr.simContext != null ? _l0rr.simContext : 0);
                var _l0tag = _l0simMax < MIN_SIM ? ' ❌<MIN_SIM' : '';
                console.log('[' + (_l0ri + 1) + '] rrf=' + _l0rr.rrfScore.toFixed(5) + ' intent=' + _l0rr.simIntent.toFixed(4)
                    + (_l0rr.simContext != null ? ' ctx=' + _l0rr.simContext.toFixed(4) : '') + _l0tag + ' | ' + _l0rr.id);
                console.log('    ' + (_l0rr.text || '').slice(0, 100));
            }
            console.groupEnd();

            // --- ④ 最终入选 ---
            console.groupCollapsed('④ 最终入选 ' + result.length + ' 条（' + (_didRerank ? 'Rerank后' : '候选 ' + scored.length + ' 条通过阈值') + '，topK=' + topK + '，maxTokens=' + maxTokens + '）');
            if (result.length === 0 && scored.length === 0) {
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
                    console.log('（无候选达到阈值，最近似 Top' + _fbN + '）');
                    for (var _fbi2 = 0; _fbi2 < _fbN; _fbi2++) {
                        var _fbt = _fallback[_fbi2];
                        console.log('[' + (_fbi2 + 1) + '] sim=' + _fbt.similarity.toFixed(4) + ' | ' + _fbt.id);
                        console.log('    ' + (_fbt.text || '').slice(0, 100));
                    }
                } else {
                    console.log('（无候选达到阈值）');
                }
            } else {
                for (var _l0fi = 0; _l0fi < result.length; _l0fi++) {
                    var _l0fr = result[_l0fi];
                    var _l0ctx = _l0fr.simContext != null ? ' ctx=' + _l0fr.simContext.toFixed(4) : '';
                    console.log('[' + (_l0fi + 1) + '] intent=' + _l0fr.similarity.toFixed(4) + _l0ctx + ' rrf=' + _l0fr.rrfScore.toFixed(5) + ' | ' + _l0fr.id);
                    console.log('    ' + (_l0fr.text || '').slice(0, 100));
                }
                if (scored.length > result.length) {
                    console.log('（另有 ' + (scored.length - result.length) + ' 条通过阈值但因 topK/maxTokens 截断未入选）');
                }
            }
            console.groupEnd();

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
    // L2 召回 + 因果链追溯
    // =========================================================================

    /**
     * L2 事件层双路稠密 RRF 召回（结构同 L0，但跑在 _cacheL2 上，返回候选不做 token 截断）。
     * 精排（rerank）、因果链、挂载在 pipeline 侧进行。
     *
     * @param {Float32Array} intentVec - Q_intent 向量
     * @param {Float32Array} [contextVec] - Q_context 向量
     * @param {object} [opts] - { excludeIds:[], focusCharacters:[], candidateLimit:30, minSim }
     * @returns {Array<{id,text,week,similarity,simContext,rrfScore}>}
     */
    function recallL2Events(intentVec, contextVec, opts) {
        opts = opts || {};
        var excludeIds = opts.excludeIds || [];
        var focusArr = (opts.focusCharacters && opts.focusCharacters.length > 0) ? opts.focusCharacters : [];
        var candidateLimit = typeof opts.candidateLimit === 'number' ? opts.candidateLimit : 30;
        var MIN_SIM = typeof opts.minSim === 'number' ? opts.minSim : 0.60;
        var ENTITY_BYPASS_SIM = 0.72;
        var RRF_K = 15;
        var _wIntent  = INTENT_BASE  * _lengthFactor(typeof opts.intentTextLen  === 'number' ? opts.intentTextLen  : 50);
        var _wContext = CONTEXT_BASE * _lengthFactor(typeof opts.contextTextLen === 'number' ? opts.contextTextLen : 200);

        if (!embeddingService.isEnabled()) return [];
        if (_cacheL2.length === 0) return [];
        if (!intentVec || !intentVec.length) return [];

        var hasContextVec = contextVec && typeof contextVec.length === 'number' && contextVec.length > 0;
        var excludeSet = {};
        for (var i = 0; i < excludeIds.length; i++) excludeSet[excludeIds[i]] = true;
        var currentFp = embeddingService.getFingerprint();

        var intentScored = [];
        var contextScored = [];
        for (var j = 0; j < _cacheL2.length; j++) {
            var r = _cacheL2[j];
            if (excludeSet[r.id]) continue;
            if (r.fingerprint && currentFp && r.fingerprint !== currentFp) continue;
            if (!r.vector || r.vector.length === 0) continue;
            var simIntent = _cosineSimilarity(intentVec, r.vector);
            intentScored.push({ id: r.id, text: r.text, week: r.week, sim: simIntent });
            if (hasContextVec) {
                contextScored.push({ id: r.id, sim: _cosineSimilarity(contextVec, r.vector) });
            }
        }

        intentScored.sort(function(a, b) { return b.sim - a.sim; });
        if (hasContextVec) contextScored.sort(function(a, b) { return b.sim - a.sim; });

        var rrfMap = {};
        for (var ri = 0; ri < intentScored.length; ri++) {
            var _id = intentScored[ri].id;
            rrfMap[_id] = { id: _id, text: intentScored[ri].text, week: intentScored[ri].week,
                simIntent: intentScored[ri].sim, simContext: null, rrfScore: _wIntent / (RRF_K + ri + 1) };
        }
        if (hasContextVec) {
            for (var ci = 0; ci < contextScored.length; ci++) {
                var _cid = contextScored[ci].id;
                if (rrfMap[_cid]) {
                    rrfMap[_cid].simContext = contextScored[ci].sim;
                    rrfMap[_cid].rrfScore += _wContext / (RRF_K + ci + 1);
                }
            }
        }

        // --- 词法路（第三路）：关键词倒查原文，含别名贡献 ---
        var _lexResultMap = _scoreLexical(opts.intentText || '', opts.contextText || '');
        var _lexRanked = Array.from(_lexResultMap.entries())
            .map(function(e) { return [e[0], e[1].score]; })
            .sort(function(a, b) { return b[1] - a[1]; });
        var _lexHitsById = {};
        _lexResultMap.forEach(function(v, id) { _lexHitsById[id] = v.hits; });

        var _lexBypassIds = new Set();
        var _bypassN = 0;
        if (_lexRanked.length > 0) {
            _bypassN = Math.min(LEXICAL_BYPASS_CAP, Math.ceil(_cacheL2.length * 0.20));
            if (_bypassN > 0) {
                var _topNThreshold = _lexRanked[Math.min(_bypassN - 1, _lexRanked.length - 1)][1];
                for (var ti = 0; ti < _lexRanked.length; ti++) {
                    if (_lexRanked[ti][1] >= _topNThreshold) _lexBypassIds.add(_lexRanked[ti][0]);
                    else break; // 降序，可提前退出
                }
            }
        }

        // 给 rrfMap 中已有的命中事件追加词法 RRF 分（不在 rrfMap 的 id 已被 excludeSet/指纹/无向量过滤，忽略）
        for (var li = 0; li < _lexRanked.length; li++) {
            var _lid = _lexRanked[li][0];
            if (rrfMap[_lid]) {
                rrfMap[_lid].lexScore = _lexRanked[li][1];
                rrfMap[_lid].lexRank = li;
                rrfMap[_lid].rrfScore += LEXICAL_BASE / (RRF_K + li + 1);
            }
        }

        var list = Object.keys(rrfMap).map(function(k) { return rrfMap[k]; });
        list.sort(function(a, b) { return b.rrfScore - a.rrfScore; });

        var scored = [];
        for (var si = 0; si < list.length && scored.length < candidateLimit; si++) {
            var item = list[si];
            // 词法高置信旁路：与向量阈值为「或」关系，绕过向量相似度阈值和实体软过滤
            if (_lexBypassIds.has(item.id)) {
                scored.push({ id: item.id, text: item.text, week: item.week,
                    similarity: item.simIntent, simContext: item.simContext, rrfScore: item.rrfScore,
                    lexBypass: true });
                continue;
            }
            var simMax = Math.max(item.simIntent, item.simContext != null ? item.simContext : 0);
            // 过阈值：两路取大（与 L0 一致）
            if (simMax < MIN_SIM) continue;
            // 实体软过滤：低置信度候选须含任一焦点 NPC
            if (focusArr.length > 0 && simMax < ENTITY_BYPASS_SIM) {
                var match = false;
                for (var fi = 0; fi < focusArr.length; fi++) {
                    if (item.text && item.text.indexOf(focusArr[fi]) !== -1) { match = true; break; }
                }
                if (!match) continue;
            }
            scored.push({ id: item.id, text: item.text, week: item.week,
                similarity: item.simIntent, simContext: item.simContext, rrfScore: item.rrfScore,
                lexBypass: false });
        }

        console.log('[MemoryRecall][L2] 候选 ' + scored.length + ' 条 | 缓存 ' + _cacheL2.length + ' 条 | 排除 ' + excludeIds.length + ' 条'
            + (hasContextVec ? ' | 双路RRF' : ' | 单路')
            + ' | 词法命中 ' + _lexRanked.length + ' 条(旁路 ' + _lexBypassIds.size + ' 条)'
            + (focusArr.length > 0 ? ' | focusNPC=[' + focusArr.join(',') + ']' : ''));

        // 折叠详情 log（五段式：① Intent路 ② Context路 ③ 词法路 ④ RRF融合前十 ⑤ 最终入选/送精排）
        console.groupCollapsed('[MemoryRecall][L2] 召回详情（展开查看）');
        console.log('相似度阈值: ' + MIN_SIM + ' | 实体绕行阈值: ' + ENTITY_BYPASS_SIM + ' | RRF_K: ' + RRF_K
            + ' | focusNPC: [' + focusArr.join(', ') + '] | candidateLimit: ' + candidateLimit + ' | 排除: ' + excludeIds.length
            + ' | w_intent=' + _wIntent.toFixed(3) + ' w_context=' + _wContext.toFixed(3) + ' w_lex=' + LEXICAL_BASE);

        // --- ① L2 Intent 路 Top 10 ---
        console.groupCollapsed('① Intent 路 Top10（共 ' + intentScored.length + ' 条，w=' + _wIntent.toFixed(3) + '）');
        var _l2iTop = Math.min(10, intentScored.length);
        for (var _l2ii = 0; _l2ii < _l2iTop; _l2ii++) {
            var _l2is = intentScored[_l2ii];
            console.log('[' + (_l2ii + 1) + '] sim=' + _l2is.sim.toFixed(4) + ' | ' + _l2is.id);
            console.log('    ' + (_l2is.text || '').slice(0, 100));
        }
        console.groupEnd();

        // --- ② L2 Context 路 Top 10 ---
        if (hasContextVec) {
            var _l2TextById = {};
            for (var _l2ti = 0; _l2ti < intentScored.length; _l2ti++) _l2TextById[intentScored[_l2ti].id] = intentScored[_l2ti].text;
            console.groupCollapsed('② Context 路 Top10（共 ' + contextScored.length + ' 条，w=' + _wContext.toFixed(3) + '）');
            var _l2cTop = Math.min(10, contextScored.length);
            for (var _l2ci = 0; _l2ci < _l2cTop; _l2ci++) {
                var _l2cs = contextScored[_l2ci];
                console.log('[' + (_l2ci + 1) + '] sim=' + _l2cs.sim.toFixed(4) + ' | ' + _l2cs.id);
                console.log('    ' + (_l2TextById[_l2cs.id] || '').slice(0, 100));
            }
            console.groupEnd();
        }

        // --- ③ L2 词法路 Top 10（新增）---
        console.groupCollapsed('③ 词法路 Top10（命中 ' + _lexRanked.length + ' 条，w_lex=' + LEXICAL_BASE + '，旁路上限=' + _bypassN + '）');
        if (_lexRanked.length === 0) {
            console.log('（本轮查询无词法命中）');
        } else {
            // 文本查找：优先取 rrfMap（已含 intentScored 的 text），未命中则回退线性查 _cacheL2（极少数无向量事件兜底）
            var _lexTextFor = function(id) {
                if (rrfMap[id] && rrfMap[id].text) return rrfMap[id].text;
                for (var qi = 0; qi < _cacheL2.length; qi++) {
                    if (_cacheL2[qi].id === id) return _cacheL2[qi].text || '';
                }
                return '';
            };
            var _lexTop = Math.min(10, _lexRanked.length);
            for (var _li2 = 0; _li2 < _lexTop; _li2++) {
                var _lid2 = _lexRanked[_li2][0];
                var _lscore = _lexRanked[_li2][1];
                var _lhits = _lexHitsById[_lid2] || [];
                var _isBypass = _lexBypassIds.has(_lid2);
                console.log('[' + (_li2 + 1) + '] lex=' + _lscore.toFixed(4) + (_isBypass ? ' 🔓旁路' : '') + ' | ' + _lid2);
                console.log('    命中词: ' + _lhits.map(function(h) {
                    return h.term + '(' + h.side + ' ×' + h.matchFactor.toFixed(1) + ' idf=' + h.idf.toFixed(2) + ')';
                }).join('、'));
                console.log('    ' + (_lexTextFor(_lid2) || '（无缓存文本）').slice(0, 100));
            }
        }
        console.groupEnd();

        // --- ④ L2 RRF 融合 Top 10（阈值过滤前）---
        console.groupCollapsed('④ RRF 融合 Top10（过滤前，共 ' + list.length + ' 条）');
        var _l2rTop = Math.min(10, list.length);
        for (var _l2ri = 0; _l2ri < _l2rTop; _l2ri++) {
            var _l2rr = list[_l2ri];
            var _l2simMax = Math.max(_l2rr.simIntent, _l2rr.simContext != null ? _l2rr.simContext : 0);
            var _l2tag = _l2simMax < MIN_SIM ? ' ❌<MIN_SIM' : '';
            var _lexPart = '';
            if (typeof _l2rr.lexRank === 'number') {
                var _lexContrib = LEXICAL_BASE / (RRF_K + _l2rr.lexRank + 1);
                _lexPart = ' lex=+' + _lexContrib.toFixed(5) + (_lexBypassIds.has(_l2rr.id) ? '(🔓旁路)' : '');
            }
            console.log('[' + (_l2ri + 1) + '] rrf=' + _l2rr.rrfScore.toFixed(5) + ' intent=' + _l2rr.simIntent.toFixed(4)
                + (_l2rr.simContext != null ? ' ctx=' + _l2rr.simContext.toFixed(4) : '') + _lexPart + _l2tag + ' | ' + _l2rr.id);
            console.log('    ' + (_l2rr.text || '').slice(0, 100));
        }
        console.groupEnd();

        // --- ⑤ L2 最终入选（送往精排）---
        console.groupCollapsed('⑤ 最终入选 ' + scored.length + ' 条（送往精排，candidateLimit=' + candidateLimit + '）');
        if (scored.length === 0) {
            // 补充扫描：找出相似度最高的5条供诊断
            var _l2fb = [];
            for (var _fbi = 0; _fbi < _cacheL2.length; _fbi++) {
                var _fbr = _cacheL2[_fbi];
                if (_fbr.fingerprint && currentFp && _fbr.fingerprint !== currentFp) continue;
                if (!_fbr.vector || _fbr.vector.length === 0) continue;
                _l2fb.push({ id: _fbr.id, text: _fbr.text, week: _fbr.week,
                    similarity: _cosineSimilarity(intentVec, _fbr.vector), excluded: !!excludeSet[_fbr.id] });
            }
            _l2fb.sort(function(a, b) { return b.similarity - a.similarity; });
            var _l2fbN = Math.min(5, _l2fb.length);
            if (_l2fbN > 0) {
                console.log('（无候选达到阈值，最近似 Top' + _l2fbN + '，阈值 ' + MIN_SIM + '）');
                for (var _fbi2 = 0; _fbi2 < _l2fbN; _fbi2++) {
                    var _fbt = _l2fb[_fbi2];
                    console.log('[' + (_fbi2 + 1) + '] sim=' + _fbt.similarity.toFixed(4) + ' | ' + _fbt.id + (_fbt.excluded ? ' (已排除/近期)' : ''));
                    console.log('    ' + (_fbt.text || '').slice(0, 100));
                }
            } else {
                console.log('（无候选达到阈值）');
            }
        } else {
            for (var _l2fi = 0; _l2fi < scored.length; _l2fi++) {
                var _l2fr = scored[_l2fi];
                var _l2ctx = _l2fr.simContext != null ? ' ctx=' + _l2fr.simContext.toFixed(4) : '';
                var _l2reason = _l2fr.lexBypass ? ' 🔓词法旁路' : ' ✅向量阈值';
                console.log('[' + (_l2fi + 1) + '] intent=' + _l2fr.similarity.toFixed(4) + _l2ctx + ' rrf=' + _l2fr.rrfScore.toFixed(5) + _l2reason + ' | ' + _l2fr.id);
                console.log('    ' + (_l2fr.text || '').slice(0, 100));
            }
        }
        console.groupEnd();

        console.groupEnd();

        return scored;
    }

    /**
     * 因果链追溯：对每条命中事件沿 causedBy 递归追前因（深度≤maxDepth，总注入≤maxAdd），带 visited 防环。
     * 链路合并（A1 策略）：若追溯到的某个前因 id 本身也是本轮直接命中事件，不再排除/断链，而是把它当作
     * 普通前因节点收录（供 prompt-builder 内联渲染进引用它的那条链），并对它自己的 causedBy 重新给予一份
     * 完整的 maxDepth 追溯配额（因为它自己作为 directEvents 之一，在初始化阶段已经把自己的 causedBy 以
     * depth=1 入队过一次，天然获得"合并后重新计深度"的效果，无需额外处理）。这个 id 需要从调用方的顶层
     * 编号列表里剔除（改由 priorById 提供内容），返回值里通过 absorbedIds 告知调用方。
     * 多条命中事件共享同一前因时，不做去重/交叉引用，各自独立渲染时都会完整展示一遍（由调用方保证）。
     * @param {Array} directEvents - 直接命中的事件对象（含 id/causedBy）
     * @param {Map|object} eventMap - id → 事件对象 的映射
     * @param {object} [opts] - { maxDepth=4, maxAdd=20 }
     * @returns {{traced:Array, absorbedIds:Array}} traced=需要收录进 priorById 的前因事件（含被合并的直接命中事件）；
     *          absorbedIds=被合并、应从顶层编号列表剔除的直接命中事件 id 列表
     */
    function traceCausation(directEvents, eventMap, opts) {
        opts = opts || {};
        var maxDepth = typeof opts.maxDepth === 'number' ? opts.maxDepth : 4;
        var maxAdd = typeof opts.maxAdd === 'number' ? opts.maxAdd : 20;
        var getEvent = (eventMap instanceof Map)
            ? function(id) { return eventMap.get(id); }
            : function(id) { return eventMap[id]; };

        var directIds = {};
        for (var d = 0; d < directEvents.length; d++) directIds[directEvents[d].id] = true;

        var visited = {};
        var absorbed = {};   // 被合并进其他直接命中事件因果链的 directEvents id
        var refCount = {};   // 被引用次数（多命中引用的因优先）
        var depthOf = {};    // 最浅深度
        var collected = [];

        // BFS 队列：每条直接命中事件（无论最终是否被合并）都在此把自己的 causedBy 以 depth=1 入队，
        // 这一步天然保证了"合并节点自己的前因"重新获得一份完整 maxDepth 配额，故意不在此处预标记
        // visited[ev.id]，以便直接命中事件互相引用时能被下面的主循环发现并标记为 absorbed。
        var queue = [];
        for (var i = 0; i < directEvents.length; i++) {
            var ev = directEvents[i];
            var cb = Array.isArray(ev.causedBy) ? ev.causedBy : [];
            for (var c = 0; c < cb.length; c++) queue.push({ id: cb[c], depth: 1 });
        }

        while (queue.length > 0) {
            var node = queue.shift();
            if (node.depth > maxDepth) continue;
            refCount[node.id] = (refCount[node.id] || 0) + 1;
            if (depthOf[node.id] == null || node.depth < depthOf[node.id]) depthOf[node.id] = node.depth;
            if (visited[node.id]) continue;
            visited[node.id] = true;
            var pe = getEvent(node.id);
            if (!pe) continue;
            if (directIds[node.id]) absorbed[node.id] = true; // 链路合并：标记为被吸收的直接命中事件
            collected.push(pe);
            var pcb = Array.isArray(pe.causedBy) ? pe.causedBy : [];
            for (var k = 0; k < pcb.length; k++) {
                if (!visited[pcb[k]]) queue.push({ id: pcb[k], depth: node.depth + 1 });
            }
        }

        // 安全兜底：若合并会导致本轮所有直接命中事件全部被吸收（理论上仅在 causedBy 数据成环时发生），
        // 则放弃本轮合并，避免顶层编号列表被清空。
        var absorbedIds = Object.keys(absorbed);
        if (absorbedIds.length >= directEvents.length && directEvents.length > 0) {
            console.warn('[MemoryRecall][L2] 因果链合并检测到异常（可能 causedBy 成环），放弃本轮合并');
            absorbedIds = [];
        }
        var absorbedSet = {};
        for (var ai = 0; ai < absorbedIds.length; ai++) absorbedSet[absorbedIds[ai]] = true;

        // 排序：被引用多的 + 浅层的优先
        collected.sort(function(a, b) {
            var ra = refCount[a.id] || 0, rb = refCount[b.id] || 0;
            if (ra !== rb) return rb - ra;
            return (depthOf[a.id] || 99) - (depthOf[b.id] || 99);
        });

        // maxAdd 只裁剪"普通前因"，被合并的直接命中事件必须全部保留——否则会既不在顶层编号、
        // 又没有前因内容可渲染，导致该事件彻底从 prompt 里消失。
        var _mergeNodes = collected.filter(function(pe) { return absorbedSet[pe.id]; });
        var _normalPriors = collected.filter(function(pe) { return !absorbedSet[pe.id]; });
        var _remainingBudget = Math.max(0, maxAdd - _mergeNodes.length);
        var _traced = _mergeNodes.concat(_normalPriors.slice(0, _remainingBudget));

        if (_traced.length > 0) {
            console.groupCollapsed('[MemoryRecall][L2] 因果链追溯 ' + _traced.length + ' 条前因（命中 ' + directEvents.length + ' 条，maxDepth=' + maxDepth + ', maxAdd=' + maxAdd
                + (absorbedIds.length > 0 ? '，链路合并 ' + absorbedIds.length + ' 条' : '') + '）');
            _traced.forEach(function(pe, idx) {
                console.log('[' + (idx + 1) + '] 深度=' + (depthOf[pe.id] || '?') + ' 被引=' + (refCount[pe.id] || 0) + ' id=' + pe.id
                    + (absorbedSet[pe.id] ? ' 🔗合并(原为直接命中)' : '') + ' | ' + (pe.title || '') + '：' + (pe.description || ''));
            });
            console.groupEnd();
        } else if (directEvents.length > 0) {
            console.log('[MemoryRecall][L2] 因果链追溯：命中 ' + directEvents.length + ' 条事件均无可追溯前因');
        }
        return { traced: _traced, absorbedIds: absorbedIds };
    }

    // =========================================================================
    // 统计信息
    // =========================================================================

    /**
     * 返回缓存统计信息，供调试/配置面板展示
     * @returns {{ total: number, initialized: boolean }}
     */
    function getStats() {
        return { total: _cache.length, initialized: _initialized, totalL2: _cacheL2.length, initializedL2: _initializedL2 };
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
        initL2: initL2,
        addToCacheL2: addToCacheL2,
        removeFromCacheL2: removeFromCacheL2,
        clearCacheL2: clearCacheL2,
        recallL2Events: recallL2Events,
        traceCausation: traceCausation,
        _refreshAliasMap: _refreshAliasMap,
        getStats: getStats,
        float32ToBuffer: float32ToBuffer,
        bufferToFloat32: bufferToFloat32
    };
})();
