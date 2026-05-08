/**
 * pipeline.js - 单轮消息处理流水线（两阶段设计）
 * Phase 1 核心：请求阶段无副作用 + 提交阶段可回滚
 * 
 * 依赖：api-service, prompt-builder, response-parser, 
 *        variable-system, summary-history-service, storage-service
 */

var pipeline = (function() {
    /**
     * 执行单轮消息处理
     * @param {string} message - 用户消息
     * @param {object} options - 可选配置 { isRegenerate: false }
     */
    async function runTurn(message, options) {
        options = options || {};
        var isRegenerate = options.isRegenerate || false;

        // === 请求阶段（无副作用，失败可安全重试）===
        var preprocessed = _preprocessMessage(message);

        // 获取上一次 AI 回复（用于 LatestReply 块和 NPC 匹配）
        var lastAssistantReply = _getLastAssistantContent(storageService.loadUIConversation());

        var messages = promptBuilder.buildMessages({
            userMessage: preprocessed,
            gameData: gameData,
            summaryHistory: summaryHistoryService.getAll(),
            lastAssistantReply: lastAssistantReply
        });

        var rawText;
        try {
            console.log('[Pipeline] 发送 API 请求...');
            var result = await apiService.sendMessages(messages);
            rawText = result.content;
            console.log('[Pipeline] API 请求成功');
        } catch (err) {
            storageService.setLastTurnCommitted(false);
            console.error('[Pipeline] API 请求失败:', err.message);
            var errorMsg = 'AI 请求失败：' + err.message + '\n\n可点击重试';
            if (typeof showModal === 'function') {
                showModal(errorMsg);
            }
            throw err;
        }

        // === 提交阶段（有副作用，按顺序可控）===
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

            // 4. 将全局变量同步到 gameData 并持久化（第二阶段：AI回复后更新）
            syncGameDataFromVariables();

            // 4.5 每轮必须的环境刷新（ST 模式下由重渲染自动完成，独立模式需手动补）
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
            // NPC位置由 SIDE_NOTE 决定，不在此随机刷新
            // refreshNpcLocations 仅在行动选择/新一周/返回天山派时（发送前）调用
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

            // 5. 更新 UI
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

            // 8. 持久化（摘要已在步骤 3 更新）
            storageService.saveAppState({ gameData: gameData });

            // 10. 处理随机/战斗事件
            _handleEvents(parsed);

            storageService.setLastTurnCommitted(true);

            console.log('[Pipeline] 提交完成');
        } catch (err) {
            storageService.setLastTurnCommitted(false);
            console.error('[Pipeline] 提交阶段错误:', err.message);
            // 提交阶段失败：从快照恢复到发送时状态
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
                randomEvent = 1;
                if (typeof displayRandomEvent === 'function') {
                    displayRandomEvent(event);
                }
            } else if (event['事件类型'] === '战斗事件') {
                currentBattleEvent = event;
                battleEvent = 1;
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

    return { runTurn: runTurn };
})();
