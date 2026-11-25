/** 台词定位：从同次主回复的末标记生成具有UTF-16位置的配音单元。 */
var speechPlan = (function () {
    'use strict';
    async function hash(text) {
        var bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(bytes))
            .map(function (x) {
                return x.toString(16).padStart(2, '0');
            })
            .join('');
    }
    function renderHash(units, model = 'drama-3') {
        return hash(
            JSON.stringify([
                // 保留旧 D3 指纹的字节布局；其他模型有独立的录音身份。
                ...(model === 'drama-3' ? [] : [model]),
                'direction-v1',
                units.map(function (u) {
                    return [
                        u.id,
                        u.text,
                        u.speakerId,
                        u.kind,
                        u.sourceLine,
                        u.start,
                        u.end,
                        u.emotion || '',
                    ];
                }),
            ]),
        );
    }
    function documentFor(text) {
        var source = String(text || '')
            .replace(/\r\n?/g, '\n')
            .replace(/<br\s*\/?\s*>/gi, '\n');
        var blocks = [];
        source.split('\n').forEach(function (line, lineIndex) {
            var parts = line.split('|'),
                body = parts.length === 5 ? parts[0] : line;
            if (!body.trim()) return;
            blocks.push({ id: 'b' + lineIndex, text: body, sourceLine: lineIndex });
        });
        return { source: source, blocks: blocks };
    }
    /** inline-v1: one segment per line; body ends with 【speakerId；emotion】. */
    async function fromMainText(text, characters, options) {
        if (options && ['length', 'MAX_TOKENS'].includes(options.finishReason))
            throw new Error('主回复被截断，未编排语音');
        var rawSource = String(text || ''),
            units = [],
            issues = [];
        var ids = new Set(
            (characters || []).map(function (c) {
                return c.id;
            }),
        );
        var source = documentFor(rawSource)
            .source.split('\n')
            .map(function (line, sourceLine) {
                var fields = line.split('|'),
                    body = fields[0];
                if (fields.length !== 1 && fields.length !== 5) {
                    if (/【[^【】]*[；;]/.test(line))
                        issues.push({ sourceLine: sourceLine, reason: 'line-shape' });
                    return line;
                }
                var hint = /(^|[^\\])【[^【】]*[；;]/.test(body);
                var mark =
                    /【([A-Z][A-Z0-9_]{0,31})；([^【】；;|<>\x00-\x1f]{1,24})】([ \t]*)$/u.exec(
                        body,
                    );
                if (!mark || (mark.index > 0 && body[mark.index - 1] === '\\')) {
                    if (hint) issues.push({ sourceLine: sourceLine, reason: 'invalid-marker' });
                    return line;
                }
                var spoken = body.slice(0, mark.index),
                    speaker = mark[1],
                    emotion = mark[2].trim();
                if (
                    /(^|[^\\])【[^【】]*[；;]/.test(spoken) ||
                    !spoken.trim() ||
                    !emotion ||
                    !(ids.has(speaker) || ['USER', 'NARRATOR', 'UNKNOWN'].includes(speaker) || options?.roundProjection === true)
                ) {
                    issues.push({ sourceLine: sourceLine, reason: 'invalid-segment' });
                    return line;
                }
                var start = spoken.length - spoken.trimStart().length,
                    end = spoken.trimEnd().length;
                units.push({
                    id: 'b' + sourceLine + ':' + start + '-' + end,
                    blockId: 'b' + sourceLine,
                    sourceLine: sourceLine,
                    start: start,
                    end: end,
                    text: spoken.slice(start, end),
                    emotion: emotion,
                    speakerId: ['NARRATOR', 'UNKNOWN'].includes(speaker) ? null : speaker,
                    kind:
                        speaker === 'NARRATOR'
                            ? 'narration'
                            : speaker === 'UNKNOWN'
                              ? 'uncertain'
                              : 'speech',
                });
                fields[0] = spoken + mark[3];
                return fields.join('|');
            })
            .join('\n');
        return {
            version: 'inline-v1',
            rawSource: rawSource,
            source: source,
            sourceHash: await hash(source),
            units: units,
            issues: issues,
        };
    }
    function directionInstruction() {
        return '情绪字段是1至24字的简短表现描述，可写“轻声、稍慢，压着怒气”；不写长导演词或重新指定性别、年龄、音色。不含括号、尖括号、分号、竖线或换行。仍只使用行末【ID；表现描述】，不混用前置标签或额外台词JSON。';
    }
    function singleInstruction(character) {
        return (
            '[单句语音测试格式，仅约束MAIN_TEXT排版]\n测试角色：' +
            JSON.stringify({ id: character.id, name: character.name }) +
            '。\n' +
            '只有正文实际出现该角色的口头对白时，才将其中一条不超过120字的对白单独成行，并在末尾按【' +
            character.id +
            '；情绪】格式填写实际简短情绪参考，例如【' +
            character.id +
            '；普通】或【' +
            character.id +
            '；欣喜】，不要输出占位词。' +
            '台词行只放实际说出口的文字，说话人介绍、动作和旁白另行。不要为了测试新增人物或对白。其他内容保留，不猜说话人。标记不属于台词内容。' +
            '已有五字段行把标记放在第一个字段末尾，场景/时间/出场/CG字段原样保留。' +
            'MAIN_TEXT、SUMMARY、SIDE_NOTE及其它原有格式规则保持不变，不输出额外JSON清单。' +
            directionInstruction()
        );
    }
    function speakable(plan, bindings) {
        return plan.units.filter(function (u) {
            return (
                u.kind === 'speech' &&
                u.speakerId &&
                u.speakerId !== 'USER' &&
                bindings[u.speakerId]
            );
        });
    }
    function requiresDecision(plan, bindings) {
        return (
            plan.issues.length > 0 ||
            plan.units.some(function (u) {
                return (
                    u.kind === 'uncertain' &&
                    (u.speakerId === null || (u.speakerId !== 'USER' && bindings[u.speakerId]))
                );
            })
        );
    }
    function splitText(text, maxCharacters) {
        var chars = Array.from(text),
            limit = maxCharacters || 240,
            chunks = [];
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('台词分段长度无效');
        while (chars.length) {
            var end = Math.min(limit, chars.length);
            if (chars.length > limit)
                for (var i = end - 1; i >= Math.floor(end / 2); i--) {
                    if (/[。！？；，\n]/.test(chars[i])) {
                        end = i + 1;
                        break;
                    }
                }
            chunks.push(chars.splice(0, end).join(''));
        }
        return chunks;
    }
    return {
        hash: hash,
        renderHash: renderHash,
        documentFor: documentFor,
        fromMainText: fromMainText,
        singleInstruction: singleInstruction,
        directionInstruction: directionInstruction,
        speakable: speakable,
        requiresDecision: requiresDecision,
        splitText: splitText,
    };
})();

/** Same-response round labels -> exact reading-aligned NPC units. No storage, dispatch or cast inference. */
var speechRoundPlan = (function () {
    'use strict';
    function instruction(characters) {
        return [
            '[整轮台词标记 round-v1，仅约束MAIN_TEXT排版]',
            'NPC合法ID与姓名：' +
                JSON.stringify(
                    characters.map(function (c) {
                        return { id: c.id, name: c.name };
                    }),
                ),
            '保留完整正文、旁白和玩家文字，不删减或为了配音新增剧情。每句对白另起一行，每个非空正文行只表达一种归属；同段不同人物的台词、动作与旁白分别分行。',
            '每行正文末尾必须有且仅有一个【ID；情绪】标记，使用全角分号；情绪填写简短实际参考，不写占位词。NPC实际说出口的台词用其合法ID；玩家口头对白用USER；旁白、动作、内心和非口头引文用NARRATOR。',
            '无法确定口头对白归属时写【UNKNOWN；不确定】，该轮须选择无声继续；不依据人物风格、在场cast顺序或第一个角色猜说话人，不再请求另一个LLM识别或纠错。',
            '原有五字段行仍为正文|场景|时间|出场角色:表情|CG行为，只把末标记放在第一个字段末尾；同段拆行沿用其原元数据，场景/时间/出场/CG及SUMMARY、SIDE_NOTE继续遵守原规范。',
            '标记不属于正文台词；不输出额外JSON台词清单，不改其它提示词或业务输出规则。',
            speechPlan.directionInstruction(),
        ].join('\n');
    }
    function boundary(text, index) {
        return !(
            index > 0 &&
            index < text.length &&
            /[\uD800-\uDBFF]/.test(text[index - 1]) &&
            /[\uDC00-\uDFFF]/.test(text[index])
        );
    }
    function readingRanges(reading, sourceHash, body, issues) {
        function bad(reason) {
            issues.push({ reason: reason });
            return null;
        }
        if (!reading || !Array.isArray(reading.frames) || !Array.isArray(reading.units))
            return bad('invalid-reading-plan');
        if (reading.sourceHash !== sourceHash) return bad('reading-source-hash');
        var offsets = [],
            covered = [],
            at = 0,
            text = [];
        for (var i = 0; i < reading.frames.length; i++) {
            var frame = reading.frames[i];
            if (!frame || typeof frame.text !== 'string' || typeof frame.event !== 'boolean')
                return bad('invalid-reading-frame');
            if (frame.event) continue;
            offsets[i] = at;
            covered[i] = 0;
            text.push(frame.text);
            at += frame.text.length + 2;
        }
        if (text.join('\n\n') !== body) return bad('reading-text-coverage');
        var ranges = [],
            previousFrame = -1;
        for (i = 0; i < reading.units.length; i++) {
            var unit = reading.units[i];
            if (!unit || !Number.isInteger(unit.frameIndex) || !reading.frames[unit.frameIndex])
                return bad('invalid-reading-unit');
            frame = reading.frames[unit.frameIndex];
            if (frame.event) continue;
            if (
                !Number.isInteger(unit.start) ||
                !Number.isInteger(unit.end) ||
                unit.start !== covered[unit.frameIndex] ||
                unit.end <= unit.start ||
                unit.end > frame.text.length ||
                unit.frameIndex < previousFrame ||
                !boundary(frame.text, unit.start) ||
                !boundary(frame.text, unit.end)
            )
                return bad('reading-unit-coverage');
            ranges.push({
                index: i,
                start: offsets[unit.frameIndex] + unit.start,
                end: offsets[unit.frameIndex] + unit.end,
            });
            covered[unit.frameIndex] = unit.end;
            previousFrame = unit.frameIndex;
        }
        for (i = 0; i < reading.frames.length; i++) {
            if (!reading.frames[i].event && covered[i] !== reading.frames[i].text.length)
                return bad('reading-unit-coverage');
        }
        return ranges;
    }
    async function compile(rawSource, characters, options) {
        if (typeof rawSource !== 'string' || !Array.isArray(characters))
            throw new TypeError('整轮编排缺少原文或角色表');
        characters = structuredClone(characters);
        options = structuredClone(options || {});
        // Completion gates synthesis, not text cleanup: preserve the same clean projection on truncation.
        var parsed = await speechPlan.fromMainText(rawSource, characters, {roundProjection:true}),
            issues = parsed.issues.slice(),
            candidates = [];
        if (!['stop', 'STOP', 'end_turn', 'tool_calls'].includes(options.finishReason))
            issues.push({ reason: 'completion-not-confirmed' });
        var maxChars = options.maxChars === undefined ? 3000 : options.maxChars;
        var maxClips = options.maxClips === undefined ? maxChars : options.maxClips;
        if (
            !Number.isSafeInteger(maxChars) ||
            maxChars < 0 ||
            !Number.isSafeInteger(maxClips) ||
            maxClips < 0
        )
            issues.push({ reason: 'invalid-budget' });
        var labelled = new Set(
            parsed.units.map(function (u) {
                return u.sourceLine;
            }),
        );
        speechPlan.documentFor(rawSource).blocks.forEach(function (block) {
            if (
                !labelled.has(block.sourceLine) &&
                !issues.some(function (issue) {
                    return issue.sourceLine === block.sourceLine;
                })
            ) {
                issues.push({ sourceLine: block.sourceLine, reason: 'line-unmarked' });
            }
        });
        var ids = new Set(
            characters.map(function (c) {
                return c.id;
            }),
        );
        var npcUnits = parsed.units.filter(function (unit) {
            return unit.kind === 'speech' && unit.speakerId !== 'USER' && ids.has(unit.speakerId);
        });
        // Freeze which registered voices were missing for this publication. Replay must not
        // depend on bindings edited after the recording was made.
        const omitted = new Set(options.omittedVoices || []);
        if (options.voices !== undefined) for (const unit of npcUnits) {
            const voice=options.voices?.[unit.speakerId];
            if (!voice?.speakerId?.trim()) omitted.add(unit.speakerId);
        }
        npcUnits=npcUnits.filter(u=>!omitted.has(u.speakerId));
        var blocks = speechPlan.documentFor(parsed.source).blocks,
            byLine = new Map(),
            bodyAt = 0;
        blocks.forEach(function (block) {
            var trimmed = block.text.trim(),
                leading = block.text.length - block.text.trimStart().length;
            byLine.set(block.sourceLine, {
                text: block.text,
                body: trimmed,
                leading: leading,
                start: bodyAt,
            });
            bodyAt += trimmed.length + 2;
        });
        var body = blocks
            .map(function (block) {
                return block.text.trim();
            })
            .join('\n\n');
        var ranges = readingRanges(options.readingPlan, parsed.sourceHash, body, issues);
        if (ranges)
            npcUnits.forEach(function (unit) {
                var block = byLine.get(unit.sourceLine);
                if (
                    !block ||
                    unit.start !== block.leading ||
                    unit.end !== block.leading + block.body.length ||
                    block.text.slice(unit.start, unit.end) !== unit.text
                ) {
                    issues.push({ sourceLine: unit.sourceLine, reason: 'source-unit-mismatch' });
                    return;
                }
                var first = block.start + unit.start - block.leading,
                    last = block.start + unit.end - block.leading;
                if (options.dialogueScope === 'quoted-lead-v1') {
                    // 已知 NPC 行偶尔混入冒号引出的动作旁白。只收窄本句录音，不改阅读帧或原文。
                    const lead = /^[^「」\n]+[：:]\s*(?=「[^「」]+」$)/u.exec(unit.text);
                    if (lead) first += lead[0].length;
                }
                ranges.forEach(function (range) {
                    var from = Math.max(first, range.start),
                        to = Math.min(last, range.end);
                    if (from >= to) return;
                    var part = body.slice(from, to),
                        text = part.trim();
                    if (!text) return;
                    var start =
                            block.leading +
                            from -
                            block.start +
                            part.length -
                            part.trimStart().length,
                        end = start + text.length;
                    if (
                        block.text.slice(start, end) !== text ||
                        !boundary(block.text, start) ||
                        !boundary(block.text, end)
                    ) {
                        issues.push({
                            sourceLine: unit.sourceLine,
                            reason: 'source-unit-mismatch',
                        });
                        return;
                    }
                    if (Array.from(text).length > 240)
                        issues.push({ sourceLine: unit.sourceLine, reason: 'clip-too-long' });
                    candidates.push({
                        id: 'b' + unit.sourceLine + ':' + start + '-' + end,
                        blockId: unit.blockId,
                        sourceLine: unit.sourceLine,
                        start: start,
                        end: end,
                        text: text,
                        speakerId: unit.speakerId,
                        kind: 'speech',
                        emotion: unit.emotion,
                        readingIndex: range.index,
                    });
                });
            });
        var length = candidates.reduce(function (sum, unit) {
            return sum + Array.from(unit.text).length;
        }, 0);
        if (length > maxChars) issues.push({ reason: 'max-chars' });
        if (candidates.length > maxClips) issues.push({ reason: 'max-clips' });
        var units = issues.length ? [] : candidates;
        var planHash = await speechPlan.hash(
            JSON.stringify(
                units.map(function (u) {
                    return [u.id, u.text, u.speakerId, u.kind, u.sourceLine, u.start, u.end];
                }),
            ),
        );
        return {
            version: 'round-v1',
            rawSource: rawSource,
            source: parsed.source,
            ...(options.dialogueScope ? { dialogueScope: options.dialogueScope } : {}),
            ...(omitted.size ? {omittedVoices:[...omitted]} : {}),
            sourceHash: parsed.sourceHash,
            units: units,
            issues: issues,
            planHash: planHash,
        };
    }
    return { instruction: instruction, compile: compile };
})();
