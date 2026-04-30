/**
 * prompt-builder.js - Prompt 编排
 * Phase 1：system prompt（5个核心文件）+ RecentHistory（仅 SUMMARY）+ 用户输入
 * 依赖：template-engine.js, prompt-data-core.js
 */

var promptBuilder = (function() {
    var systemPromptCache = null;

    function init() {
        if (!systemPromptCache) {
            var parts = [
                PROMPT_CORE_010,
                PROMPT_CORE_020,
                PROMPT_CORE_040,
                PROMPT_CORE_105,
                PROMPT_CORE_110
            ];
            systemPromptCache = parts.join('\n\n');
        }
    }

    function _buildSystemPrompt(variables) {
        return templateEngine.renderPromptTemplate(systemPromptCache, variables);
    }

    function _buildStateContext(gameData) {
        return '当前周数: ' + (gameData.currentWeek || 1) + '\n' +
               '当前位置: ' + (gameData.mapLocation || '天山派') + '\n' +
               '当前模式: ' + (gameData.GameMode === 1 ? 'SLG模式' : '普通模式');
    }

    function _buildRecentHistoryBlock(summaryHistory) {
        if (!summaryHistory || summaryHistory.length === 0) return '';
        var lines = ['<RecentHistory>'];
        for (var i = 0; i < summaryHistory.length; i++) {
            lines.push(summaryHistory[i].summaryText);
        }
        lines.push('</RecentHistory>');
        return lines.join('\n');
    }

    function buildMessages(params) {
        init();

        var userMessage = params.userMessage;
        var gameData = params.gameData || {};
        var summaryHistory = params.summaryHistory || [];

        var variables = { user: gameData.playerName || '主角', gameData: gameData };

        var messages = [];
        messages.push({ role: 'system', content: _buildSystemPrompt(variables) });

        var historyBlock = _buildRecentHistoryBlock(summaryHistory);
        if (historyBlock) messages.push({ role: 'system', content: historyBlock });

        messages.push({ role: 'system', content: _buildStateContext(gameData) });
        messages.push({ role: 'user', content: userMessage });

        return messages;
    }

    return { init: init, buildMessages: buildMessages };
})();
