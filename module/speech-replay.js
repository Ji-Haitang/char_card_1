/** Resolve only an already-cached M2a first target-NPC line. No settings or synthesis path. */
var speechReplay = (function () {
    'use strict';
    function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
    function nonempty(value) { return typeof value === 'string' && !!value.trim(); }
    function audioSize(blob) {
        // Native accessors check the Blob brand across realms; a duck-typed object is not audio.
        try {
            var size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(blob);
            var type = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get.call(blob);
            return type === 'audio/mpeg' && size > 0 && size <= 16 * 1024 * 1024 ? size : 0;
        } catch (_) { return 0; }
    }
    async function resolve(options) {
        if (!object(options) || !nonempty(options.workspaceId)) return null;
        var workspaceId = options.workspaceId, record, characters, saved, plan, unit, planHash;
        try {
            record = structuredClone(options.record); characters = structuredClone(options.characters);
            if (!object(record) || record.role !== 'assistant' || !nonempty(record.id) || typeof record.content !== 'string' ||
                !Array.isArray(characters) || !characters.every(function(c){return object(c) && nonempty(c.id) && nonempty(c.name);})) return null;
            saved = record.singleSpeech;
            if (!object(saved) || saved.version !== 'inline-v1' || !['stop', 'STOP', 'end_turn', 'tool_calls'].includes(saved.finishReason) ||
                typeof saved.rawSource !== 'string' || !nonempty(saved.sourceHash) || !Array.isArray(saved.issues) || saved.issues.length ||
                saved.targetNpcId === 'USER' || !characters.some(function(c){return c.id === saved.targetNpcId;})) return null;
            plan = await speechPlan.fromMainText(saved.rawSource, characters, { finishReason:saved.finishReason });
            if (plan.issues.length || saved.sourceHash !== plan.sourceHash || plan.source !== speechPlan.documentFor(record.content).source) return null;
            unit = plan.units.find(function(u){return u.kind === 'speech' && u.speakerId === saved.targetNpcId;});
            if (!unit || !unit.text || Array.from(unit.text).length > 240) return null;
            planHash = await speechPlan.hash(JSON.stringify([[unit.id, unit.text, unit.speakerId, unit.kind, unit.sourceLine, unit.start, unit.end]]));
        } catch (_) { return null; } // Malformed historical input is not an invitation to repair or generate it.

        if(saved.renderVersion!==undefined&&saved.renderVersion!=='drama3-v1')return null;
        var turnId = (saved.renderVersion==='drama3-v1'?'d3-m2a:':'m2a:') + record.id, unitId = unit.id + '/0', turnKey = JSON.stringify([workspaceId, turnId]);
        var turn = await speechStore.getTurn(workspaceId, turnId);
        if (!object(turn) || turn.id !== turnKey || turn.workspaceId !== workspaceId || turn.turnId !== turnId ||
            turn.sourceHash !== plan.sourceHash || turn.planHash !== planHash || !Array.isArray(turn.units) || turn.units.length !== 1) return null;
        if(saved.renderVersion==='drama3-v1'&&(turn.renderVersion!=='drama3-v1'||turn.renderHash!==await speechPlan.renderHash([unit])))return null;
        if(!saved.renderVersion&&turn.renderVersion!==undefined)return null;
        var chunk = turn.units[0];
        if (!object(chunk) || chunk.id !== unitId || ['text', 'speakerId', 'sourceLine', 'start', 'end'].some(function(k){return chunk[k] !== unit[k];})) return null;
        var clip = await speechStore.getClip(workspaceId, turnId, unitId);
        if (!object(clip) || clip.id !== JSON.stringify([workspaceId, turnId, unitId]) || clip.turnKey !== turnKey ||
            clip.unitId !== unitId || clip.speakerId !== unit.speakerId || !nonempty(clip.cacheKey)) return null;
        var size = audioSize(clip.blob);
        if (!size || clip.bytes !== size) return null;
        return { workspaceId:workspaceId, messageId:record.id, turnId:turnId, unitId:unitId,
            source:plan.source, unit:structuredClone(unit), clip:structuredClone(clip) };
    }
    return { resolve:resolve };
})();
