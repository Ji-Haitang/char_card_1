/**
 * json-repair-helper.js - 统一容错 JSON 解析（针对 LLM 返回的不规范 JSON）
 *
 * 暴露 window.safeParseLLMJson(text, opts) → 解析成功返回对象，失败返回 null
 *
 * 三层递进：
 *   1. 直接 JSON.parse（最快路径，绝大多数命中）
 *   2. 轻量修复：弯引号→直引号、字符串值内裸 ASCII 双引号（两侧均为 CJK/中文标点才替换）
 *   3. JSONRepair.jsonrepair 兜底（处理截断/未闭合/全角括号/trailing 逗号等结构性残缺）
 *
 * opts:
 *   - onRepaired(layer, rawText): 命中第2/3层修复时的回调（用于 console.warn 标记修复产物）
 *   - allowRepair: 默认 true；传 false 则只做第1层
 *
 * 注意：第3层（jsonrepair）会"尽力凑成合法 JSON"，对深度截断可能返回缺字段/值被改的对象，
 * 调用方若对字段完整性敏感，应通过 onRepaired 知晓这是修复产物并自行权衡。
 */
(function() {
    'use strict';

    var CJK_INNER = '[一-鿿＀-￯　-〿，。、：；！？…—～]';

    // 第2层：轻量修复（弯引号 + 值内裸双引号）
    function lightRepair(text) {
        var fixed = String(text)
            .replace(/[“”]/g, '"')          // 弯双引号 → 直双引号
            .replace(/[‘’]/g, "'");          // 弯单引号 → 直单引号
        // 值内裸 ASCII 双引号：仅当引号两侧都是 CJK/中文标点时视为字符串内引用，替换为书角引号
        fixed = fixed.replace(new RegExp('(' + CJK_INNER + ')"(' + CJK_INNER + ')', 'g'), '$1」$2');
        return fixed;
    }

    function tryParse(text) {
        try { return { ok: true, data: JSON.parse(text) }; }
        catch (e) { return { ok: false }; }
    }

    /**
     * @param {string} text 待解析文本
     * @param {object} [opts] { onRepaired, allowRepair }
     * @returns {object|null}
     */
    function safeParseLLMJson(text, opts) {
        if (text == null || text === '') return null;
        opts = opts || {};
        var allowRepair = opts.allowRepair !== false;

        // 第1层：直接 parse
        var r1 = tryParse(String(text).trim());
        if (r1.ok) return r1.data;
        if (!allowRepair) return null;

        // 第2层：轻量修复
        var light = lightRepair(String(text).trim());
        var r2 = tryParse(light);
        if (r2.ok) {
            if (typeof opts.onRepaired === 'function') opts.onRepaired(2, text);
            return r2.data;
        }

        // 第3层：jsonrepair 兜底（库缺失则跳过）
        if (typeof JSONRepair !== 'undefined' && JSONRepair && typeof JSONRepair.jsonrepair === 'function') {
            try {
                var repaired = JSONRepair.jsonrepair(String(text));
                var r3 = tryParse(repaired);
                if (r3.ok) {
                    // 完整性校验（仅第3层）：最后字段缺失 → 视为截断，当失败返回 null
                    if (r3.data && typeof r3.data === 'object') {
                        var incomplete = false;
                        if (typeof opts.lastKeyCheck === 'function') {
                            incomplete = !opts.lastKeyCheck(r3.data);
                        } else if (opts.lastKey) {
                            incomplete = !(opts.lastKey in r3.data);
                        }
                        if (incomplete) {
                            console.warn('[safeParseLLMJson] jsonrepair 修复后缺少最后字段(' + (opts.lastKey || 'custom') + ')，判定为截断，按失败处理');
                            return null;
                        }
                    }
                    if (typeof opts.onRepaired === 'function') opts.onRepaired(3, text);
                    return r3.data;
                }
            } catch (e) { /* jsonrepair 自身抛错则视为失败 */ }
        }
        return null;
    }

    window.safeParseLLMJson = safeParseLLMJson;
})();
