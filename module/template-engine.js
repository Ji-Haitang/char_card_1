/**
 * template-engine.js - 变量替换 + EJS 子集编译与渲染
 * 
 * 支持 ST 兼容的 {{变量}} 语法和 EJS 子集。
 * Phase 1 支持：
 *   1. const 变量声明
 *   2. if / else if / else 条件分支
 *   3. <%= expr %> / <%- expr %> 输出
 *   4. 最终做 {{var}} 替换
 * 
 * 依赖：无
 */

var templateEngine = (function() {
    var TEMPLATE_REGEX = /\{\{\s*([^{}:]+?)\s*(?::\s*([^{}]*?)\s*)?\}\}/g;

    /**
     * 将模板中的 {{var}} 替换为实际值，支持 {{var:默认值}} 语法
     */
    function renderTemplate(template, variables, undefinedBehavior) {
        if (undefinedBehavior === undefined) undefinedBehavior = 'keep';
        if (!template) return '';
        return template.replace(TEMPLATE_REGEX, function(match, name, defaultValue) {
            var key = name.trim();
            if (key in variables) {
                var value = variables[key];
                if (value === null || value === undefined) return '';
                if (typeof value === 'object') return JSON.stringify(value);
                return String(value);
            }
            if (defaultValue !== undefined) return defaultValue.trim();
            return undefinedBehavior === 'empty' ? '' : match;
        });
    }

    function extractVariableNames(template) {
        var names = [];
        var regex = new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags);
        var match;
        while ((match = regex.exec(template)) !== null) {
            if (names.indexOf(match[1].trim()) === -1) {
                names.push(match[1].trim());
            }
        }
        return names;
    }

    /**
     * EJS Lite 编译器
     * 支持：const / if / else if / else / <%= %> / <%- %>
     * 返回编译后的函数
     *
     * 关键：文本片段需要转义后嵌入字符串字面量，
     *       代码片段必须保持原样作为 JS 代码执行。
     */
    function compileEJSLite(template) {
        var lines = template.split(/\r?\n/);
        var output = [];

        function escapeStr(s) {
            return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var parts = []; // 收集本行的代码片段
            var idx = 0;

            while (idx < line.length) {
                var tagStart = line.indexOf('<%', idx);
                if (tagStart === -1) {
                    // 剩余全是文本
                    parts.push('__out += "' + escapeStr(line.substring(idx)) + '";');
                    break;
                }

                // 标签前的文本
                if (tagStart > idx) {
                    parts.push('__out += "' + escapeStr(line.substring(idx, tagStart)) + '";');
                }

                // 找标签结尾
                var tagEnd = line.indexOf('%>', tagStart + 2);
                if (tagEnd === -1) {
                    // 没有闭合，当文本处理
                    parts.push('__out += "' + escapeStr(line.substring(tagStart)) + '";');
                    idx = line.length;
                    break;
                }

                var inner = line.substring(tagStart + 2, tagEnd);

                // 处理 <%_ ... _%> 的前后空白修饰符
                if (inner.length > 0 && inner[0] === '_') inner = inner.substring(1);
                if (inner.length > 0 && inner[inner.length - 1] === '_') inner = inner.substring(0, inner.length - 1);

                var isOutput = false;
                var isUnescaped = false;
                if (inner.length > 0 && inner[0] === '=') {
                    isOutput = true;
                    inner = inner.substring(1);
                } else if (inner.length > 0 && inner[0] === '-') {
                    isOutput = true;
                    isUnescaped = true;
                    inner = inner.substring(1);
                }

                var trimmed = inner.trim();

                if (isOutput) {
                    // 输出表达式
                    parts.push('__out += ' + (isUnescaped ? 'String(' : 'String(') + trimmed + ');');
                } else {
                    // 控制语句（if / else / const 等），直接作为 JS 代码
                    parts.push(trimmed);
                }

                idx = tagEnd + 2;
            }

            // 每行末尾加换行（除非该行全是控制语句）
            parts.push('__out += "\\n";');
            output.push(parts.join('\n'));
        }

        var source = output.join('\n');
        // 清理空输出
        source = source.replace(/__out \+= "";/g, '');

        try {
            // ctx 中包含 gameData、user 等变量
            // 用 with(ctx) 让模板中可以直接写 gameData.xxx
            var fn = new Function('ctx', 'with(ctx) { var __out = ""; ' + source + ' return __out; }');
            return fn;
        } catch (e) {
            console.error('EJSLite compile error:', e.message, '\nSource:\n', source.substring(0, 1000));
            return function(ctx) { return template; };
        }
    }

    /**
     * 渲染带 EJS 的 prompt 模板
     * @param {string} template - 原始模板
     * @param {object} context - 上下文（含 gameData, user 等）
     */
    function renderPromptTemplate(template, context) {
        if (!template) return '';
        try {
            var compiledFn = compileEJSLite(template);
            var ejsOutput = compiledFn(context);
            return renderTemplate(ejsOutput, context, 'empty');
        } catch (e) {
            console.error('renderPromptTemplate error:', e.message);
            return renderTemplate(template, context, 'empty');
        }
    }

    return {
        renderTemplate: renderTemplate,
   extractVariableNames: extractVariableNames,
        compileEJSLite: compileEJSLite,
        renderPromptTemplate: renderPromptTemplate
    };
})();
