/**
 * response-parser.js - 纯解析器层
 * 将现有 parseOutput 拆分为纯解析函数，不写全局变量。
 */

var responseParser = (function() {
    /**
     * 移除 thinking / ANAL 类标签块（对齐 index.html 内联版）
     * 支持嵌套循环移除 + 未闭合标签截断
     */
    function removeThinkingContent(text) {
        if (!text) return '';
        var result = text;

        // 步骤1: 循环移除完整的 ANAL 块
        var prevResult;
        do {
            prevResult = result;
            result = result.replace(
                /<([^>\/]+)>([\s\S]*?)<\/([^>]+)>/g,
                function(match, openTag, inner, closeTag) {
                    var normOpen = openTag.replace(/[\s_]/g, '').toUpperCase();
                    var normClose = closeTag.replace(/[\s_]/g, '').toUpperCase();
                    if (normOpen.indexOf('ANAL') !== -1 || normClose.indexOf('ANAL') !== -1) {
                        return '';
                    }
                    return match;
                }
            );
        } while (result !== prevResult);

        // 步骤2: 截断未闭合的 ANAL 开始标签
        var openTagPattern = /<([^>\/]+)>/g;
        var m;
        var lastThinkingStart = -1;
        while ((m = openTagPattern.exec(result)) !== null) {
            var normalized = m[1].replace(/[\s_]/g, '').toUpperCase();
            if (normalized.indexOf('ANAL') !== -1) {
                lastThinkingStart = m.index;
            }
        }
        if (lastThinkingStart !== -1) {
            result = result.substring(0, lastThinkingStart);
        }

        return result.trim();
    }

    function extractMainText(text) {
        if (!text) return '';

        // 优先策略：匹配 <MAIN_TEXT> 标签（容忍大小写、标签内外空格/下划线）
        var openTagRe = /<[\s]*[Mm][Aa][Ii][Nn][\s_]*[Tt][Ee][Xx][Tt][\s]*>/;
        var openMatch = openTagRe.exec(text);
        if (openMatch) {
            var contentStart = openMatch.index + openMatch[0].length;
            // 尝试找闭合标签
            var closeTagRe = /<[\s]*\/[\s]*[Mm][Aa][Ii][Nn][\s_]*[Tt][Ee][Xx][Tt][\s]*>/;
            var closeMatch = closeTagRe.exec(text.substring(contentStart));
            if (closeMatch) {
                return text.substring(contentStart, contentStart + closeMatch.index).trim();
            }
            // 闭合标签缺失：截到下一个结构性标签或字符串末尾
            var structuralRe = /<[\s]*\/?[\s]*(?:[Ss][Uu][Mm][Mm][Aa][Rr][Yy]|[Ss][Ii][Dd][Ee][\s_]*[Nn][Oo][Tt][Ee]|[Ss][Ll][Gg][\s_]*[Mm][Oo][Dd][Ee])[\s]*>/;
            var structMatch = structuralRe.exec(text.substring(contentStart));
            if (structMatch) {
                return text.substring(contentStart, contentStart + structMatch.index).trim();
            }
            return text.substring(contentStart).trim();
        }

        // 回退策略：原有逻辑（兼容无 <MAIN_TEXT> 标签的旧格式）
        var match = text.match(/[#*\u4e00-\u9fff\u3400-\u4dbf][^<]*/);
        if (!match) return '';
        var startIndex = text.indexOf(match[0]);
        var endIndex = text.indexOf('<', startIndex);
        var mainText = endIndex > -1 ? text.substring(startIndex, endIndex) : text.substring(startIndex);
        return mainText.trim();
    }

    /**
     * 提取 SUMMARY 内容（对齐 index.html 内联版）
     * 主方法：正则匹配 <SUMMARY> 标签
     * 鲁棒回退：从首个 { 往前搜索，在 > 和有意义字符之间提取可能的 SUMMARY 文本
     */
    function extractSummaries(text) {
        if (!text) return [];
        var summaries = [];
        var regex = /<[\s_]*[Ss][Uu][Mm][Mm][Aa][Rr][Yy][\s_]*>([\s\S]*?)<[\s_]*\/[\s_]*[Ss][Uu][Mm][Mm][Aa][Rr][Yy][\s_]*>/g;
        var match;
        while ((match = regex.exec(text)) !== null) {
            var content = match[1].trim();
            if (content) summaries.push(content);
        }

        // 鲁棒回退：如果主方法未提取到，尝试从 JSON 前的文本中提取
        if (summaries.length === 0) {
            var jsonStartIndex = text.indexOf('{');
            if (jsonStartIndex > -1) {
                var searchStart = jsonStartIndex - 1;
                while (searchStart >= 0) {
                    var char = text[searchStart];
                    if (/[\u4e00-\u9fff\u3400-\u4dbf\w]/.test(char)) {
                        var summaryStartSearch = searchStart;
                        while (summaryStartSearch >= 0 && text[summaryStartSearch] !== '>') {
                            summaryStartSearch--;
                        }
                        if (summaryStartSearch >= 0) {
                            var potentialSummary = text.substring(summaryStartSearch + 1, searchStart + 1).trim();
                            if (potentialSummary.length > 0 && potentialSummary.indexOf('<MAIN_TEXT>') === -1) {
                                summaries.push(potentialSummary);
                            }
                        }
                        break;
                    }
                    searchStart--;
                }
            }
        }

        return summaries;
    }

    function extractSideNoteJson(text) {
        if (!text) return null;
        // 先提取 <SIDE_NOTE> 标签内的内容，避免被 MAIN_TEXT/SUMMARY 中的 { 干扰
        var sideNoteMatch = text.match(/<[\s_]*[Ss][Ii][Dd][Ee][\s_]*[Nn][Oo][Tt][Ee][\s_]*>([\s\S]*?)(?:<[\s_]*\/[\s_]*[Ss][Ii][Dd][Ee][\s_]*[Nn][Oo][Tt][Ee][\s_]*>|$)/);
        var searchText = sideNoteMatch ? sideNoteMatch[1] : text;
        var jsonStartIndex = searchText.indexOf('{');
        if (jsonStartIndex === -1) return null;
        var jsonEndIndex = searchText.indexOf('<', jsonStartIndex);
        var jsonText = jsonEndIndex > -1 ? searchText.substring(jsonStartIndex, jsonEndIndex) : searchText.substring(jsonStartIndex);
        // 修复 LLM 输出中文弯引号的问题：将中文对话引号替换为单引号，避免破坏 JSON 字符串结构
        // 注意：不能替换为 ASCII 双引号，否则会截断 JSON 字符串中的对话内容
        jsonText = jsonText.replace(/[\u201c\u201d\u2018\u2019]/g, "'");
        try {
            return JSON.parse(jsonText.trim());
        } catch (e) {
            console.error('SIDE_NOTE parse fail:', e.message);
            console.error('SIDE_NOTE raw jsonText (first 200 chars):', JSON.stringify(jsonText.trim().substring(0, 200)));
            return null;
        }
    }

    function run(rawText) {
        var cleaned = removeThinkingContent(rawText || '');
        return {
            raw: rawText,
            cleanedText: cleaned,
            mainText: extractMainText(cleaned),
            summaries: extractSummaries(cleaned),
            sideNote: extractSideNoteJson(cleaned)
        };
    }

    return { removeThinkingContent: removeThinkingContent, extractMainText: extractMainText, extractSummaries: extractSummaries, extractSideNoteJson: extractSideNoteJson, run: run };
})();
