/**
 * pipeline.js - 单轮消息处理流水线（两阶段设计）
 * Phase 1 核心：请求阶段无副作用 + 提交阶段可回滚
 * Phase 2：流式 SSE 支持 + 节流渲染
 * 
 * 依赖：api-service, prompt-builder, response-parser, 
 *        variable-system, summary-history-service, storage-service
 */

var pipeline = (function() {
    // 流式状态
    var _currentAbort = null;    // 当前流式的中断控制器
    var _isStreaming = false;    // 是否正在流式生成
    var _abortRequested = false; // 用户是否请求中断
    var _currentSummarySource = null; // 当前提交的摘要来源（null 时默认 'llm'）

    // 入库/查询侧共用的字段 key 列表
    var _LOCATION_KEYS = ['抵达目的地', '地点'];
    var _NPC_KEYS = ['在场NPC', '随行NPC', '切磋对手'];

    /**
     * 从消息文本（可能含 <br>）中提取地点和NPC，返回「地点：xxx\n在场NPC：xxx\n」格式的前缀字符串。
     * 若无对应字段则返回空字符串。供入库（_buildEmbedText）和查询（Q_context）共用。
     */
    function _extractLocationNpcPrefix(text) {
        if (!text) return '';
        var content = text.replace(/<br\s*\/?>/gi, '\n');
        var locationVal = null;
        for (var lk = 0; lk < _LOCATION_KEYS.length; lk++) {
            var lMatch = content.match(new RegExp(_LOCATION_KEYS[lk] + '[：:]([^\n]+)'));
            if (lMatch) {
                locationVal = lMatch[1].trim();
                var arriveMatch = locationVal.match(/来到(.+)/);
                if (arriveMatch) locationVal = arriveMatch[1].trim();
                break;
            }
        }
        var npcLine = null;
        for (var nk = 0; nk < _NPC_KEYS.length; nk++) {
            var nMatch = content.match(new RegExp(_NPC_KEYS[nk] + '[：:]([^\n]+)'));
            if (nMatch) {
                npcLine = _NPC_KEYS[nk] + '：' + nMatch[1].trim();
                break;
            }
        }
        var prefix = '';
        if (locationVal) prefix += '地点：' + locationVal + '\n';
        if (npcLine) prefix += npcLine + '\n';
        return prefix;
    }

    /**
     * 构造 Q_intent 文本：对用户输入做以下处理：
     * 1. 去掉「时间：」和「季节：」开头的行
     * 2. 地点字段（地点/抵达目的地）统一归一化为「地点：xxx」
     * 3. NPC 字段（在场NPC/随行NPC/切磋对手）保留原 key 名，值不变
     * 其余行（行动选择/互动内容等）原样保留。
     */
    function _buildQueryIntentText(userMessage) {
        if (!userMessage) return '';
        var lines = userMessage.replace(/<br\s*\/?>/gi, '\n').split('\n');
        var result = [];
        var locationWritten = false;
        var npcWritten = false;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            // 丢弃时间/季节行
            if (/^时间[：:]/.test(line) || /^季节[：:]/.test(line)) continue;
            // 归一化地点行（只写第一个匹配）
            var isLocationLine = false;
            for (var lk = 0; lk < _LOCATION_KEYS.length; lk++) {
                if (new RegExp('^' + _LOCATION_KEYS[lk] + '[：:]').test(line)) {
                    isLocationLine = true;
                    if (!locationWritten) {
                        var lVal = line.replace(new RegExp('^' + _LOCATION_KEYS[lk] + '[：:]'), '').trim();
                        var arrM = lVal.match(/来到(.+)/);
                        if (arrM) lVal = arrM[1].trim();
                        result.push('地点：' + lVal);
                        locationWritten = true;
                    }
                    break;
                }
            }
            if (isLocationLine) continue;
            // NPC 行：保留 key 名和值（只写第一个匹配）
            var isNpcLine = false;
            for (var nk = 0; nk < _NPC_KEYS.length; nk++) {
                if (new RegExp('^' + _NPC_KEYS[nk] + '[：:]').test(line)) {
                    isNpcLine = true;
                    if (!npcWritten) {
                        var nVal = line.replace(new RegExp('^' + _NPC_KEYS[nk] + '[：:]'), '').trim();
                        result.push(_NPC_KEYS[nk] + '：' + nVal);
                        npcWritten = true;
                    }
                    break;
                }
            }
            if (isNpcLine) continue;
            // 其余行原样保留
            result.push(line);
        }
        return result.join('\n');
    }

    /**
     * 根据 summaryHistory 条目的 UIid，在 uiConversation 中向前查找对应 user 消息，
     * 提取地点/NPC 元数据，拼接为向量化输入文本。
     * 老存档无 UIid 或找不到对应记录时，直接返回纯 summaryText。
     */
    function _buildEmbedText(summary, uiConversation) {
        var summaryText = summary.summaryText || '';
        var UIid = summary.UIid;
        if (!UIid || !Array.isArray(uiConversation)) return summaryText;

        // 找到 assistant 消息
        var assistIdx = -1;
        for (var i = uiConversation.length - 1; i >= 0; i--) {
            if (uiConversation[i].id === UIid) { assistIdx = i; break; }
        }
        if (assistIdx < 0) return summaryText;

        // 往前找最近一条 user 消息
        var userContent = '';
        for (var j = assistIdx - 1; j >= 0; j--) {
            if (uiConversation[j].role === 'user') {
                userContent = uiConversation[j].content || '';
                break;
            }
        }
        if (!userContent) return summaryText;

        var prefix = _extractLocationNpcPrefix(userContent);
        // 头尾各放一遍前缀，提升地点/NPC在向量中的权重，改善召回精度
        return prefix ? (prefix + summaryText + '\n' + prefix) : summaryText;
    }

    /**
     * 在发起请求前，核对 summaryHistory 与 emb_ 记录的一致性：
     * - summaryHistory 有但 emb_ 缺失 → 补生成 embedding
     * - emb_ 有但 summaryHistory 无对应 id → 删除 emb_
     */
    async function _syncEmbeddingsWithSummaryHistory() {
        if (typeof embeddingService === 'undefined' || !embeddingService.isEnabled()) return;
        if (typeof summaryHistoryService === 'undefined' || typeof storageService === 'undefined') return;

        var allSummaries = summaryHistoryService.getAll();
        var summaryIds = new Set(allSummaries.map(function(s) { return s.id; }));

        var embRecords = storageService.loadAllEmbeddings();
        var embIds = new Set(embRecords.map(function(r) { return r.id; }));

        // 1. emb_ 有但 summaryHistory 无 → 删除
        var toDelete = embRecords.filter(function(r) { return !summaryIds.has(r.id); });
        if (toDelete.length > 0) {
            toDelete.forEach(function(r) {
                storageService.deleteEmbedding(r.id);
                if (typeof memoryRecall !== 'undefined') memoryRecall.removeFromCache(r.id);
            });
            console.log('[EmbSync] 删除孤立 emb_ ' + toDelete.length + ' 条: ' + toDelete.map(function(r){ return r.id; }).join(', '));
        }

        // 2. summaryHistory 有但 emb_ 缺失 → 补生成
        var missing = allSummaries.filter(function(s) { return s.id && !embIds.has(s.id); });
        if (missing.length === 0) {
            if (toDelete.length === 0) {
                console.log('[EmbSync] emb_ 与 summaryHistory 完全一致，共 ' + embRecords.length + ' 条');
            }
            return;
        }

        console.log('[EmbSync] 发现 ' + missing.length + ' 条摘要缺少 emb_，开始补生成: ' + missing.map(function(s){ return s.id; }).join(', '));
        var fp = embeddingService.getFingerprint();
        var _uiHistSync = storageService.loadUIConversation();
        for (var i = 0; i < missing.length; i++) {
            var s = missing[i];
            if (!s.summaryText) continue;
            try {
                var embedText = _buildEmbedText(s, _uiHistSync);
                var vecs = await embeddingService.embed([embedText]);
                if (vecs && vecs.length > 0) {
                    var f32 = new Float32Array(vecs[0]);
                    var meta = { text: s.summaryText, week: s.week || 0, fingerprint: fp, createdAt: Date.now() };
                    storageService.saveEmbedding(s.id, f32, meta);
                    if (typeof memoryRecall !== 'undefined') memoryRecall.addToCache({ id: s.id, vector: f32, text: meta.text, week: meta.week, fingerprint: fp, createdAt: meta.createdAt });
                    console.log('[EmbSync] 已补生成 emb_' + s.id + ' (' + (i + 1) + '/' + missing.length + ')');
                    _setProgressLog('已补生成 emb_' + s.id + ' (' + (i + 1) + '/' + missing.length + ')');
                }
            } catch (e) {
                console.warn('[EmbSync] 补生成 emb_' + s.id + ' 失败:', e && e.message || e);
            }
        }
        console.log('[EmbSync] 补生成完毕，共处理 ' + missing.length + ' 条');
    }

    /**
     * 在发起请求前，核对 eventHistory 与 wevt_（L2 事件向量）的一致性：
     * - wevt_ 有但 eventHistory 无 → 删孤（删孤先于重写，事件号复用安全，见方案 §4.1）
     * - eventHistory 有但 wevt_ 缺失 → 补生成（向量化失败的事件下一轮自愈）
     * 与 L0 的 _syncEmbeddingsWithSummaryHistory 完全分开，各走各的缓存。
     */
    async function _syncL2EmbeddingsWithEventHistory() {
        if (typeof embeddingService === 'undefined' || !embeddingService.isEnabled()) return;
        if (typeof eventHistoryService === 'undefined' || typeof storageService === 'undefined') return;
        if (!storageService.loadAllL2Embeddings) return;

        var allEvents = eventHistoryService.getAll();
        var eventIds = new Set(allEvents.map(function(e) { return e.id; }));

        var l2Records = storageService.loadAllL2Embeddings();
        var l2Ids = new Set(l2Records.map(function(r) { return r.id; }));

        // 1. wevt_ 有但 eventHistory 无 → 删孤
        var toDelete = l2Records.filter(function(r) { return !eventIds.has(r.id); });
        if (toDelete.length > 0) {
            toDelete.forEach(function(r) {
                storageService.deleteL2Embedding(r.id);
                if (typeof memoryRecall !== 'undefined' && memoryRecall.removeFromCacheL2) memoryRecall.removeFromCacheL2(r.id);
            });
            console.log('[L2Sync] 删除孤立 wevt_ ' + toDelete.length + ' 条: ' + toDelete.map(function(r){ return r.id; }).join(', '));
        }

        // 2. eventHistory 有但 wevt_ 缺失 → 补生成
        var missing = allEvents.filter(function(e) { return e.id && !l2Ids.has(e.id); });
        if (missing.length === 0) {
            if (toDelete.length === 0) {
                console.log('[L2Sync] wevt_ 与 eventHistory 完全一致，共 ' + l2Records.length + ' 条');
            }
            return;
        }
        console.log('[L2Sync] 发现 ' + missing.length + ' 条事件缺少 wevt_，开始补生成: ' + missing.map(function(e){ return e.id; }).join(', '));
        var fp = embeddingService.getFingerprint();
        for (var i = 0; i < missing.length; i++) {
            var ev = missing[i];
            try {
                var text = eventHistoryService.buildEventEmbedText(ev);
                var vecs = await embeddingService.embed([text]);
                if (vecs && vecs.length > 0) {
                    var f32 = new Float32Array(vecs[0]);
                    var meta = { text: text, week: ev.week || 0, fingerprint: fp, createdAt: Date.now() };
                    storageService.saveL2Embedding(ev.id, f32, meta);
                    if (typeof memoryRecall !== 'undefined' && memoryRecall.addToCacheL2) {
                        memoryRecall.addToCacheL2({ id: ev.id, vector: f32, text: text, week: meta.week, fingerprint: fp, createdAt: meta.createdAt, keywords: ev.keywords, npc: ev.npc, location: ev.location });
                    }
                    console.log('[L2Sync] 已补生成 wevt_' + ev.id + ' (' + (i + 1) + '/' + missing.length + ')');
                    _setProgressLog('已补生成 wevt_' + ev.id + ' (' + (i + 1) + '/' + missing.length + ')');
                }
            } catch (e) {
                console.warn('[L2Sync] 补生成 wevt_' + ev.id + ' 失败:', e && e.message || e);
            }
        }
        console.log('[L2Sync] 补生成完毕，共处理 ' + missing.length + ' 条');
    }

    async function runTurn(message, options) {
        options = options || {};
        var isRegenerate = options.isRegenerate || false;

        // === 请求阶段（无副作用，失败可安全重试）===
        var preprocessed = _preprocessMessage(message);

        var lastAssistantReply = _getLastAssistantContent(storageService.loadUIConversation());

        // 向量补全阶段：提前显示蒙版，防止用户误以为卡死
        var _embEnabled = typeof embeddingService !== 'undefined' && embeddingService.isEnabled && embeddingService.isEnabled();
        if (_embEnabled) {
            _showStreamMask();
            _setInteractionEnabled(false);
            _setStreamLog('施延年翻阅旧卷');
        }

        // Phase 3：发起请求前，同步 emb_ 与 summaryHistory 一致性
        try {
            await _syncEmbeddingsWithSummaryHistory();
        } catch (syncErr) {
            console.warn('[EmbSync] 同步异常，跳过:', syncErr && syncErr.message || syncErr);
        }

        // Phase L2：发起请求前，同步 wevt_ 与 eventHistory 一致性（删孤先于召回）
        try {
            await _syncL2EmbeddingsWithEventHistory();
        } catch (l2SyncErr) {
            console.warn('[L2Sync] 同步异常，跳过:', l2SyncErr && l2SyncErr.message || l2SyncErr);
        }

        // Phase 3：向量召回（在 buildMessages 前，不阻塞流程）
        var recalledMemories = [];
        var recalledEvents = null;
        if (typeof memoryRecall !== 'undefined' && typeof embeddingService !== 'undefined' && embeddingService.isEnabled()) {
            try {
                var allSummaries = summaryHistoryService.getAll();

                // ① 排除 RecentMemories 候选池：与 _selectRecentSummaries 保持相同阈值
                var _wh = (typeof weekHistoryService !== 'undefined') ? weekHistoryService.getAll() : [];
                var _lastWHEntry = _wh.length > 0 ? _wh[_wh.length - 1] : null;
                var _recentThreshold = _lastWHEntry ? (_lastWHEntry.markWeek || _lastWHEntry.week || 1) : 1;
                var excludeIds = allSummaries
                    .filter(function(s) { return (s.week || 1) >= _recentThreshold; })
                    .map(function(s) { return s.id; });

                // ② 双路查询文本构造
                var _uiForQuery = storageService.loadUIConversation();

                // --- Q_intent：当前用户输入，去掉时间/季节行，地点/NPC字段归一化为入库格式 ---
                var _intentText = _buildQueryIntentText(preprocessed);

                // --- Q_context：上一轮AI回复原文，前置从上轮用户消息提取的地点/NPC前缀 ---
                var _lastAssistIdx = -1;
                for (var _qi = _uiForQuery.length - 1; _qi >= 0; _qi--) {
                    if (_uiForQuery[_qi].role === 'assistant') { _lastAssistIdx = _qi; break; }
                }
                var _contextBase = lastAssistantReply || '';
                var _contextText = '';
                if (_contextBase && _lastAssistIdx > 0) {
                    // 找上一轮 user 消息
                    for (var _qi2 = _lastAssistIdx - 1; _qi2 >= 0; _qi2--) {
                        if (_uiForQuery[_qi2].role === 'user') {
                            var _ctxPrefix = _extractLocationNpcPrefix(_uiForQuery[_qi2].content || '');
                            _contextText = _ctxPrefix ? (_ctxPrefix + _contextBase) : _contextBase;
                            break;
                        }
                    }
                }
                if (!_contextText) _contextText = _contextBase;

                // ③ 一次批量 embed（两路）
                var _embedInputs = [_intentText];
                var _hasContext = !!_contextText;
                if (_hasContext) _embedInputs.push(_contextText);

                var _embedVecs = await embeddingService.embed(_embedInputs);
                var _intentVec = _embedVecs[0] ? new Float32Array(_embedVecs[0]) : null;
                var _contextVec = (_hasContext && _embedVecs[1]) ? new Float32Array(_embedVecs[1]) : null;

                if (!_intentVec) throw new Error('Q_intent embed 返回空');

                // ④ focusCharacters：扫描 intent + context 文本，提取已知 NPC 名字
                var _combinedForNpc = _intentText + ' ' + _contextText;
                var _focusCharacters = [];
                if (typeof npcNameToId !== 'undefined') {
                    var _npcNameKeys = Object.keys(npcNameToId);
                    for (var _nki = 0; _nki < _npcNameKeys.length; _nki++) {
                        if (_combinedForNpc.indexOf(_npcNameKeys[_nki]) !== -1) {
                            _focusCharacters.push(_npcNameKeys[_nki]);
                        }
                    }
                }

                // 保存查询信息供 memory-recall.js 的 log 读取
                window._lastQuerySegments = {
                    intent: { text: _intentText },
                    context: { text: _contextText }
                };
                console.groupCollapsed('[Pipeline] Query向量构成（展开查看）');
                console.log('Q_intent: ' + _intentText);
                console.log('Q_context: ' + (_contextText.length > 300 ? _contextText.slice(0, 300) + '...' : _contextText));
                console.log('排除RecentMemories: ' + excludeIds.length + '条 | focusNPC=[' + _focusCharacters.join(',') + ']');
                console.groupEnd();

                // rerankQuery：intent 为主，context 截取前 500 字作补充（与 L2 精排 query 对齐）
                var _l0RerankQuery = _intentText + (_contextText ? ('\n' + _contextText.slice(0, 500)) : '');
                // [相关碎片记忆] token 上限：由 系统设置-游戏设置-召回管理 弹窗控制（gameData.recallConfig.fragments.maxTokens）
                var _recallCfg = (gameData && gameData.recallConfig) || {};
                var _fragmentsMaxTokens = (_recallCfg.fragments && _recallCfg.fragments.maxTokens) || 3000;
                recalledMemories = await memoryRecall.recallRelevantMemories(_intentVec, 10, excludeIds, _fragmentsMaxTokens, _focusCharacters, _contextVec, _intentText.length, _contextText.length, _l0RerankQuery);

                // === L2 剧情事件层：双路 RRF 召回 → Rerank 精排 → 因果链 → 挂载 L0 ===
                if (typeof eventHistoryService !== 'undefined' && memoryRecall.recallL2Events && _intentVec) {
                    try {
                        var _allEvents = eventHistoryService.getAll();
                        if (_allEvents.length > 0) {
                            // L2 排除近期事件（week >= 同一 threshold，已在上下文窗口里）
                            // 兜底：老存档事件 week=0 时，用 uiEnd 相对位置判断（近 40 条内视为近期，约 2×STEP_DEFAULT）
                            var _uiConvLen = _uiForQuery.length;
                            var _excludeL2 = _allEvents
                                .filter(function(e) {
                                    var ew = e.week || 0;
                                    if (ew > 0) return ew >= _recentThreshold;
                                    // week=0：uiEnd 在末尾 40 条内则视为近期
                                    return typeof e.uiEnd === 'number' && e.uiEnd >= _uiConvLen - 40;
                                })
                                .map(function(e) { return e.id; });

                            var _l2Candidates = memoryRecall.recallL2Events(_intentVec, _contextVec, {
                                excludeIds: _excludeL2,
                                focusCharacters: _focusCharacters,
                                candidateLimit: 30,
                                intentTextLen: _intentText.length,
                                contextTextLen: _contextText.length,
                                intentText: _intentText,
                                contextText: _contextText
                            });

                            console.log('[Pipeline][L2] 粗排候选 ' + _l2Candidates.length + ' 条（排除近期 ' + _excludeL2.length + ' 条，allEvents=' + _allEvents.length + '）');
                            if (_l2Candidates.length > 0) {
                                // mustKeep 规则简化：_l2Candidates 已按 rrfScore（融合 intent/context/词法三路信号）降序，
                                // 直接取全局排名 Top _MUSTKEEP_CAP 条免精排，其余全部送 _normal 精排。
                                // 不再区分"实体强命中"/"词法旁路"——rrfScore 本身已经融合了这些信号，且固定 3 条
                                // 能保证精排至少拿到 7-3=4 个名额，避免旧规则里 mustKeep 无上限占满 DIRECT 预算、
                                // 精排完全被跳过的情况。
                                var _MUSTKEEP_CAP = 3;
                                var _mustKeep = _l2Candidates.slice(0, _MUSTKEEP_CAP);
                                var _normal = _l2Candidates.slice(_MUSTKEEP_CAP);

                                console.log('[Pipeline][L2] 分流：RRF Top' + _MUSTKEEP_CAP + '(免精排) ' + _mustKeep.length + ' 条 | 送精排 ' + _normal.length + ' 条'
                                    + (_mustKeep.length > 0 ? ' | mustKeep=[' + _mustKeep.map(function(c){ return c.id + (c.lexBypass ? '🔓词法' : ''); }).join(',') + ']' : ''));

                                // rerank 精排普通候选（焦点在前的自然语言 query）
                                var _rerankQuery = _intentText + (_contextText ? ('\n' + _contextText.slice(0, 500)) : '');
                                var _rerankTopN = Math.max(0, 7 - _mustKeep.length);
                                var _reranked = [];
                                if (_normal.length > 0 && _rerankTopN > 0 && typeof reranker !== 'undefined') {
                                    _reranked = await reranker.rerankEvents(_rerankQuery, _normal, { topN: _rerankTopN, minScore: 0.10 });

                                    // Rerank 前→后对比日志
                                    console.groupCollapsed('[Pipeline][L2] Rerank 前→后对比（送入 ' + _normal.length + ' 条→精排后 ' + _reranked.length + ' 条）');
                                    console.log('── 精排前（RRF 分降序）──');
                                    var _bfTop = Math.min(10, _normal.length);
                                    for (var _bri = 0; _bri < _bfTop; _bri++) {
                                        var _bc = _normal[_bri];
                                        console.log('[' + (_bri + 1) + '] rrf=' + (_bc.rrfScore || 0).toFixed(5) + ' intent=' + (_bc.similarity || 0).toFixed(4) + ' | ' + _bc.id);
                                        console.log('    ' + (_bc.text || '').slice(0, 100));
                                    }
                                    console.log('── 精排后（Rerank 分降序）──');
                                    for (var _ari = 0; _ari < _reranked.length; _ari++) {
                                        var _ac = _reranked[_ari];
                                        var _prevRank = -1;
                                        for (var _pri = 0; _pri < _normal.length; _pri++) { if (_normal[_pri].id === _ac.id) { _prevRank = _pri + 1; break; } }
                                        var _delta = _prevRank > 0 ? (_prevRank - (_ari + 1) > 0 ? '↑' + (_prevRank - _ari - 1) : (_prevRank === _ari + 1 ? '─' : '↓' + (_ari + 1 - _prevRank))) : '?';
                                        console.log('[' + (_ari + 1) + '] rerank=' + (_ac.rerankScore || 0).toFixed(4) + ' (原RRF排' + _prevRank + ' ' + _delta + ') | ' + _ac.id);
                                        console.log('    ' + (_ac.text || '').slice(0, 100));
                                    }
                                    console.groupEnd();
                                } else if (_rerankTopN <= 0) {
                                    console.log('[Pipeline][L2] mustKeep 已占满名额，跳过精排');
                                }

                                // DIRECT 候选 = mustKeep ∪ reranked（按 id 去重，mustKeep 在前）
                                var _directIds = {};
                                var _directCands = [];
                                var _pushDirect = function(c) { if (c && !_directIds[c.id]) { _directIds[c.id] = true; _directCands.push(c); } };
                                _mustKeep.forEach(_pushDirect);
                                _reranked.forEach(_pushDirect);

                                // 候选 → 完整事件对象
                                var _eventById = {};
                                for (var _ei = 0; _ei < _allEvents.length; _ei++) _eventById[_allEvents[_ei].id] = _allEvents[_ei];
                                var _directEvents = [];
                                for (var _di = 0; _di < _directCands.length; _di++) {
                                    var _evObj = _eventById[_directCands[_di].id];
                                    if (_evObj) _directEvents.push(_evObj);
                                }

                                // 因果链追溯 + 链路合并（A1 策略）：若某条直接命中事件的前因恰好也是本轮
                                // 其他直接命中事件，则把它从顶层编号列表里剔除，合并进引用它的那条因果链
                                // （由 priorById 提供内容，不再单独挂 L0 证据）。多条命中事件共享同一前因时
                                // 不做去重/交叉引用，各自渲染时都会完整展示一遍。
                                var _traceResult = memoryRecall.traceCausation
                                    ? memoryRecall.traceCausation(_directEvents, _eventById, { maxDepth: 4, maxAdd: 20 })
                                    : { traced: [], absorbedIds: [] };
                                var _priorEvents = _traceResult.traced || [];
                                var _absorbedIds = _traceResult.absorbedIds || [];
                                if (_absorbedIds.length > 0) {
                                    var _absorbedSet = {};
                                    for (var _asi = 0; _asi < _absorbedIds.length; _asi++) _absorbedSet[_absorbedIds[_asi]] = true;
                                    var _beforeMergeCount = _directEvents.length;
                                    _directEvents = _directEvents.filter(function(ev) { return !_absorbedSet[ev.id]; });
                                    console.log('[Pipeline][L2] 链路合并：' + _absorbedIds.length + ' 条直接命中事件被合并为前因（顶层 '
                                        + _beforeMergeCount + ' → ' + _directEvents.length + '）| 合并id=[' + _absorbedIds.join(',') + ']');
                                }

                                // 转为 id→事件 字典，供 prompt-builder 内联渲染树形因果链
                                var _priorById = {};
                                for (var _pbi = 0; _pbi < _priorEvents.length; _pbi++) {
                                    _priorById[_priorEvents[_pbi].id] = _priorEvents[_pbi];
                                }

                                // 挂载键：uiConv 消息 id → index；summaryHistory id → UIid
                                var _idxMap = new Map();
                                for (var _ui = 0; _ui < _uiForQuery.length; _ui++) _idxMap.set(_uiForQuery[_ui].id, _ui);
                                var _summaryById = {};
                                var _allSum = summaryHistoryService.getAll();
                                for (var _ssi = 0; _ssi < _allSum.length; _ssi++) _summaryById[_allSum[_ssi].id] = _allSum[_ssi].UIid;

                                // 挂载 L0 证据 + 记录 usedL0（最多7条或 [相关历史事件] token 上限先到为准）
                                // 降级机制：预算超限时先尝试不带证据版本；若仍超限则停止。
                                // 一旦触发降级，后续事件全部走无证据路径（allowEvidence 开关）。
                                var _usedL0 = {};
                                var _directWithEvidence = [];
                                var _l2Tokens = 0;
                                // [相关历史事件] token 上限：由 系统设置-游戏设置-召回管理 弹窗控制（gameData.recallConfig.events.maxTokens）
                                var _L2_TOKEN_LIMIT = (_recallCfg.events && _recallCfg.events.maxTokens) || 5000;
                                var _allowEvidence = true;
                                var _estTok = function(t) { if (!t) return 0; var ch = (t.match(/[\u4e00-\u9fff]/g)||[]).length; return Math.ceil(ch + (t.length - ch) / 4); };
                                for (var _dwei = 0; _dwei < _directEvents.length; _dwei++) {
                                    var ev = _directEvents[_dwei];
                                    // 收集该事件范围内的 L0 证据（仅当 allowEvidence 时才挂载）
                                    var evidence = [];
                                    var _candidateL0Ids = [];
                                    if (_allowEvidence) {
                                        for (var _mi = 0; _mi < recalledMemories.length; _mi++) {
                                            var l0 = recalledMemories[_mi];
                                            var _uiid = _summaryById[l0.id];
                                            var _l0Idx = (_uiid != null) ? _idxMap.get(_uiid) : null;
                                            if (_l0Idx != null && typeof ev.uiStart === 'number' && typeof ev.uiEnd === 'number'
                                                && _l0Idx >= ev.uiStart && _l0Idx <= ev.uiEnd) {
                                                evidence.push({ week: l0.week, text: l0.text });
                                                _candidateL0Ids.push(l0.id);
                                            }
                                        }
                                    }
                                    var _evBase = _estTok((ev.title || '') + (ev.description || ''));
                                    var _evEvidCost = evidence.reduce(function(s, e2) { return s + _estTok(e2.text); }, 0);
                                    var _evCostFull = _evBase + _evEvidCost;
                                    var _evCostNoEvid = _evBase;

                                    // 第一条事件不受 token 限制（保证至少注入一条）
                                    if (_directWithEvidence.length === 0) {
                                        for (var _li = 0; _li < _candidateL0Ids.length; _li++) _usedL0[_candidateL0Ids[_li]] = true;
                                        _l2Tokens += _evCostFull;
                                        _directWithEvidence.push({ event: ev, evidence: evidence });
                                        continue;
                                    }

                                    if (_l2Tokens + _evCostFull <= _L2_TOKEN_LIMIT) {
                                        // 预算充足：带完整证据放入
                                        for (var _li2 = 0; _li2 < _candidateL0Ids.length; _li2++) _usedL0[_candidateL0Ids[_li2]] = true;
                                        _l2Tokens += _evCostFull;
                                        _directWithEvidence.push({ event: ev, evidence: evidence });
                                    } else if (_l2Tokens + _evCostNoEvid <= _L2_TOKEN_LIMIT) {
                                        // 降级：不带证据放入，开关关闭，后续全部无证据
                                        if (_allowEvidence && evidence.length > 0) _allowEvidence = false;
                                        _l2Tokens += _evCostNoEvid;
                                        _directWithEvidence.push({ event: ev, evidence: [] });
                                    } else {
                                        // 即使不带证据也放不下：停止
                                        break;
                                    }
                                }

                                // [相关历史事件] 开关：由 系统设置-游戏设置-召回管理 弹窗控制（gameData.recallConfig.events.enabled）
                                // 关闭时不注入 recalledEvents，且不把挂载证据用掉的 L0 从 recalledMemories 中剔除，
                                // 保证这些 L0 仍能作为 [相关碎片记忆] 注入。
                                var _eventsEnabled = !_recallCfg.events || _recallCfg.events.enabled !== false;
                                if (_eventsEnabled) {
                                    recalledEvents = { direct: _directWithEvidence, priorById: _priorById, absorbedIds: _absorbedIds };
                                    // 孤儿 L0 = 未被挂载的 L0 → 仍作 RecalledMemories
                                    recalledMemories = recalledMemories.filter(function(l0) { return !_usedL0[l0.id]; });
                                } else {
                                    recalledEvents = null;
                                }

                                console.log('[Pipeline][L2] DIRECT ' + _directWithEvidence.length + ' (mustKeep ' + _mustKeep.length + '+精排 ' + _reranked.length + ') token=' + _l2Tokens + (_allowEvidence ? '' : ' [已降级无证据]') + ' | 前因 ' + _priorEvents.length + ' | 孤儿L0 ' + recalledMemories.length);
                                // 折叠详情：逐条 DIRECT 事件 + 挂载证据数，对齐 L0 召回粒度
                                console.groupCollapsed('[Pipeline][L2] 最终装配详情（展开查看）');
                                _directWithEvidence.forEach(function(d, idx) {
                                    var _ev = d.event;
                                    var _kept = _directIds[_ev.id] && _mustKeep.some(function(c){ return c.id === _ev.id; });
                                    console.log('DIRECT[' + (idx + 1) + '] ' + _ev.id + (_kept ? ' (mustKeep)' : ' (精排)')
                                        + ' week=' + (_ev.week || 0) + ' ui=' + _ev.uiStart + '..' + _ev.uiEnd
                                        + ' | 挂载L0证据 ' + d.evidence.length + ' 条 | ' + (_ev.title || '') + '：' + (_ev.description || ''));
                                    d.evidence.forEach(function(ed) { console.log('    [证据] week=' + ed.week + ' ' + (ed.text || '').slice(0, 80)); });
                                });
                                _priorEvents.forEach(function(pe, idx) {
                                    console.log('前因[' + (idx + 1) + '] ' + pe.id + ' | ' + (pe.title || '') + '：' + (pe.description || ''));
                                });
                                console.groupEnd();
                            }
                        }
                    } catch (l2Err) {
                        console.warn('[Pipeline] L2 召回/组装失败，降级:', l2Err && l2Err.message || l2Err);
                        recalledEvents = null;
                    }
                }
            } catch (recallErr) {
                console.warn('[Pipeline] 向量召回失败，降级为空:', recallErr && recallErr.message || recallErr);
                recalledMemories = [];
                recalledEvents = null;
            }
        }

        var messages = promptBuilder.buildMessages({
            userMessage: preprocessed,
            gameData: gameData,
            summaryHistory: summaryHistoryService.getAll(),
            weekHistory: (typeof weekHistoryService !== 'undefined') ? weekHistoryService.getAll() : [],
            lastAssistantReply: lastAssistantReply,
            recalledMemories: recalledMemories,
            recalledEvents: recalledEvents
        });

        // === [DEBUG] 发起请求前：打印事件相关变量当前值 ===
        console.log('[Pipeline][DEBUG] 发起请求前变量状态:',
            'enamor=' + enamor,
            'randomEvent=' + randomEvent,
            'battleEvent=' + battleEvent,
            '| gameData.enamor=' + gameData.enamor,
            'gameData.randomEvent=' + gameData.randomEvent,
            'gameData.battleEvent=' + gameData.battleEvent,
            '| currentRandomEvent=' + (currentRandomEvent ? currentRandomEvent['事件类型'] : 'null'),
            'currentBattleEvent=' + (currentBattleEvent ? currentBattleEvent['事件类型'] : 'null')
        );

        // === 完整 prompt log ===
        window._lastPipelineMessages = messages;
        console.groupCollapsed('[Pipeline] 发送消息（共 ' + messages.length + ' 条）');
        messages.forEach(function(m, i) {
            console.log('[' + i + '] ' + m.role + ':\n' + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
        });
        console.groupEnd();

        var rawText;
        var wasAborted = false;
        try {
            console.log('[Pipeline] 发送 API 请求（流式）...');
            _showStreamControls();
            _setStreamLog('施延年铺纸研墨');
            var streamResult = await _requestWithStream(messages);
            rawText = streamResult.text;
            wasAborted = streamResult.aborted;
            console.log('[Pipeline] 流式请求完成, 内容长度:', rawText.length, '中断:', wasAborted);
            window._lastPipelineLLMReply = rawText;
            console.groupCollapsed('[Pipeline] LLM 完整回复');
            console.log(rawText);
            console.groupEnd();
            // 打印思维链（如有）
            var thinkingText = streamResult.thinking || '';
            if (!thinkingText) {
                // 尝试从正文提取内联 <think>...</think> 标签（Qwen3/其他模型）
                var inlineMatch = rawText.match(/<think(?:ing)?[^>]*>([\s\S]*?)<\/think(?:ing)?>/i);
                if (inlineMatch) thinkingText = inlineMatch[1];
            }
            if (thinkingText && thinkingText.trim()) {
                console.groupCollapsed('[Pipeline] 思维链');
                console.log(thinkingText.trim());
                console.groupEnd();
            }
        } catch (err) {
            _hideStreamControls();
            _setStreamLog('施延年墨尽笔折');
            console.error('[Pipeline] API 请求失败:', err.message);
            if (typeof showModal === 'function') {
                showModal('AI 请求失败：' + err.message + '\n\n可点击重试');
            }
            throw err;
        }

        _hideStreamControls();

        // 中断时不提交副作用，只保留已渲染的文本
        if (wasAborted) {
            console.log('[Pipeline] 用户中断，跳过提交阶段');
            // 对齐 SR：中断也相当于本轮结束，重置临时标记
            enamor = 0;
            randomEvent = 0;
            battleEvent = 0;
            gameData.enamor = 0;
            gameData.randomEvent = 0;
            gameData.battleEvent = 0;
            console.log('[Pipeline][DEBUG] 中断路径：事件变量已归零');
            if (typeof showModal === 'function' && typeof isInRenderEnvironment === 'function' && !isInRenderEnvironment()) {
                showModal('本轮输出已中断，未自动存档，建议重新生成。');
            }
            return;
        }

        // === 提交阶段（有副作用，按顺序可控）===
        await _commitResponse(preprocessed, rawText, isRegenerate);
    }

    /**
     * 流式请求 + 节流渲染（阶段 A）
     * 返回 Promise<{text: string, aborted: boolean}>
     */
    function _requestWithStream(messages) {
        // 按 API 配置决定流式 / 非流式（正文与总结统一遵循同一开关）
        var _streamMode = (apiService.getConfig && apiService.getConfig().streamMode) || 'stream';
        if (_streamMode === 'non-stream') {
            return _fallbackNonStream(messages).then(function(text) {
                return { text: text, aborted: _abortRequested };
            });
        }
        return new Promise(function(resolve, reject) {
            var accumulatedText = '';
            var accumulatedThinking = ''; // 累积思维链（reasoning_content 字段，如 DeepSeek/Qwen）
            var throttleTimer = null;
            var aborted = false;
            _isStreaming = true;
            _abortRequested = false;

            function doRender() {
                try {
                    var cleaned = responseParser.removeThinkingContent(accumulatedText);
                    var mainText = responseParser.extractMainText(cleaned);
                    if (mainText && typeof updateStoryText === 'function') {
                        updateStoryText(mainText);
                    }
                } catch (e) {
                    console.warn('[Pipeline] 流式渲染异常:', e.message);
                }
            }

            var handle = apiService.sendMessagesStream(messages, {
                onToken: function(delta) {
                    if (accumulatedText === '') _setStreamLog('施延年伏案疾书');
                    accumulatedText += delta;
                    if (!throttleTimer) {
                        throttleTimer = setTimeout(function() {
                            throttleTimer = null;
                            doRender();
                        }, 1500);
                    }
                },
                onThinking: function(delta) {
                    // 累积思维链内容（DeepSeek/Qwen 的 reasoning_content 字段）
                    if (accumulatedThinking === '') _setStreamLog('施延年蹙眉沉吟');
                    accumulatedThinking += delta;
                },
                onComplete: function(fullText, usage) {
                    _setStreamLog('施延年题尾落款');
                    _isStreaming = false;
                    aborted = _abortRequested;
                    _currentAbort = null;
                    _abortRequested = false;
                    clearTimeout(throttleTimer);
                    throttleTimer = null;
                    // 完成后交给正式 renderMainText 做完整处理（分页等）
                    accumulatedText = fullText;
                    try {
                        var cleaned = responseParser.removeThinkingContent(fullText);
                        var mainText = responseParser.extractMainText(cleaned);
                        if (mainText && typeof renderMainText === 'function') renderMainText(mainText);
                    } catch (e) {}
                    resolve({ text: fullText, aborted: aborted, thinking: accumulatedThinking });
                },
                onError: function(err) {
                    _isStreaming = false;
                    _currentAbort = null;
                    clearTimeout(throttleTimer);
                    throttleTimer = null;
                    // 降级：尝试非流式
                    console.warn('[Pipeline] 流式失败，尝试非流式降级:', err.message);
                    _setStreamLog('施延年另起新卷');
                    _fallbackNonStream(messages).then(function(text) {
                        resolve({ text: text, aborted: _abortRequested });
                    }).catch(reject);
                }
            });

            _currentAbort = handle;
        });
    }

    /**
     * 降级：非流式调用（支持中断）
     */
    async function _fallbackNonStream(messages) {
        console.log('[Pipeline] 非流式降级请求...');
        _setStreamLog('施延年另起新卷');
        var controller = new AbortController();
        // 挂载中断句柄，使停止按钮在降级期间仍可用
        _isStreaming = true;
        _abortRequested = false;
        _currentAbort = { abort: function() { _abortRequested = true; controller.abort(); } };
        try {
            var result = await apiService.sendMessages(messages, { signal: controller.signal });
            _isStreaming = false;
            _currentAbort = null;
            // 渲染完整结果
            try {
                var cleaned = responseParser.removeThinkingContent(result.content);
                var mainText = responseParser.extractMainText(cleaned);
                if (mainText && typeof renderMainText === 'function') {
                    renderMainText(mainText);
                }
            } catch (e) {}
            return result.content;
        } catch (err) {
            _isStreaming = false;
            _currentAbort = null;
            if (err.name === 'AbortError' || _abortRequested) {
                // 用户主动中断，返回空内容让上层走 wasAborted 路径
                _abortRequested = true;
                return '';
            }
            throw err;
        }
    }

    /**
     * 提交阶段（阶段 B）
     */
    async function _commitResponse(preprocessed, rawText, isRegenerate) {
        try {
            // 1. 写入用户消息到 UI 历史
            // 重生成时快照已还原（本轮 user 消息尚未追加），直接 append 即可，无需替换
            storageService.appendUIConversation({
                id: 'u' + Date.now(),
                role: 'user',
                content: preprocessed,
                week: currentWeek,
                createdAt: Date.now()
            });

            // 2. 解析 AI 回复
            var parsed = responseParser.run(rawText);

            // 3. 应用 SIDE_NOTE 和摘要到全局变量
            _applyParsedSideNote(parsed);
            _applySummaryUpdate(parsed);

            // 4. 将全局变量同步到 gameData 并持久化
            syncGameDataFromVariables();

            // 对齐 SR 链路：SR 每轮重建 iframe 导致 loadOrInitGameData → enamor=0
            // 独立前端在每轮提交后同样清零，randomEvent/battleEvent 也不跨轮持久化
            enamor = 0;
            randomEvent = 0;
            battleEvent = 0;
            gameData.enamor = 0;
            gameData.randomEvent = 0;
            gameData.battleEvent = 0;
            console.log('[Pipeline][DEBUG] 提交路径：syncGameDataFromVariables 后已归零，即将 saveAppState');

            // 4.5 每轮必须的环境刷新
            if (typeof checkAllValueRanges === 'function') {
                checkAllValueRanges();
            }
            if (typeof calculateSeason === 'function') {
                var newSeason = calculateSeason(currentWeek);
                if (newSeason !== seasonStatus) {
                    seasonStatus = newSeason;
                }
            }
            if (typeof updateSceneBackgrounds === 'function') {
                updateSceneBackgrounds();
            }
            if (typeof displayNpcs === 'function') {
                var activeScene = document.querySelector('.scene.active');
                if (activeScene && activeScene.id !== 'map-scene') {
                    displayNpcs(activeScene.id.replace('-scene', ''));
                }
            }
            if (typeof updateLocationHeadcountLabels === 'function') {
                updateLocationHeadcountLabels();
            }
            if (typeof updateFreeActionInputState === 'function') {
                updateFreeActionInputState();
            }
            if (typeof updateSLGReturnButton === 'function') {
                updateSLGReturnButton();
            }

            // 5. 最终渲染（完整解析后的 mainText）
            if (typeof renderMainText === 'function') {
                renderMainText(parsed.mainText);
            }
            if (typeof updateAllDisplays === 'function') {
                updateAllDisplays();
            }

            // 6+7. 仅在摘要成功解析时，才保存 AI 回复到 UI 历史并标记本轮已提交
            // 若在 <SUMMARY> 之前截断，parsed.summaries 为空，跳过此块，
            // UIConversation 保留上一轮的正确内容，重生成时 LatestReply 不会被污染。
            if (parsed.summaries && parsed.summaries.length > 0) {
                // 特殊事件由 handleSpecialEvent 调用 _commitResponse，通过 rawText 来源区分
                var _summarySource = (typeof _currentSummarySource !== 'undefined' && _currentSummarySource)
                    ? _currentSummarySource : 'llm';
                // newWeek===1 时，本轮摘要进入 weekHistory（周摘要），不进入 summaryHistory，不量化不召回
                if (newWeek === 1 && typeof weekHistoryService !== 'undefined') {
                    var _targetMarkWeek = typeof markWeek !== 'undefined' ? markWeek : currentWeek;
                    // ⑧ 检查是否已有 runSummary 最终版本（重生成场景B保护）
                    var _hasRunSummary = weekHistoryService.hasRunSummaryEntry &&
                        weekHistoryService.hasRunSummaryEntry(_targetMarkWeek);

                    if (_hasRunSummary) {
                        console.log('[Pipeline] markWeek=' + _targetMarkWeek + ' 已存在 runSummary 最终版本，跳过 buff 收集和初版写入');
                    } else {
                        // ⑨ 读旧 markWeekUiIndex
                        var _oldIdx = storageService.getMarkWeekUiIndex ? storageService.getMarkWeekUiIndex() : 0;

                        // ⑩ 收集 summaryBuff：uiConversation.slice(oldIdx) 中 assistant 条目
                        //    注意：此时 appendUIConversation(assistant) 尚未调用，本轮 assistant 不在 buff 中
                        var _uiConvNow = storageService.loadUIConversation();

                        // 安全检查：_oldIdx 超出当前 uiConversation 长度时（读档后可能出现），重置为 0
                        if (_oldIdx >= _uiConvNow.length) {
                            console.warn('[Pipeline] markWeekUiIndex (' + _oldIdx + ') 超出 uiConversation 长度 (' + _uiConvNow.length + ')，重置为 0 重新收集 buff');
                            _oldIdx = 0;
                        }
                        var _buffSlice = _uiConvNow.slice(_oldIdx).filter(function(m) { return m.role === 'assistant'; });
                        var _turnCount = _buffSlice.length;

                        // 楼层 → 摘要映射：按 UIid 把 summaryHistory 分组（同一楼 assistant 可能有多条摘要，全部拼接）
                        // 周总结请求注入缩略内容替代原文，压缩 prompt 体积；找不到对应摘要的楼层回退原文
                        var _sumByUIid = {};
                        if (typeof summaryHistoryService !== 'undefined' && summaryHistoryService.getAll) {
                            var _allSum = summaryHistoryService.getAll() || [];
                            for (var _si = 0; _si < _allSum.length; _si++) {
                                var _rec = _allSum[_si];
                                if (!_rec || !_rec.UIid || !_rec.summaryText) continue;
                                if (!_sumByUIid[_rec.UIid]) _sumByUIid[_rec.UIid] = [];
                                _sumByUIid[_rec.UIid].push(_rec.summaryText);
                            }
                        }
                        var _buffText = _buffSlice.map(function(m, i) {
                            var _weekLine = '';
                            if (m.week) {
                                var _w = m.week;
                                var _wy = Math.floor((_w - 1) / 48) + 1;
                                var _wr = (_w - 1) % 48;
                                var _wm = Math.floor(_wr / 4) + 1;
                                var _wk = _wr % 4 + 1;
                                _weekLine = '\n[第' + _wy + '年第' + _wm + '月第' + _wk + '周]';
                            }
                            var _sums = m.id ? _sumByUIid[m.id] : null;
                            var _floorText = (_sums && _sums.length) ? _sums.join('\n') : m.content;
                            return '[第' + (i + 1) + '轮]' + _weekLine + '\n' + _floorText;
                        }).join('\n\n');

                        // ⑪ 持久化 summaryBuff
                        if (storageService.enqueueSummaryBuff) {
                            storageService.enqueueSummaryBuff({
                                targetMarkWeek: _targetMarkWeek,
                                prevMarkWeekUiIndex: _oldIdx,
                                turnCount: _turnCount,
                                text: _buffText
                            });
                            console.log('[Pipeline] summaryBuff 已入队: targetMarkWeek=' + _targetMarkWeek + ', turnCount=' + _turnCount + ', chars=' + _buffText.length + ', oldIdx=' + _oldIdx);
                        }

                        // ⑫ 写初版总结（source='runTurn'）
                        weekHistoryService.append(parsed.summaries, 'runTurn');

                        // ⑬ 更新 markWeekUiIndex（在 appendUIConversation(assistant) 之前，故不含本轮 assistant）
                        if (storageService.setMarkWeekUiIndex) {
                            var _newIdx = storageService.loadUIConversation().length;
                            storageService.setMarkWeekUiIndex(_newIdx);
                            console.log('[Pipeline] markWeekUiIndex 已更新: ' + _oldIdx + ' → ' + _newIdx);
                        }
                    }
                } else {
                    // 预先生成本轮 assistant 消息 id，传给 summaryHistory 以便向量化时关联元数据
                    var _assistantMsgId = 'a' + Date.now();
                    summaryHistoryService.append(parsed.summaries, _summarySource, _assistantMsgId);
                    summaryHistoryService.trimWindow();
                }

                // 6. 保存 AI 回复到 UI 历史（摘要存在才写入，避免截断内容污染 LatestReply）
                storageService.appendUIConversation({
                    id: typeof _assistantMsgId !== 'undefined' ? _assistantMsgId : ('a' + Date.now()),
                    role: 'assistant',
                    content: parsed.mainText,
                    week: currentWeek,
                    createdAt: Date.now()
                });

                // 摘要 + 正文均已写入，本轮提交完成

                // ⑰ newWeek=1 时，异步触发周总结优化（在本轮 commit 完成后）
                if (newWeek === 1 && typeof summaryRunner !== 'undefined') {
                    setTimeout(function() { summaryRunner.scheduleSummary(); }, 0);
                }
            }

            // 8. 持久化
            storageService.saveAppState({ gameData: gameData });

            // 10. 处理随机/战斗事件
            _handleEvents(parsed);

            console.log('[Pipeline] 提交完成');

            // Phase 3：fire-and-forget 异步存储新增 summary 的 embedding
            if (typeof memoryRecall !== 'undefined' && typeof embeddingService !== 'undefined' && embeddingService.isEnabled()) {
                (async function() {
                    try {
                        var allAfter = summaryHistoryService.getAll();
                        // 找出还没有 embedding 的条目
                        // 注：memoryRecall.getStats() 只返回 {total,initialized,...}，不含 entries 列表，
                        // 不能用它判断"哪些id已缓存"（曾误用导致 cachedIds 恒为空，把整个 summaryHistory
                        // 当作"新增"重新 embed，历史一多就会撑爆 embedding API 的单请求 token 上限）。
                        // 改用与 _syncEmbeddingsWithSummaryHistory 相同的可靠数据源：已持久化的 emb_ 记录。
                        var embRecords = storageService.loadAllEmbeddings();
                        var cachedIds = {};
                        for (var ci = 0; ci < embRecords.length; ci++) {
                            cachedIds[embRecords[ci].id] = true;
                        }
                        var newSummaries = allAfter.filter(function(s) { return !cachedIds[s.id]; });
                        if (newSummaries.length === 0) return;

                        // 加载 uiConversation 用于元数据提取
                        var _uiHist = storageService.loadUIConversation();

                        // 构建每条摘要的向量化文本（地点/NPC前缀 + summaryText）
                        var embedTexts = newSummaries.map(function(s) {
                            return _buildEmbedText(s, _uiHist);
                        });

                        var vectors = await embeddingService.embed(embedTexts);
                        if (!vectors) {
                            throw new Error('embed 返回空（可能是请求体过大或API错误，详见上方 [EmbeddingService] 日志）');
                        }

                        var fp = embeddingService.getFingerprint();
                        var _lastNewEmb = null;
                        for (var vi = 0; vi < newSummaries.length; vi++) {
                            if (!vectors[vi]) continue;
                            var combined = new Float32Array(vectors[vi]);

                            var meta = {
                                text: newSummaries[vi].summaryText,
                                week: newSummaries[vi].week || 0,
                                fingerprint: fp,
                                createdAt: Date.now()
                            };
                            storageService.saveEmbedding(newSummaries[vi].id, combined, meta);
                            memoryRecall.addToCache({ id: newSummaries[vi].id, vector: combined, text: meta.text, week: meta.week, fingerprint: fp, createdAt: meta.createdAt });
                            _lastNewEmb = { id: newSummaries[vi].id, summaryText: newSummaries[vi].summaryText, embedText: embedTexts[vi] };
                        }
                        console.log('[Pipeline] 已保存 ' + newSummaries.length + ' 条新 embedding');
                        if (_lastNewEmb) {
                            console.groupCollapsed('[Pipeline] 最新 embedding 详情（展开查看）');
                            console.log('id: ' + _lastNewEmb.id);
                            console.log('摘要文本: ' + _lastNewEmb.summaryText);
                            console.log('向量化文本: ' + (_lastNewEmb.embedText.length > 500 ? _lastNewEmb.embedText.slice(0, 500) + '...' : _lastNewEmb.embedText));
                            console.groupEnd();
                        }
                    } catch (embErr) {
                        console.warn('[Pipeline] embedding 存储失败:', embErr && embErr.message || embErr);
                        if (typeof embeddingService !== 'undefined' && embeddingService.canNotifyStoreFail()) {
                            alert('【记忆向量化】本轮摘要 embedding 存储失败，请检查 embedding 配置。\n错误：' + (embErr && embErr.message || embErr));
                        }
                    }
                })();
            }

            // Phase L2：fire-and-forget 触发 runEventSum（滑动窗口事件抽取，与 L0 embedding 并列）
            // 本轮 assistant 楼层已写入 uiConversation，触发判定按总条目差驱动（含 user）
            // 注：embedding 未开启时仍执行事件抽取入库，仅跳过 wevt_ 向量化
            if (typeof eventRunner !== 'undefined') {
                setTimeout(function() { eventRunner.maybeSchedule(); }, 0);
            }
            // 触发自动存档（仅独立前端，函数由 index.html 定义）
            // 仅在 SIDE_NOTE 成功解析时才存档，截断响应跳过
            if (typeof autoSave === 'function' && parsed.sideNote !== null) {
                autoSave();
            } else if (typeof autoSave === 'function') {
                console.log('[Pipeline] 跳过自动存档：SIDE_NOTE 解析失败，响应可能被截断');
                if (typeof showModal === 'function') {
                    showModal('本次回复内容格式不完整，自动存档已跳过，建议重新生成。');
                }
            }
            // 每轮完成后刷新按钮状态（重生成按钮依赖 hasSnapshot，初始化时快照为空会被禁用）
            if (typeof updateFreeActionInputState === 'function') {
                updateFreeActionInputState();
            }
        } catch (err) {
            console.error('[Pipeline] 提交阶段错误:', err.message);
            // 取消正在飞行的周总结请求（防止旧结果覆盖还原后的状态）
            var _pipelineSummaryRunning = typeof summaryRunner !== 'undefined' && summaryRunner.isRunning();
            console.log('[Pipeline] catch 触发还原 | summaryRunner.isRunning=' + _pipelineSummaryRunning);
            if (_pipelineSummaryRunning) summaryRunner.cancel();
            // 地点信息迭代：同样取消正在飞行的地点更新请求（防止旧结果写回已回滚的 locationMemory）
            if (typeof locationRunner !== 'undefined') locationRunner.cancel();
            storageService.restoreFromSnapshot();
            if (typeof renderMainText === 'function') {
                renderMainText(_getLastAssistantContent(storageService.loadUIConversation()));
            }
            if (typeof showModal === 'function') {
                showModal('状态保存异常，已恢复到发送前状态。建议重新生成。');
            }
        }
    }

    // ========== 流式渲染（与 index-SR 对齐，走完整分页+图层刷新）==========

    // ========== 中断控制 ==========

    function abortCurrentTurn() {
        if (_currentAbort && typeof _currentAbort.abort === 'function') {
            console.log('[Pipeline] 用户中断生成');
            _abortRequested = true;
            _currentAbort.abort();
        }
    }

    function isStreaming() {
        return _isStreaming;
    }

    // ========== 流式控件 UI ==========

    function _showStreamControls() {
        var expandBtn = document.getElementById('story-expand-btn');
        if (expandBtn) expandBtn.style.display = 'none';
        var el = document.getElementById('stream-controls');
        if (el) el.style.display = 'flex';
        _setInteractionEnabled(false);
        _showStreamMask();
    }

    function _hideStreamControls() {
        var el = document.getElementById('stream-controls');
        if (el) el.style.display = 'none';
        var expandBtn = document.getElementById('story-expand-btn');
        if (expandBtn) expandBtn.style.display = '';
        // 用 updateFreeActionInputState 恢复按钮状态，以尊重 inputEnable 变量
        // （若 inputEnable===0，如特殊事件触发后，按钮应保持禁用）
        if (typeof updateFreeActionInputState === 'function') {
            updateFreeActionInputState();
        } else {
            _setInteractionEnabled(true);
        }
        _hideStreamMask();
    }

    function _showStreamMask() {
        var viewport = document.getElementById('main-viewport');
        if (!viewport) return;
        var mask = document.getElementById('stream-mask');
        if (!mask) {
            mask = document.createElement('div');
            mask.id = 'stream-mask';
            var spinner = document.createElement('div');
            spinner.className = 'stream-spinner';
            var gifImg = document.createElement('img');
            gifImg.className = 'stream-spinner-gif';
            gifImg.src = 'assets/image/static/等待.gif';
            gifImg.alt = '';
            spinner.appendChild(gifImg);
            mask.appendChild(spinner);
            var logEl = document.createElement('div');
            logEl.id = 'stream-log';
            mask.appendChild(logEl);
            viewport.appendChild(mask);
        }
        mask.classList.add('active');
        _setStreamLog('');
    }

    function _hideStreamMask() {
        var mask = document.getElementById('stream-mask');
        if (mask) mask.classList.remove('active');
        _setStreamLog('');
    }

    function _setStreamLog(text) {
        var el = document.getElementById('stream-log');
        if (!el) return;
        el.innerHTML = '';
        if (!text) return;
        for (var i = 0; i < text.length; i++) {
            var span = document.createElement('span');
            span.textContent = text[i];
            span.style.animationDelay = (i * 0.07) + 's';
            el.appendChild(span);
        }
    }

    // 补全进度用：直接 textContent，不做逐字动画，适合逐条高频刷新
    function _setProgressLog(text) {
        var el = document.getElementById('stream-log');
        if (!el) return;
        el.textContent = text || '';
    }

    function _setInteractionEnabled(enabled) {
        var ids = ['skip-week-btn', 'slg-return-btn', 'free-action-send-btn', 'regenerate-btn', 'free-action-input'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.disabled = !enabled;
            el.style.opacity = enabled ? '' : '0.5';
            el.style.cursor = enabled ? '' : 'not-allowed';
        });
    }

    function _preprocessMessage(message) {
        var processed = message;
        // 去除"属性变化"及其后面部分
        var idx = processed.indexOf('属性变化');
        if (idx !== -1) {
            processed = processed.substring(0, idx).replace(/(<br\s*\/?>\s*)+$/gi, '').trim();
        }
        // 去除"计算过程"及其后面部分
        idx = processed.indexOf('计算过程');
        if (idx !== -1) {
            processed = processed.substring(0, idx).replace(/(<br\s*\/?>\s*)+$/gi, '').trim();
        }
        return processed;
    }

    function _applyParsedSideNote(parsed) {
        if (!parsed.sideNote) return;
        try {
            if (typeof parseLLMResponse === 'function') {
                parseLLMResponse(parsed.sideNote, parsed.mainText);
            }
        } catch (e) {
            console.warn('应用 SIDE_NOTE 失败', e);
        }
    }

    function _applySummaryUpdate(parsed) {
        if (!parsed.summaries || parsed.summaries.length === 0) return;

        var summaryContent = parsed.summaries.join('\n');
        var year = Math.floor((currentWeek - 1) / 48) + 1;
        var remainingWeeks = (currentWeek - 1) % 48;
        var month = Math.floor(remainingWeeks / 4) + 1;
        var week = remainingWeeks % 4 + 1;
        var timestamp = '[第' + year + '年第' + month + '月第' + week + '周]';

        var alreadyExists = (summary_Small && summary_Small.indexOf(summaryContent) !== -1) ||
                           (summary_Week && summary_Week.indexOf(summaryContent) !== -1) ||
                           (summary_Backup && summary_Backup.indexOf(summaryContent) !== -1);

        if (!alreadyExists) {
            if (newWeek === 1) {
                summary_Week = summary_Week ? summary_Week + '\n\n' + summaryContent : summaryContent;
                markWeek = currentWeek;
                if (summary_Small) {
                    summary_Backup = summary_Backup ? summary_Backup + '\n\n' + summary_Small : summary_Small;
                }
                summary_Small = '';
            } else {
                summary_Small = summary_Small ? summary_Small + '\n\n' + timestamp + '\n' + summaryContent : timestamp + '\n' + summaryContent;
            }
        }
    }

    function _handleEvents(parsed) {
        if (!parsed.sideNote) return;
        var sideNote = parsed.sideNote;
        if (sideNote['随机事件']) {
            var event = sideNote['随机事件'];
            if (event['事件类型'] === '选项事件') {
                currentRandomEvent = event;
                // 不设 randomEvent=1：prompt 标记位已在步骤 4 归零，
                // UI 展示只依赖 currentRandomEvent，不依赖 randomEvent
                if (typeof displayRandomEvent === 'function') {
                    displayRandomEvent(event);
                }
            } else if (event['事件类型'] === '战斗事件') {
                currentBattleEvent = event;
                // 同理不设 battleEvent=1
                if (typeof displayBattleEvent === 'function') {
                    displayBattleEvent(event);
                }
            }
        }
    }

    function _getLastAssistantContent(history) {
        if (!history || history.length === 0) return '';
        for (var i = history.length - 1; i >= 0; i--) {
            if (history[i] && history[i].role === 'assistant') {
                return history[i].content || '';
            }
        }
        return '';
    }

    /**
     * 处理特殊事件（独立前端专用）
     * @param {object} event - 特殊事件对象（包含 text、name、id 等）
     * @param {string} userMessage - 用户消息（用于UI历史记录）
     */
    async function handleSpecialEvent(event, userMessage) {
        if (!event || !event.text) {
            console.error('[Pipeline] 特殊事件对象无效');
            return;
        }
        
        console.log('[Pipeline] 处理特殊事件:', event.name);
        
        try {
            _showStreamControls();
            _setStreamLog('施延年灵光乍现');
            
            // 模拟思考延迟
            await new Promise(function(resolve) { setTimeout(resolve, 600); });
            _setStreamLog('施延年题尾落款');
            
            // 替换 {{user}} 为主角名字
            var playerName = (typeof gameData !== 'undefined' && gameData.playerName) ? gameData.playerName : '主角';
            var eventText = event.text.replace(/\{\{user\}\}/g, playerName);
            var resolvedUserMessage = userMessage.replace(/\{\{user\}\}/g, playerName);

            // 给特殊剧情的 user 消息统一加上结构化前缀（时间/季节/地点/在场NPC）
            // 只在消息不已含「时间：」时追加，避免重复
            if (resolvedUserMessage.indexOf('时间：') === -1) {
                var _year = 1, _month = 1, _week = 1;
                if (typeof currentWeek !== 'undefined') {
                    _year  = Math.floor((currentWeek - 1) / 48) + 1;
                    var _rem = (currentWeek - 1) % 48;
                    _month = Math.floor(_rem / 4) + 1;
                    _week  = _rem % 4 + 1;
                }
                var _seasonCN = (typeof seasonNameMap !== 'undefined' && typeof seasonStatus !== 'undefined')
                    ? (seasonNameMap[seasonStatus] || '冬天') : '冬天';
                var _loc = (typeof mapLocation !== 'undefined' && mapLocation) ? mapLocation : '天山派';
                // 随行 NPC（companionNPC 数组）
                var _npcNames = '';
                if (typeof companionNPC !== 'undefined' && Array.isArray(companionNPC) && companionNPC.length > 0) {
                    var _npcArr = companionNPC.map(function(id) {
                        return (typeof npcs !== 'undefined' && npcs[id]) ? npcs[id].name : id;
                    });
                    _npcNames = _npcArr.join('、');
                }
                var _prefix = '时间：第' + _year + '年第' + _month + '月第' + _week + '周<br>' +
                    '季节：' + _seasonCN + '<br>' +
                    '地点：' + _loc + '<br>' +
                    (_npcNames ? '随行NPC：' + _npcNames + '<br>' : '');
                resolvedUserMessage = _prefix + resolvedUserMessage;
            }
            
            // 走完整的提交流程（解析SUMMARY、SIDE_NOTE、渲染、保存）
            // 标记本次摘要来源为特殊剧情事件
            _currentSummarySource = 'special_event';
            await _commitResponse(resolvedUserMessage, eventText);
            _currentSummarySource = null;

            // 确保 inputEnable 状态同步到 UI
            if (typeof updateFreeActionInputState === 'function') {
                updateFreeActionInputState();
            }
            
            _hideStreamControls();
            
            console.log('[Pipeline] 特殊事件处理完成');
        } catch (error) {
            _hideStreamControls();
            console.error('[Pipeline] 特殊事件处理失败:', error);
            if (typeof showModal === 'function') {
                showModal('特殊事件处理失败：' + error.message);
            }
        }
    }

    return { 
        runTurn: runTurn, 
        abortCurrentTurn: abortCurrentTurn, 
        isStreaming: isStreaming,
        handleSpecialEvent: handleSpecialEvent
    };
})();
