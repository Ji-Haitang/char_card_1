/** 台词定位：从同次主回复的末标记生成具有UTF-16位置的配音单元。 */
var speechPlan = (function () {
    'use strict';
    async function hash(text) {
        var bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(bytes)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    }
    function renderHash(units) {
        return hash(JSON.stringify(['direction-v1',units.map(function(u){return [u.id,u.text,u.speakerId,u.kind,u.sourceLine,u.start,u.end,u.emotion||''];})]));
    }
    function documentFor(text) {
        var source = String(text || '').replace(/\r\n?/g, '\n').replace(/<br\s*\/?\s*>/gi, '\n');
        var blocks = [];
        source.split('\n').forEach(function (line, lineIndex) {
            var parts = line.split('|'), body = parts.length === 5 ? parts[0] : line;
            if (!body.trim()) return;
            blocks.push({ id: 'b' + lineIndex, text: body, sourceLine: lineIndex });
        });
        return { source: source, blocks: blocks };
    }
    /** inline-v1: one segment per line; body ends with 【speakerId；emotion】. */
    async function fromMainText(text, characters, options) {
        if (options && ['length','MAX_TOKENS'].includes(options.finishReason)) throw new Error('主回复被截断，未编排语音');
        var rawSource = String(text || ''), units = [], issues = [];
        var ids = new Set((characters || []).map(function(c){return c.id;}));
        var source = documentFor(rawSource).source.split('\n').map(function(line, sourceLine){
            var fields = line.split('|'), body = fields[0];
            if (fields.length !== 1 && fields.length !== 5) {
                if (/【[^【】]*[；;]/.test(line)) issues.push({sourceLine:sourceLine,reason:'line-shape'});
                return line;
            }
            var hint = /(^|[^\\])【[^【】]*[；;]/.test(body);
            var mark = /【([A-Z][A-Z0-9_]{0,31})；([^【】；;|<>\x00-\x1f]{1,24})】([ \t]*)$/u.exec(body);
            if (!mark || (mark.index > 0 && body[mark.index-1] === '\\')) {
                if (hint) issues.push({sourceLine:sourceLine,reason:'invalid-marker'});
                return line;
            }
            var spoken = body.slice(0,mark.index), speaker = mark[1], emotion = mark[2].trim();
            if (/(^|[^\\])【[^【】]*[；;]/.test(spoken) || !spoken.trim() || !emotion ||
                !(ids.has(speaker) || ['USER','NARRATOR','UNKNOWN'].includes(speaker))) {
                issues.push({sourceLine:sourceLine,reason:'invalid-segment'}); return line;
            }
            var start = spoken.length - spoken.trimStart().length, end = spoken.trimEnd().length;
            units.push({id:'b'+sourceLine+':'+start+'-'+end,blockId:'b'+sourceLine,sourceLine:sourceLine,
                start:start,end:end,text:spoken.slice(start,end),emotion:emotion,
                speakerId:['NARRATOR','UNKNOWN'].includes(speaker)?null:speaker,
                kind:speaker==='NARRATOR'?'narration':speaker==='UNKNOWN'?'uncertain':'speech'});
            fields[0] = spoken + mark[3]; return fields.join('|');
        }).join('\n');
        return {version:'inline-v1',rawSource:rawSource,source:source,sourceHash:await hash(source),units:units,issues:issues};
    }
    function directionInstruction() {
        return '情绪字段是1至24字的简短表现描述，可写“轻声、稍慢，压着怒气”；不写长导演词或重新指定性别、年龄、音色。不含括号、尖括号、分号、竖线或换行。仍只使用行末【ID；表现描述】，不混用前置标签或额外台词JSON。';
    }
    function singleInstruction(character) {
        return '[单句语音测试格式，仅约束MAIN_TEXT排版]\n测试角色：'+JSON.stringify({id:character.id,name:character.name})+'。\n'+
            '只有正文实际出现该角色的口头对白时，才将其中一条不超过120字的对白单独成行，并在末尾按【'+character.id+'；情绪】格式填写实际简短情绪参考，例如【'+character.id+'；普通】或【'+character.id+'；欣喜】，不要输出占位词。'+
            '台词行只放实际说出口的文字，说话人介绍、动作和旁白另行。不要为了测试新增人物或对白。其他内容保留，不猜说话人。标记不属于台词内容。'+
            '已有五字段行把标记放在第一个字段末尾，场景/时间/出场/CG字段原样保留。'+
            'MAIN_TEXT、SUMMARY、SIDE_NOTE及其它原有格式规则保持不变，不输出额外JSON清单。'+directionInstruction();
    }
    function speakable(plan, bindings) {
        return plan.units.filter(function (u) { return u.kind === 'speech' && u.speakerId && u.speakerId !== 'USER' && bindings[u.speakerId]; });
    }
    function requiresDecision(plan, bindings) {
        return plan.issues.length > 0 || plan.units.some(function (u) {
            return u.kind === 'uncertain' && (u.speakerId === null || (u.speakerId !== 'USER' && bindings[u.speakerId]));
        });
    }
    function splitText(text, maxCharacters) {
        var chars = Array.from(text), limit = maxCharacters || 240, chunks = [];
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('台词分段长度无效');
        while (chars.length) {
            var end = Math.min(limit, chars.length);
            if (chars.length > limit) for (var i = end - 1; i >= Math.floor(end / 2); i--) { if (/[。！？；，\n]/.test(chars[i])) { end = i + 1; break; } }
            chunks.push(chars.splice(0, end).join(''));
        }
        return chunks;
    }
    return { hash:hash,renderHash:renderHash,documentFor:documentFor,fromMainText:fromMainText,
        singleInstruction:singleInstruction,directionInstruction:directionInstruction,speakable:speakable,
        requiresDecision:requiresDecision,splitText:splitText };
})();
