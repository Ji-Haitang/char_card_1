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
        return prefix ? (prefix + summaryText) : summaryText;
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
                }
            } catch (e) {
                console.warn('[EmbSync] 补生成 emb_' + s.id + ' 失败:', e && e.message || e);
            }
        }
        console.log('[EmbSync] 补生成完毕，共处理 ' + missing.length + ' 条');
    }

    /**
     * 执行单轮消息处理（自动选择流式/非流式）
     * @param {string} message - 用户消息
     * @param {object} options - 可选配置 { isRegenerate: false }
     */
    async function runTurn(message, options) {
        options = options || {};
        var isRegenerate = options.isRegenerate || false;

        // === 请求阶段（无副作用，失败可安全重试）===
        var preprocessed = _preprocessMessage(message);

        var lastAssistantReply = _getLastAssistantContent(storageService.loadUIConversation());

        // Phase 3：发起请求前，同步 emb_ 与 summaryHistory 一致性
        try {
            await _syncEmbeddingsWithSummaryHistory();
        } catch (syncErr) {
            console.warn('[EmbSync] 同步异常，跳过:', syncErr && syncErr.message || syncErr);
        }

        // Phase 3：向量召回（在 buildMessages 前，不阻塞流程）
        var recalledMemories = [];
        if (typeof memoryRecall !== 'undefined' && typeof embeddingService !== 'undefined' && embeddingService.isEnabled()) {
            try {
                var allSummaries = summaryHistoryService.getAll();

                // ① 排除 RecentMemories 候选池：与 _selectRecentSummaries 保持相同阈值
                var _wh = (typeof weekHistoryService !== 'undefined') ? weekHistoryService.getAll() : [];
                var _lastWHEntry = _wh.length > 0 ? _wh[_wh.length - 1] : null;
                var _recentThreshold = _lastWHEntry ? ((_lastWHEntry.markWeek || _lastWHEntry.week || 1) - 1) : 1;
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

                recalledMemories = await memoryRecall.recallRelevantMemories(_intentVec, 15, excludeIds, 3000, _focusCharacters, _contextVec);
            } catch (recallErr) {
                console.warn('[Pipeline] 向量召回失败，降级为空:', recallErr && recallErr.message || recallErr);
                recalledMemories = [];
            }
        }

        var messages = promptBuilder.buildMessages({
            userMessage: preprocessed,
            gameData: gameData,
            summaryHistory: summaryHistoryService.getAll(),
            weekHistory: (typeof weekHistoryService !== 'undefined') ? weekHistoryService.getAll() : [],
            lastAssistantReply: lastAssistantReply,
            recalledMemories: recalledMemories
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
                            return '[第' + (i + 1) + '轮]' + _weekLine + '\n' + m.content;
                        }).join('\n\n');

                        // ⑪ 持久化 summaryBuff
                        if (storageService.setSummaryBuff) {
                            storageService.setSummaryBuff({
                                targetMarkWeek: _targetMarkWeek,
                                prevMarkWeekUiIndex: _oldIdx,
                                turnCount: _turnCount,
                                text: _buffText
                            });
                            console.log('[Pipeline] summaryBuff 已收集: targetMarkWeek=' + _targetMarkWeek + ', turnCount=' + _turnCount + ', chars=' + _buffText.length + ', oldIdx=' + _oldIdx);
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
                        var stats = memoryRecall.getStats();
                        var cachedIds = {};
                        var cached = stats && stats.entries ? stats.entries : [];
                        for (var ci = 0; ci < cached.length; ci++) {
                            cachedIds[cached[ci].id] = true;
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
