/**
 * worldbook-engine.js - 世界书触发引擎
 * Phase 2.3：关键词匹配 → 动态注入 NPC 人设 / 行动指导
 * 依赖：prompt-data-npc.js (NPC_REGISTRY, PROMPT_NPC_*),
 *        prompt-data-actions.js (ACTION_REGISTRY, PROMPT_ACTION_*)
 */

var worldbookEngine = (function() {

    /**
     * 扫描文本中是否包含 NPC 名字，返回匹配到的 NPC 内容数组
     * @param {string} userInput - 本次用户输入
     * @param {string} lastAIReply - 上一次 AI 完整回复
     * @returns {Array<{name: string, content: string}>} 匹配到的 NPC 列表
     */
    function matchNPCs(userInput, lastAIReply) {
        if (!window.NPC_REGISTRY) return [];

        var searchText = (userInput || '') + (lastAIReply || '');
        var matched = [];

        for (var i = 0; i < NPC_REGISTRY.length; i++) {
            var entry = NPC_REGISTRY[i];
            if (searchText.indexOf(entry.name) !== -1) {
                var content = window[entry.varName];
                if (content) {
                    matched.push({ name: entry.name, content: content });
                }
            }
        }

        return matched;
    }

    /**
     * 扫描用户输入中的行动关键词，返回首个匹配的行动指导内容
     * @param {string} userInput - 本次用户输入
     * @returns {string|null} 匹配到的行动指导内容，或 null
     */
    function matchActionGuide(userInput) {
        if (!window.ACTION_REGISTRY || !userInput) return null;

        for (var i = 0; i < ACTION_REGISTRY.length; i++) {
            var entry = ACTION_REGISTRY[i];
            for (var k = 0; k < entry.keys.length; k++) {
                if (userInput.indexOf(entry.keys[k]) !== -1) {
                    return window[entry.varName] || null;
                }
            }
        }

        return null;
    }

    return {
        matchNPCs: matchNPCs,
        matchActionGuide: matchActionGuide
    };
})();
