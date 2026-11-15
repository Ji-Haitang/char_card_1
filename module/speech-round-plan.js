/** Same-response round labels -> exact reading-aligned NPC units. No storage, dispatch or cast inference. */
var speechRoundPlan = (function () {
    'use strict';
    function instruction(characters) {
        return [
            '[整轮台词标记 round-v1，仅约束MAIN_TEXT排版]',
            'NPC合法ID与姓名：' + JSON.stringify(characters.map(function(c){return {id:c.id,name:c.name};})),
            '保留完整正文、旁白和玩家文字，不删减或为了配音新增剧情。每句对白另起一行，每个非空正文行只表达一种归属；同段不同人物的台词、动作与旁白分别分行。',
            '每行正文末尾必须有且仅有一个【ID；情绪】标记，使用全角分号；情绪填写简短实际参考，不写占位词。NPC实际说出口的台词用其合法ID；玩家口头对白用USER；旁白、动作、内心和非口头引文用NARRATOR。',
            '无法确定口头对白归属时写【UNKNOWN；不确定】，该轮须选择无声继续；不依据人物风格、在场cast顺序或第一个角色猜说话人，不再请求另一个LLM识别或纠错。',
            '原有五字段行仍为正文|场景|时间|出场角色:表情|CG行为，只把末标记放在第一个字段末尾；同段拆行沿用其原元数据，场景/时间/出场/CG及SUMMARY、SIDE_NOTE继续遵守原规范。',
            '标记不属于正文台词；不输出额外JSON台词清单，不改其它提示词或业务输出规则。',
            speechPlan.directionInstruction()
        ].join('\n');
    }
    function boundary(text, index) {
        return !(index > 0 && index < text.length && /[\uD800-\uDBFF]/.test(text[index-1]) && /[\uDC00-\uDFFF]/.test(text[index]));
    }
    function readingRanges(reading, sourceHash, body, issues) {
        function bad(reason) { issues.push({reason:reason}); return null; }
        if (!reading || !Array.isArray(reading.frames) || !Array.isArray(reading.units)) return bad('invalid-reading-plan');
        if (reading.sourceHash !== sourceHash) return bad('reading-source-hash');
        var offsets = [], covered = [], at = 0, text = [];
        for (var i = 0; i < reading.frames.length; i++) {
            var frame = reading.frames[i];
            if (!frame || typeof frame.text !== 'string' || typeof frame.event !== 'boolean') return bad('invalid-reading-frame');
            if (frame.event) continue;
            offsets[i] = at; covered[i] = 0; text.push(frame.text); at += frame.text.length + 2;
        }
        if (text.join('\n\n') !== body) return bad('reading-text-coverage');
        var ranges = [], previousFrame = -1;
        for (i = 0; i < reading.units.length; i++) {
            var unit = reading.units[i];
            if (!unit || !Number.isInteger(unit.frameIndex) || !reading.frames[unit.frameIndex]) return bad('invalid-reading-unit');
            frame = reading.frames[unit.frameIndex];
            if (frame.event) continue;
            if (!Number.isInteger(unit.start) || !Number.isInteger(unit.end) || unit.start !== covered[unit.frameIndex] ||
                unit.end <= unit.start || unit.end > frame.text.length || unit.frameIndex < previousFrame ||
                !boundary(frame.text, unit.start) || !boundary(frame.text, unit.end)) return bad('reading-unit-coverage');
            ranges.push({ index:i, start:offsets[unit.frameIndex] + unit.start, end:offsets[unit.frameIndex] + unit.end });
            covered[unit.frameIndex] = unit.end; previousFrame = unit.frameIndex;
        }
        for (i = 0; i < reading.frames.length; i++) {
            if (!reading.frames[i].event && covered[i] !== reading.frames[i].text.length) return bad('reading-unit-coverage');
        }
        return ranges;
    }
    async function compile(rawSource, characters, options) {
        if (typeof rawSource !== 'string' || !Array.isArray(characters)) throw new TypeError('整轮编排缺少原文或角色表');
        characters = structuredClone(characters); options = structuredClone(options || {});
        // Completion gates synthesis, not text cleanup: preserve the same clean projection on truncation.
        var parsed = await speechPlan.fromMainText(rawSource, characters), issues = parsed.issues.slice(), candidates = [];
        if (!['stop','STOP','end_turn','tool_calls'].includes(options.finishReason)) issues.push({reason:'completion-not-confirmed'});
        var maxChars = options.maxChars === undefined ? 3000 : options.maxChars;
        var maxClips = options.maxClips === undefined ? 24 : options.maxClips;
        if (!Number.isSafeInteger(maxChars) || maxChars < 0 || !Number.isSafeInteger(maxClips) || maxClips < 0) issues.push({reason:'invalid-budget'});
        var labelled = new Set(parsed.units.map(function(u){return u.sourceLine;}));
        speechPlan.documentFor(rawSource).blocks.forEach(function(block){
            if (!labelled.has(block.sourceLine) && !issues.some(function(issue){return issue.sourceLine === block.sourceLine;})) {
                issues.push({sourceLine:block.sourceLine,reason:'line-unmarked'});
            }
        });
        var ids = new Set(characters.map(function(c){return c.id;}));
        var npcUnits = parsed.units.filter(function(unit){
            if (unit.kind === 'uncertain') issues.push({sourceLine:unit.sourceLine,reason:'uncertain-speaker'});
            return unit.kind === 'speech' && unit.speakerId !== 'USER' && ids.has(unit.speakerId);
        });
        // Inspect all NPCs before splitting/dispatch; no silent omission of an unbound voice.
        if (options.voices !== undefined) npcUnits.forEach(function(unit){
            var voice = options.voices && Object.prototype.hasOwnProperty.call(options.voices,unit.speakerId) && options.voices[unit.speakerId];
            if (!voice || typeof voice.speakerId !== 'string' || !voice.speakerId.trim()) issues.push({sourceLine:unit.sourceLine,speakerId:unit.speakerId,reason:'unbound-npc'});
        });
        var blocks = speechPlan.documentFor(parsed.source).blocks, byLine = new Map(), bodyAt = 0;
        blocks.forEach(function(block){
            var trimmed = block.text.trim(), leading = block.text.length - block.text.trimStart().length;
            byLine.set(block.sourceLine,{text:block.text,body:trimmed,leading:leading,start:bodyAt}); bodyAt += trimmed.length + 2;
        });
        var body = blocks.map(function(block){return block.text.trim();}).join('\n\n');
        var ranges = readingRanges(options.readingPlan, parsed.sourceHash, body, issues);
        if (ranges) npcUnits.forEach(function(unit){
            var block = byLine.get(unit.sourceLine);
            if (!block || unit.start !== block.leading || unit.end !== block.leading + block.body.length || block.text.slice(unit.start,unit.end) !== unit.text) {
                issues.push({sourceLine:unit.sourceLine,reason:'source-unit-mismatch'}); return;
            }
            var first = block.start + unit.start - block.leading, last = block.start + unit.end - block.leading;
            ranges.forEach(function(range){
                var from = Math.max(first,range.start), to = Math.min(last,range.end);
                if (from >= to) return;
                var part = body.slice(from,to), text = part.trim();
                if (!text) return;
                var start = block.leading + from - block.start + part.length - part.trimStart().length, end = start + text.length;
                if (block.text.slice(start,end) !== text || !boundary(block.text,start) || !boundary(block.text,end)) {
                    issues.push({sourceLine:unit.sourceLine,reason:'source-unit-mismatch'}); return;
                }
                if (Array.from(text).length > 240) issues.push({sourceLine:unit.sourceLine,reason:'clip-too-long'});
                candidates.push({id:'b'+unit.sourceLine+':'+start+'-'+end,blockId:unit.blockId,sourceLine:unit.sourceLine,
                    start:start,end:end,text:text,speakerId:unit.speakerId,kind:'speech',emotion:unit.emotion,readingIndex:range.index});
            });
        });
        var length = candidates.reduce(function(sum,unit){return sum + Array.from(unit.text).length;},0);
        if (length > maxChars) issues.push({reason:'max-chars'});
        if (candidates.length > maxClips) issues.push({reason:'max-clips'});
        var units = issues.length ? [] : candidates;
        var planHash = await speechPlan.hash(JSON.stringify(units.map(function(u){return [u.id,u.text,u.speakerId,u.kind,u.sourceLine,u.start,u.end];})));
        return {version:'round-v1',rawSource:rawSource,source:parsed.source,sourceHash:parsed.sourceHash,units:units,issues:issues,planHash:planHash};
    }
    return { instruction:instruction, compile:compile };
})();
