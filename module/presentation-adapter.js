/** Reading-only projection over the upstream parser; never replaces GalParser or its controller. */
var presentationFrames = (function () {
    'use strict';
    function assignStableSlots(frames) {
        var seats = new Map(), scene = null;
        return frames.map(function (frame) {
            if (frame.scene !== scene) { seats = new Map(); scene = frame.scene; }
            var cast = (frame.cast || []).slice(0, 2), count = seats.size;
            var keys = new Set(cast.map(function (a) { return a.id || a.npc; }));
            Array.from(seats.keys()).forEach(function (k) { if (!keys.has(k)) seats.delete(k); });
            var slots = cast.length === 1 ? [50] : [30, 70];
            if (!seats.size || count !== cast.length) {
                var ordered = cast.slice().sort(function (a, b) { return (seats.get(a.id || a.npc) ?? 100) - (seats.get(b.id || b.npc) ?? 100); });
                seats = new Map(); ordered.forEach(function (a, i) { seats.set(a.id || a.npc, slots[i]); });
            } else cast.forEach(function (a) {
                var key = a.id || a.npc;
                if (!seats.has(key)) seats.set(key, slots.find(function (x) { return !Array.from(seats.values()).includes(x); }));
            });
            return Object.assign({}, frame, { cast:cast.map(function (a) { return Object.assign({}, a, { anchor:seats.get(a.id || a.npc) }); }) });
        });
    }
    function parseFrames(text, context) {
        var ctx = context || buildGalParseContext(GameMode);
        var roster = ctx.roster || Object.keys(npcs).map(function (id) { return {id:id, name:npcs[id].name}; });
        return assignStableSlots(GalParser.parseFrames(text, ctx).map(function (frame) {
            var cast = (frame.cast || []).map(function (a) {
                var record = roster.find(function (r) { return r.name === a.npc; });
                return record ? {id:record.id, npc:record.name, kind:'npc', emotion:a.emotion || 'none'} : null;
            }).filter(Boolean).slice(0, 2);
            // Upstream merges rejected/plain lines. There is no reliable one-line source offset to guess.
            return Object.assign({}, frame, {cast:cast, cgOwnerId:cast.length ? cast[0].id : null, sourceLine:null});
        }));
    }
    return Object.freeze({parseFrames:parseFrames, assignStableSlots:assignStableSlots});
})();

/** Owns only a temporary pause of the existing GAL display, not business mode or settlement. */
var presentationAdapter = (function () {
    'use strict';
    var lease = null;
    function bridge() { return typeof window !== 'undefined' && window.GameSceneBridge; }
    function blocksOriginal() { return !!lease; }
    function claim() {
        if (lease) throw new Error('原演出显示已被接管');
        var op = {};
        lease = op;
        try {
            // exit is GM0-only upstream. clearLayers also invalidates GM1's queued slgSession.
            galPresentation.exit({curtain:false, reason:'stage-reading'}); // no-curtain exit clears synchronously
            galPresentation.clearLayers(document.getElementById('main-viewport'));
            return op;
        } catch (error) { if (lease === op) lease = null; throw error; }
    }
    function release(op) { if (lease === op) lease = null; }
    function restoreCurrent() {
        if (lease || mediaContext.isBusy()) return false;
        if (GameMode === 1) updateStoryDisplay();
        // afterCommit may have shown a choice while the saved original page was not the last page.
        // Re-present through its original UI hook after restoring GAL; do not apply/select the choice.
        if (mediaContext.pendingChoice() && typeof displaySideQuestChoice === 'function') {
            var active = sideQuestService.getActive(), pending = active && active.pendingInteraction;
            var node = pending && active.nodes && active.nodes[pending.nodeId];
            if (node) displaySideQuestChoice(node);
        }
        return true;
    }
    function pixelMode(mode) {
        if (mode !== 0) return false;
        try { var b = bridge(), d = b && b.getDiagnostics(); return !!(d && d.preferences && d.preferences.enabled && d.snapshot && d.snapshot.visible); }
        catch (_) { return false; }
    }
    return Object.freeze({claim,release,blocksOriginal,restoreCurrent,pixelMode});
})();
