/** 单音轨播放器：停止立即生效；晚到Blob/play Promise不能抢回舞台。无自动翻页。 */
var speechPlayer = (function () {
    'use strict';
    function create(options) {
        options = options || {};
        var generation = 0,
            current = null,
            state = { phase: 'idle' },
            listeners = new Set();
        function setState(value) {
            state = value;
            listeners.forEach(function (listener) {
                try {
                    listener(Object.assign({}, state));
                } catch (_) {}
            });
        }
        var makeAudio =
            options.makeAudio ||
            function () {
                return new Audio();
            };
        var makeURL =
            options.makeURL ||
            function (blob) {
                return URL.createObjectURL(blob);
            };
        var revokeURL =
            options.revokeURL ||
            function (url) {
                URL.revokeObjectURL(url);
            };
        function release(entry) {
            if (!entry) return;
            entry.audio.onended = entry.audio.onerror = null;
            entry.audio.pause();
            entry.audio.removeAttribute('src');
            entry.audio.load();
            revokeURL(entry.url);
        }
        function stop() {
            generation++;
            release(current);
            current = null;
            setState({ phase: 'idle' });
        }
        async function play(blobOrLoader, identity, options) {
            options = options || {};
            stop();
            var ticket = generation;
            var owner = Object.assign({}, identity || {});
            setState(Object.assign({ phase: 'loading' }, owner));
            try {
                var blob = await (typeof blobOrLoader === 'function'
                    ? blobOrLoader()
                    : blobOrLoader);
                if (ticket !== generation) return false;
                if (!(blob instanceof Blob) || !blob.size) throw new Error('本机没有可播放的语音');
                var audio = makeAudio(),
                    entry = { audio: audio, url: makeURL(blob) };
                current = entry;
                audio.src = entry.url;
                audio.onended = function () {
                    if (ticket === generation) {
                        stop();
                        if (generation === ticket + 1 && typeof options.onEnded === 'function')
                            options.onEnded();
                    }
                };
                audio.onerror = function () {
                    if (ticket !== generation) return;
                    stop();
                    setState(Object.assign({ phase: 'error', message: '语音文件无法播放' }, owner));
                };
                await audio.play();
                if (ticket !== generation) return false;
                setState(Object.assign({ phase: 'playing' }, owner));
                return true;
            } catch (error) {
                if (ticket !== generation) return false;
                stop();
                setState(
                    Object.assign(
                        {
                            phase: 'error',
                            message:
                                error.name === 'NotAllowedError'
                                    ? '请点击台词启用声音'
                                    : error.message,
                        },
                        owner,
                    ),
                );
                throw error;
            }
        }
        return {
            play: play,
            stop: stop,
            getState: function () {
                return Object.assign({}, state);
            },
            subscribe: function (listener) {
                if (typeof listener !== 'function') throw new Error('播放状态监听无效');
                listeners.add(listener);
                return function () {
                    listeners.delete(listener);
                };
            },
        };
    }
    var player = create();
    player.create = create;
    if (typeof window !== 'undefined') window.addEventListener('pagehide', player.stop);
    if (typeof document !== 'undefined')
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) player.stop();
        });
    return player;
})();

/** Resolve only an already-cached M2a first target-NPC line. No settings or synthesis path. */
var speechReplay = (function () {
    'use strict';
    function object(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }
    function nonempty(value) {
        return typeof value === 'string' && !!value.trim();
    }
    function audioSize(blob) {
        // Native accessors check the Blob brand across realms; a duck-typed object is not audio.
        try {
            var size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(blob);
            var type = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get.call(blob);
            return type === 'audio/mpeg' && size > 0 && size <= 16 * 1024 * 1024 ? size : 0;
        } catch (_) {
            return 0;
        }
    }
    function singleTurnId(messageId, model = 'drama-3') {
        // 旧 D3 录音沿用原键。另一模型在独立位置保存，不会顶掉已付费的录音。
        if (model === 'drama-3') return 'd3-m2a:' + messageId;
        if (model === 's2.1-pro') return 's2-m2a:' + messageId;
        throw new Error('不支持的单句配音模型');
    }

    async function resolve(options) {
        if (!object(options) || !nonempty(options.workspaceId)) return null;
        var workspaceId = options.workspaceId,
            record,
            characters,
            saved,
            plan,
            unit,
            planHash;
        try {
            record = structuredClone(options.record);
            characters = structuredClone(options.characters);
            if (
                !object(record) ||
                record.role !== 'assistant' ||
                !nonempty(record.id) ||
                typeof record.content !== 'string' ||
                !Array.isArray(characters) ||
                !characters.every(function (c) {
                    return object(c) && nonempty(c.id) && nonempty(c.name);
                })
            )
                return null;
            saved = record.singleSpeech;
            if (
                !object(saved) ||
                saved.version !== 'inline-v1' ||
                !['stop', 'STOP', 'end_turn', 'tool_calls'].includes(saved.finishReason) ||
                typeof saved.rawSource !== 'string' ||
                !nonempty(saved.sourceHash) ||
                !Array.isArray(saved.issues) ||
                saved.issues.length ||
                saved.targetNpcId === 'USER' ||
                !characters.some(function (c) {
                    return c.id === saved.targetNpcId;
                })
            )
                return null;
            plan = await speechPlan.fromMainText(saved.rawSource, characters, {
                finishReason: saved.finishReason,
            });
            if (
                plan.issues.length ||
                saved.sourceHash !== plan.sourceHash ||
                plan.source !== speechPlan.documentFor(record.content).source
            )
                return null;
            unit = plan.units.find(function (u) {
                return u.kind === 'speech' && u.speakerId === saved.targetNpcId;
            });
            if (!unit || !unit.text || Array.from(unit.text).length > 240) return null;
            planHash = await speechPlan.hash(
                JSON.stringify([
                    [
                        unit.id,
                        unit.text,
                        unit.speakerId,
                        unit.kind,
                        unit.sourceLine,
                        unit.start,
                        unit.end,
                    ],
                ]),
            );
        } catch (_) {
            return null;
        } // Malformed historical input is not an invitation to repair or generate it.

        if (saved.renderVersion !== 'drama3-v1') return null;
        // 试听面板指定模型；历史回听优先读原键，缺失时再查新版单句键。两条路径均只读缓存。
        const preferred = options.model ?? 'drama-3';
        let turnId = singleTurnId(record.id, preferred);
        let turn = await speechStore.getTurn(workspaceId, turnId);
        if (!turn && (options.model === undefined || preferred === 's2.1-pro')) {
            turnId = singleTurnId(record.id, preferred === 's2.1-pro' ? 'drama-3' : 's2.1-pro');
            turn = await speechStore.getTurn(workspaceId, turnId);
        }
        if (turn && options.model !== undefined && (turn.model ?? 'drama-3') !== preferred) return null;
        const unitId = unit.id + '/0';
        const turnKey = JSON.stringify([workspaceId, turnId]);
        if (
            !object(turn) ||
            turn.id !== turnKey ||
            turn.workspaceId !== workspaceId ||
            turn.turnId !== turnId ||
            turn.sourceHash !== plan.sourceHash ||
            turn.planHash !== planHash ||
            !Array.isArray(turn.units) ||
            turn.units.length !== 1
        )
            return null;
        if (
            turn.renderVersion !== 'drama3-v1' ||
            turn.renderHash !== (await speechPlan.renderHash([unit], turn.model))
        )
            return null;
        var chunk = turn.units[0];
        if (
            !object(chunk) ||
            chunk.id !== unitId ||
            ['text', 'speakerId', 'sourceLine', 'start', 'end'].some(function (k) {
                return chunk[k] !== unit[k];
            })
        )
            return null;
        var clip = await speechStore.getClip(workspaceId, turnId, unitId);
        if (
            !object(clip) ||
            clip.id !== JSON.stringify([workspaceId, turnId, unitId]) ||
            clip.turnKey !== turnKey ||
            clip.unitId !== unitId ||
            clip.speakerId !== unit.speakerId ||
            !nonempty(clip.cacheKey)
        )
            return null;
        var size = audioSize(clip.blob);
        if (!size || clip.bytes !== size) return null;
        return {
            workspaceId: workspaceId,
            messageId: record.id,
            turnId: turnId,
            unitId: unitId,
            source: plan.source,
            unit: structuredClone(unit),
            clip: structuredClone(clip),
        };
    }
    return { resolve, singleTurnId };
})();
