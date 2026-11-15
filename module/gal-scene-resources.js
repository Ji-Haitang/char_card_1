/** Pure resource selection for a captured reading world. No storage, random or settlement. */
var galSceneResources = (function () {
    'use strict';
    function asset(path, context) { return context.assetUrl ? context.assetUrl(path) : path; }
    function isSectLocation(name, locations) {
        return !!name && name !== 'none' && name !== '天山派' && Object.keys(locations || {}).some(function (id) {
            return id !== 'none' && id !== 'tianshanpai' && locations[id] === name;
        });
    }
    function daytimeFor(frame, context) {
        function clock(value) { var m = typeof value === 'string' && /^(\d{1,2})[:：](\d{2})$/.exec(value.trim()); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] : null; }
        var hour = clock(frame.time);
        // Explicit position works on cloned frames too; never use indexOf against the live game's list.
        if (hour === null && Array.isArray(context.frames) && Number.isInteger(context.frameIndex)) {
            for (var i = context.frameIndex - 1; i >= 0 && hour === null; i--) hour = clock(context.frames[i] && context.frames[i].time);
        }
        return hour === null ? context.dayNightStatus !== 'night' : hour >= 6 && hour < 18;
    }
    function sceneFor(frame, context) {
        context = context || {}; frame = frame || {};
        var daytime = daytimeFor(frame, context), time = daytime ? '昼' : '夜', name = frame.scene;
        var season = {spring:'春', summer:'夏', autumn:'秋', winter:'冬'}[context.seasonStatus] || '冬';
        var background = '', label = '';
        if (context.mode === 0) {
            var known = isSectLocation(name, context.locationNames); label = known ? name : '天山派';
            background = context.skin === 'pixel' ? 'img/location/3D.ver/' + label + '-' + season + '-' + time + '.webp'
                : known ? 'img/location/' + name + '_' + time + '.webp' : 'img/location/天山派_' + season + '_' + time + '.webp';
        } else {
            label = context.mapLocation || '';
            if (name && name !== 'none') background = (context.legacySceneOptions || []).includes(name)
                ? 'img/location/' + name + '_' + time + '.webp'
                : 'img/location/scene_webp/' + (context.mapLocation || '天山派外堡') + '/' + time + '/' + name + '.webp';
        }
        return {background:background ? asset(background, context) : '', sceneLabel:label, daytime:daytime};
    }
    function portraitCandidates(actor, context) {
        context = context || {};
        var mood = actor.emotion && actor.emotion !== 'none' ? actor.emotion : '平静';
        var prefix = context.skin === 'pixel' ? 'img/表情差分和CG/像素/' + actor.npc + '/' : 'img/表情差分和CG/' + actor.npc + '/表情差分/';
        var urls = [asset(prefix + mood + '.webp', context)];
        if (context.basePortrait) urls.push(asset(context.basePortrait, context));
        return Array.from(new Set(urls));
    }
    function cgFor(frame, cast, context) {
        context = context || {};
        var focus = cast.find(function (a) { return a.id === frame.cgOwnerId; }) || cast[0];
        if (!context.cgEnabled || !frame.cg || frame.cg === 'none' || !focus) return null;
        var variant = context.cgVariant === undefined ? 1 : context.cgVariant;
        return {key:focus.id + ':' + frame.cg + ':' + variant, url:asset('img/表情差分和CG/' + focus.npc + '/色图/' + frame.cg + variant + '.webp', context)};
    }
    return Object.freeze({isSectLocation:isSectLocation, sceneFor:sceneFor, portraitCandidates:portraitCandidates, cgFor:cgFor});
})();
