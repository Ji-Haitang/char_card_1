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

        var messages = promptBuilder.buildMessages({
            userMessage: preprocessed,
            gameData: gameData,
            summaryHistory: summaryHistoryService.getAll(),
            lastAssistantReply: lastAssistantReply
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
            _setStreamLog('发送 API 请求（流式）');
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
            storageService.setLastTurnCommitted(false);
            _setStreamLog('API 请求失败');
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
            storageService.setLastTurnCommitted(false);
            return;
        }

        // === 提交阶段（有副作用，按顺序可控）===
        _commitResponse(preprocessed, rawText);
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
                    if (accumulatedText === '') _setStreamLog('模型输出中');
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
                    if (accumulatedThinking === '') _setStreamLog('模型思考中');
                    accumulatedThinking += delta;
                },
                onComplete: function(fullText, usage) {
                    _setStreamLog('输出完成');
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
                    _setStreamLog('转为非流式降级请求');
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
        _setStreamLog('转为非流式降级请求');
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
    function _commitResponse(preprocessed, rawText) {
        var uiConversationBeforeCommit = storageService.loadUIConversation().slice();
        var summaryHistoryBeforeCommit = summaryHistoryService.getAll().slice();
        try {
            // 1. 写入用户消息到 UI 历史
            storageService.appendUIConversation({
                id: 'u' + Date.now(),
                role: 'user',
                content: preprocessed,
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

            // 6. 保存 AI 回复到 UI 历史
            storageService.appendUIConversation({
                id: 'a' + Date.now(),
                role: 'assistant',
                content: parsed.mainText,
                createdAt: Date.now()
            });

            // 7. 保存摘要历史
            if (parsed.summaries && parsed.summaries.length > 0) {
                summaryHistoryService.append(parsed.summaries);
                summaryHistoryService.trimWindow();
            }

            // 8. 持久化
            storageService.saveAppState({ gameData: gameData });

            // 10. 处理随机/战斗事件
            _handleEvents(parsed);

            storageService.setLastTurnCommitted(true);
            console.log('[Pipeline] 提交完成');
        } catch (err) {
            storageService.setLastTurnCommitted(false);
            console.error('[Pipeline] 提交阶段错误:', err.message);
            var snapshot = storageService.loadSnapshot();
            if (snapshot) {
                gameData = (typeof mergeWithDefaults === 'function') ? mergeWithDefaults(snapshot, defaultGameData) : snapshot;
                if (typeof syncVariablesFromGameData === 'function') syncVariablesFromGameData();
                storageService.saveAppState({ gameData: gameData });
            }
            storageService.replaceUIConversation(uiConversationBeforeCommit);
            summaryHistoryService.importAll(summaryHistoryBeforeCommit);
            if (typeof renderMainText === 'function') {
                renderMainText(_getLastAssistantContent(uiConversationBeforeCommit));
            }
            if (typeof showModal === 'function') {
                showModal('状态保存异常，已恢复到发送前状态。建议手动存档。');
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
        _setInteractionEnabled(true);
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

    return { runTurn: runTurn, abortCurrentTurn: abortCurrentTurn, isStreaming: isStreaming };
})();
