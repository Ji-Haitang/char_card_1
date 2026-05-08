/**
 * token-utils.js - Token 估算工具
 * 提供快速 token 数估算（无需外部 tokenizer 库）
 * 
 * 依赖：无
 */

var tokenUtils = (function() {

    /**
     * 快速估算文本 token 数
     * 中日韩字符按 1.5 token/字，其余按 4 字符/token，再乘 1.1 安全系数
     */
    function estimate(text) {
        if (!text) return 0;
        var cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length;
        var raw = Math.ceil(cjk * 1.5 + (text.length - cjk) / 4);
        return Math.ceil(raw * 1.1);
    }

    /**
     * 估算 messages 数组总 token 数
     * @param {Array} messages - [{role, content}]
     * @returns {number}
     */
    function estimateMessages(messages) {
        if (!messages || messages.length === 0) return 0;
        var total = 0;
        for (var i = 0; i < messages.length; i++) {
            // 每条消息有约 4 token 的 role/结构开销
            total += 4 + estimate(messages[i].content || '');
        }
        return total;
    }

    return { estimate: estimate, estimateMessages: estimateMessages };
})();
