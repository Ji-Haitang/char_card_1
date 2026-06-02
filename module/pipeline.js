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
        for (var i = 0; i < missing.length; i++) {
            var s = missing[i];
            if (!s.summaryText) continue;
            try {
                var vecs = await embeddingService.embed([s.summaryText]);
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

                // ② LWB 多段加权 query：focus(当前输入) + near(最近AI回复原文) + far(该回复前的用户消息)
                var _focusText = preprocessed;
                // near = uiConversation 最后一条 role=assistant（上一轮 AI 完整回复原文）
                var _nearText = lastAssistantReply || '';
                // far = near 之前最近一条 role=user（上一轮用户输入）
                var _farText = '';
                var _uiForFar = storageService.loadUIConversation();
                var _passedAssist = false;
                for (var _fuci = _uiForFar.length - 1; _fuci >= 0; _fuci--) {
                    if (!_passedAssist && _uiForFar[_fuci].role === 'assistant') { _passedAssist = true; }
                    else if (_passedAssist && _uiForFar[_fuci].role === 'user') { _farText = _uiForFar[_fuci].content || ''; break; }
                }

                // 仅 embed 非空段
                var _segTexts = [_focusText];
                var _segBases = [0.55];
                if (_nearText) { _segTexts.push(_nearText); _segBases.push(0.30); }
                if (_farText)  { _segTexts.push(_farText);  _segBases.push(0.15); }

                var _embedVecs = await embeddingService.embed(_segTexts);

                // 长度惩罚：< 50 字时按比例衰减至 35% 基础权重
                var _segWeights = _segTexts.map(function(t, idx) {
                    var len = (t || '').length;
                    var base = _segBases[idx];
                    return len >= 50 ? base : base * (0.35 + (len / 50) * 0.65);
                });

                // 归一化
                var _wTot = _segWeights.reduce(function(a, b) { return a + b; }, 0);
                _segWeights = _segWeights.map(function(w) { return w / _wTot; });

                // 焦点保底 35%
                if (_segWeights[0] < 0.35) {
                    var _shortage = 0.35 - _segWeights[0];
                    var _ctxTot = _segWeights.slice(1).reduce(function(a, b) { return a + b; }, 0);
                    if (_ctxTot > 0) {
                        for (var _si2 = 1; _si2 < _segWeights.length; _si2++) {
                            _segWeights[_si2] -= _shortage * (_segWeights[_si2] / _ctxTot);
                        }
                    }
                    _segWeights[0] = 0.35;
                }

                // 加权平均向量 + L2 归一化
                var _dim = _embedVecs[0].length;
                var _queryVec = new Float32Array(_dim);
                for (var _si = 0; _si < _segTexts.length; _si++) {
                    var _sv = _embedVecs[_si];
                    var _sw = _segWeights[_si];
                    for (var _di = 0; _di < _dim; _di++) {
                        _queryVec[_di] += _sw * _sv[_di];
                    }
                }
                var _qnorm = 0;
                for (var _di2 = 0; _di2 < _dim; _di2++) _qnorm += _queryVec[_di2] * _queryVec[_di2];
                _qnorm = Math.sqrt(_qnorm);
                if (_qnorm > 0) { for (var _di3 = 0; _di3 < _dim; _di3++) _queryVec[_di3] /= _qnorm; }

                // ③ focusCharacters：扫描 focus+near+far 合并文本，提取 npcNameToId 里的 NPC 名字
                var _combinedForNpc = _focusText + ' ' + _nearText + ' ' + _farText;
                var _focusCharacters = [];
                if (typeof npcNameToId !== 'undefined') {
                    var _npcNameKeys = Object.keys(npcNameToId);
                    for (var _nki = 0; _nki < _npcNameKeys.length; _nki++) {
                        if (_combinedForNpc.indexOf(_npcNameKeys[_nki]) !== -1) {
                            _focusCharacters.push(_npcNameKeys[_nki]);
                        }
                    }
                }

                // 保存分段信息供 memory-recall.js 的 log 读取
                window._lastQuerySegments = {
                    focus: { text: _focusText, weight: _segWeights[0] },
                    near:  { text: _nearText,  weight: _nearText ? _segWeights[1] : 0 },
                    far:   { text: _farText,   weight: _farText  ? _segWeights[_nearText ? 2 : 1] : 0 }
                };
                console.groupCollapsed('[Pipeline] Query向量构成（展开查看）');
                console.log('focus(' + (_segWeights[0] * 100).toFixed(0) + '%): ' + _focusText);
                if (_nearText) console.log('near(' + (_segWeights[1] * 100).toFixed(0) + '%): ' + (_nearText.length > 300 ? _nearText.slice(0, 300) + '...' : _nearText));
                if (_farText)  console.log('far('  + (_segWeights[_nearText ? 2 : 1] * 100).toFixed(0) + '%): ' + (_farText.length > 150 ? _farText.slice(0, 150) + '...' : _farText));
                console.log('排除RecentMemories: ' + excludeIds.length + '条 | focusNPC=[' + _focusCharacters.join(',') + ']');
                console.groupEnd();

                recalledMemories = await memoryRecall.recallRelevantMemories(_queryVec, 15, excludeIds, 3000, _focusCharacters);
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
                showModal('本轮输出已中断，未自动存档，建议手动存档。');
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
            if (isRegenerate) {
                // 重生成时替换最后一条 user 条目，避免重复累积导致 markWeekUiIndex 偏移
                var _uiHist = storageService.loadUIConversation();
                var _replaced = false;
                for (var _i = _uiHist.length - 1; _i >= 0; _i--) {
                    if (_uiHist[_i].role === 'user') {
                        _uiHist[_i].content = preprocessed;
                        _uiHist[_i].createdAt = Date.now();
                        _replaced = true;
                        break;
                    }
                }
                if (_replaced) {
                    storageService.replaceUIConversation(_uiHist);
                } else {
                    // 兜底：找不到上一条 user 则正常 append
                    storageService.appendUIConversation({ id: 'u' + Date.now(), role: 'user', content: preprocessed, week: currentWeek, createdAt: Date.now() });
                }
            } else {
                storageService.appendUIConversation({
                    id: 'u' + Date.now(),
                    role: 'user',
                    content: preprocessed,
                    week: currentWeek,
                    createdAt: Date.now()
                });
            }

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
                    summaryHistoryService.append(parsed.summaries, _summarySource);
                    summaryHistoryService.trimWindow();
                }

                // 6. 保存 AI 回复到 UI 历史（摘要存在才写入，避免截断内容污染 LatestReply）
                storageService.appendUIConversation({
                    id: 'a' + Date.now(),
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

                        // ── Batch 1：摘要向量（60%）──
                        var summaryTexts = newSummaries.map(function(s) { return s.summaryText; });
                        var summaryVectors = await embeddingService.embed(summaryTexts);

                        // ── Batch 2：对应 AI 回复原文向量（40%）──
                        // 取 uiConversation 中倒数 newSummaries.length 条 assistant 消息与之对齐
                        var _uiHist = storageService.loadUIConversation();
                        var _assistMsgs = _uiHist.filter(function(m) { return m.role === 'assistant'; });
                        var _aStart = Math.max(0, _assistMsgs.length - newSummaries.length);
                        var replyTexts = [];
                        for (var _ri = 0; _ri < newSummaries.length; _ri++) {
                            var _ai = _aStart + _ri;
                            replyTexts.push(_ai < _assistMsgs.length ? (_assistMsgs[_ai].content || '') : '');
                        }
                        var replyVectors = await embeddingService.embed(replyTexts.map(function(t) { return t || ' '; }));

                        var fp = embeddingService.getFingerprint();
                        var _lastNewEmb = null;
                        for (var vi = 0; vi < newSummaries.length; vi++) {
                            if (!summaryVectors[vi]) continue;
                            var _sv = summaryVectors[vi];
                            var _rv = (replyVectors && replyVectors[vi] && replyVectors[vi].length === _sv.length) ? replyVectors[vi] : null;

                            // 加权合并 60% 摘要 + 40% 原文，再 L2 归一化
                            var combined = new Float32Array(_sv.length);
                            if (_rv) {
                                for (var _di = 0; _di < _sv.length; _di++) {
                                    combined[_di] = 0.6 * _sv[_di] + 0.4 * _rv[_di];
                                }
                                var _norm = 0;
                                for (var _di2 = 0; _di2 < combined.length; _di2++) { _norm += combined[_di2] * combined[_di2]; }
                                _norm = Math.sqrt(_norm);
                                if (_norm > 0) { for (var _di3 = 0; _di3 < combined.length; _di3++) { combined[_di3] /= _norm; } }
                            } else {
                                // 回退：仅用摘要向量
                                combined = new Float32Array(_sv);
                            }

                            var meta = {
                                text: newSummaries[vi].summaryText,
                                week: newSummaries[vi].week || 0,
                                fingerprint: fp,
                                createdAt: Date.now()
                            };
                            storageService.saveEmbedding(newSummaries[vi].id, combined, meta);
                            memoryRecall.addToCache({ id: newSummaries[vi].id, vector: combined, text: meta.text, week: meta.week, fingerprint: fp, createdAt: meta.createdAt });
                            _lastNewEmb = { id: newSummaries[vi].id, summaryText: newSummaries[vi].summaryText, replyText: replyTexts[vi] || '' };
                        }
                        console.log('[Pipeline] 已保存 ' + newSummaries.length + ' 条新 embedding');
                        if (_lastNewEmb) {
                            console.groupCollapsed('[Pipeline] 最新 embedding 详情（展开查看）');
                            console.log('id: ' + _lastNewEmb.id);
                            console.log('摘要文本（60%）: ' + _lastNewEmb.summaryText);
                            console.log('AI回复原文（40%）: ' + (_lastNewEmb.replyText.length > 500 ? _lastNewEmb.replyText.slice(0, 500) + '...' : _lastNewEmb.replyText));
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
                    showModal('本次回复内容格式不完整，自动存档已跳过，建议重新生成或手动存档。');
                }
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
                showModal('状态保存异常，已恢复到发送前状态。建议重新生成或手动存档。');
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
