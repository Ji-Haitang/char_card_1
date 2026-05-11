/**
 * prompt-builder.js - Prompt 编排（6 条消息结构）
 * Phase 2.3：重构为与"整理后的log"一致的消息格式
 *   msg1: system (开场+settings+Details+background前半)
 *   msg2: user   ([Start a new chat])
 *   msg3: assistant (LatestReply 包裹块)
 *   msg4: user   (用户输入 + MainTextGuidance + 105 + 110 + Order + ThinkGuidance)
 *   msg5: assistant (jailbreak prefill)
 *   msg6: user   (final instruction)
 * 依赖：template-engine.js, prompt-data-core.js, prompt-data-extra.js,
 *        prompt-data-npc.js, prompt-data-actions.js, worldbook-engine.js,
 *        token-utils.js, api-service.js
 */

var promptBuilder = (function() {

    /**
     * 获取 token 预算配置
     */
    function _getBudgetConfig() {
        var cfg = (typeof apiService !== 'undefined') ? apiService.getConfig() : {};
        return {
            maxContext: cfg.maxContextTokens || 128000,
            reservedOutput: cfg.maxOutputTokens || 8192
        };
    }

    /**
     * 在 token 预算内从最新向最旧选取 summary 条目
     */
    function _selectSummariesWithinBudget(summaryHistory, budgetTokens) {
        if (!summaryHistory || summaryHistory.length === 0) return [];
        var selected = [];
        var used = 0;
        for (var i = summaryHistory.length - 1; i >= 0; i--) {
            var text = summaryHistory[i].summaryText || '';
            var tokens = tokenUtils.estimate(text);
            if (used + tokens > budgetTokens) break;
            selected.unshift(summaryHistory[i]);
            used += tokens;
        }
        return selected;
    }

    /**
     * 构建 HistorySummary 块
     */
    /**
     * 将 summaryHistory 条目的 week 字段转换为 [第X年第X月第X周] 格式
     */
    function _weekToTimestamp(week) {
        var year = Math.floor((week - 1) / 48) + 1;
        var remainingWeeks = (week - 1) % 48;
        var month = Math.floor(remainingWeeks / 4) + 1;
        var w = remainingWeeks % 4 + 1;
        return '[第' + year + '年第' + month + '月第' + w + '周]';
    }

    /**
     * 构建 HistorySummary 块
     * @param {Array} selectedSummaries - 经 token 预算裁剪后的 summaryHistory 条目
     */
    function _buildHistorySummaryBlock(selectedSummaries) {
        var lines = ['<!-- <HistorySummary> is a brief summary of what has happened so far. Please read it to continue the story. -->'];
        lines.push('');
        lines.push('<HistorySummary>');
        if (selectedSummaries && selectedSummaries.length > 0) {
            for (var i = 0; i < selectedSummaries.length; i++) {
                var entry = selectedSummaries[i];
                var timestamp = _weekToTimestamp(entry.week || 1);
                lines.push('');
                lines.push(timestamp);
                if (entry.gameTime) {
                    lines.push('[当天时间 ' + entry.gameTime + ']');
                }
                lines.push(entry.summaryText);
            }
        }
        lines.push('');
        lines.push('</HistorySummary>');
        return lines.join('\n');
    }

    /**
     * 构建消息1: SYSTEM
     * 结构: opening + <settings>(info + character=010) + [Details...](020 + MainNPCs + 040)
     *       + <background>(<fresh> + <writing_style> + <history>(HistorySummary + [Start a new Chat]))
     */
    function _buildMsg1System(variables, npcBlocks, historySummaryBlock) {
        var playerName = variables.user || '主角';
        var parts = [];

        // Opening
        parts.push(PROMPT_OPENING);
        parts.push('');

        // <settings>
        parts.push('<settings>');
        parts.push('# "' + playerName + '"是role_user的角色与身份，user的言语与动作皆为' + playerName + '所为:');
        parts.push('');
        parts.push('## `<info>`是需参照的信息以及资料。');
        parts.push('<info>');
        parts.push('');
        parts.push(PROMPT_INFO_TONE);
        parts.push('');
        parts.push('</info>');
        parts.push('');
        parts.push('# 不论剧情如何发展，均以<character></character>中规定的角色形象为准。');
        parts.push('');
        parts.push('<character>');
        parts.push('');
        // 010 天山派背景
        parts.push(templateEngine.renderPromptTemplate(PROMPT_CORE_010, variables));
        parts.push('');
        parts.push('</character>');
        parts.push('</settings>');
        parts.push('');

        // [Details of the fictional world...]
        parts.push('[Details of the fictional world the RP is set in:');
        parts.push('');
        // 020 地点介绍
        parts.push(templateEngine.renderPromptTemplate(PROMPT_CORE_020, variables));
        parts.push('');

        // <MainNPCs>
        parts.push('<!-- <MainNPCs> is the information of characters in this story. -->');
        parts.push('');
        parts.push('<MainNPCs>');
        if (npcBlocks && npcBlocks.length > 0) {
            for (var i = 0; i < npcBlocks.length; i++) {
                parts.push('');
                parts.push(templateEngine.renderPromptTemplate(npcBlocks[i].content, variables));
            }
        }
        parts.push('');
        parts.push('</MainNPCs>');
        parts.push('');

        // 040 主角属性
        parts.push(templateEngine.renderPromptTemplate(PROMPT_CORE_040, variables));
        parts.push('');
        parts.push(']');
        parts.push('');

        // <background>
        parts.push('<background>');
        parts.push('');
        parts.push('');
        // <writing_style>
        parts.push(PROMPT_WRITING_STYLE);
        parts.push('');

        // <history>
        parts.push('<history>');
        parts.push('');
        parts.push('[Start a new Chat]');
        parts.push('');

        // HistorySummary
        parts.push(historySummaryBlock);

        return parts.join('\n');
    }

    /**
     * 构建消息3: ASSISTANT (LatestReply 包裹块)
     */
    function _buildMsg3LatestReply(lastAssistantReply) {
        var parts = [];
        parts.push('<!-- <LatestReply> is the most recent complete output of this story. Please read it to determine the latest plot and refer to its literary style. -->');
        parts.push('');
        parts.push('<LatestReply>');
        parts.push('');
        parts.push('说明: 下面的xml符号 <SLG_MODE> 和 </SLG_MODE>，以及内部的部分，是最新一次输出的故事内容。');
        parts.push('要求: ');
        parts.push('  - 阅读并确定最新剧情');
        parts.push('  - 参考文学风格');
        parts.push(lastAssistantReply || '');
        parts.push('');
        parts.push('</LatestReply>');
        parts.push('</history>');
        return parts.join('\n');
    }

    /**
     * 构建消息4: USER
     * 结构: 用户输入 + <MainTextGuidance> + 105列表 + 110格式规范
     *       + </history></background> + <Order> + <ThinkGuidance> + </Order>
     */
    function _buildMsg4User(variables, userMessage, actionGuide, isDeepSeek) {
        var parts = [];

        // <fresh>
        parts.push(PROMPT_FRESH);
        parts.push('');

        // 用户输入
        parts.push('# `<user_input>`作为本次交互的用户输入，以`<user_input>`为大纲指导，丰富细节，进行扩写后输出，不得省略或跳过用户输入中的情节，并合理流畅地继续向下推进');
        parts.push('');
        parts.push('<user_input>');
        parts.push(userMessage);
        parts.push('</user_input>');
        parts.push('');

        // <MainTextGuidance>
        if (actionGuide) {
            parts.push('<!-- <MainTextGuidance> is the guide for the Main Text output of the LLM model -->');
            parts.push('<MainTextGuidance>');
            parts.push(templateEngine.renderPromptTemplate(actionGuide, variables));
            parts.push('</MainTextGuidance>');
            parts.push('');
        }

        // 105 列表
        parts.push(templateEngine.renderPromptTemplate(PROMPT_CORE_105, variables));
        parts.push('');

        // 110 格式规范
        parts.push(templateEngine.renderPromptTemplate(PROMPT_CORE_110, variables));
        parts.push('');

        // 闭合 background
        parts.push('</background>');
        parts.push('');

        // <Order> (含 EJS enamor 条件)
        parts.push(templateEngine.renderPromptTemplate(PROMPT_ORDER, variables));
        parts.push('');

        // <ThinkGuidance> (根据模型选择版本，需经过模板引擎替换 {{user}} 等变量)
        var thinkGuidance = isDeepSeek ? PROMPT_THINK_GUIDANCE_DEEPSEEK : PROMPT_THINK_GUIDANCE;
        parts.push(templateEngine.renderPromptTemplate(thinkGuidance, variables));
        parts.push('\n</Order>');

        return parts.join('\n');
    }

    /**
     * 构建 messages 数组（6 条消息结构），带 token 预算管理
     * @param {object} params - { userMessage, gameData, summaryHistory, lastAssistantReply }
     * @returns {Array} messages 数组
     */
    function buildMessages(params) {
        var userMessage = params.userMessage;
        var gd = params.gameData || {};
        var summaryHistory = params.summaryHistory || [];
        var lastAssistantReply = params.lastAssistantReply || '';

        var playerName = gd.playerName || '主角';
        var variables = { user: playerName, gameData: gd, '本次user输入': userMessage };

        // --- 世界书触发 ---
        var npcBlocks = worldbookEngine.matchNPCs(userMessage, lastAssistantReply);
        var actionGuide = worldbookEngine.matchActionGuide(userMessage);

        // --- 模型检测 ---
        var modelName = (apiService.getConfig().model || '').toLowerCase();
        var isDeepSeek = modelName.indexOf('deepseek') !== -1;

        // --- 构建各条消息（先不含 HistorySummary，后续注入）---
        var historySummaryPlaceholder = _buildHistorySummaryBlock([]);
        var msg1Content = _buildMsg1System(variables, npcBlocks, historySummaryPlaceholder);
        var msg2Content = '[Start a new chat]';
        var msg3Content = _buildMsg3LatestReply(lastAssistantReply);
        var msg4Content = _buildMsg4User(variables, userMessage, actionGuide, isDeepSeek);
        var msg5Content = templateEngine.renderPromptTemplate(
            isDeepSeek ? PROMPT_JAILBREAK_PREFILL_DEEPSEEK : PROMPT_JAILBREAK_PREFILL, variables);
        var msg6Content = isDeepSeek
            ? PROMPT_FINAL_INSTRUCTION
            : PROMPT_FINAL_INSTRUCTION.replace(/\}$/, '\nthinking omitted}');

        // --- Token 预算管理 ---
        var budget = _getBudgetConfig();
        var totalAvailable = budget.maxContext - budget.reservedOutput;

        var fixedTokens = tokenUtils.estimate(msg1Content)
                        + tokenUtils.estimate(msg2Content)
                        + tokenUtils.estimate(msg3Content)
                        + tokenUtils.estimate(msg4Content)
                        + tokenUtils.estimate(msg5Content)
                        + tokenUtils.estimate(msg6Content)
                        + 24; // 6 messages × ~4 tokens structure overhead

        var summaryBudget = Math.max(0, totalAvailable - fixedTokens);

        // 在预算内从最新到最旧选取 summaryHistory 条目
        var selectedSummaries = _selectSummariesWithinBudget(summaryHistory, summaryBudget);

        // 用选中的条目构建 HistorySummary 块，替换 msg1 中的占位
        var finalHistorySummary = _buildHistorySummaryBlock(selectedSummaries);
        msg1Content = msg1Content.replace(historySummaryPlaceholder, finalHistorySummary);

        // --- 组装 messages ---
        var messages = [
            { role: 'system', content: msg1Content },
            { role: 'user', content: msg2Content },
            { role: 'assistant', content: msg3Content },
            { role: 'user', content: msg4Content },
            { role: 'assistant', content: msg5Content },
            { role: 'user', content: msg6Content }
        ];

        // --- 调试日志 ---
        var actualTokens = tokenUtils.estimateMessages(messages);
        console.log('[PromptBuilder] 6-msg 结构 | NPC注入: ' + npcBlocks.length +
                    ' | 行动指导: ' + (actionGuide ? '是' : '否') +
                    ' | Token估算: ' + actualTokens + '/' + totalAvailable);

        return messages;
    }

    return { buildMessages: buildMessages };
})();
