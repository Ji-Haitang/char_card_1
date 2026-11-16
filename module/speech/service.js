/** TTS底层编排：单提供商、串行台词、成功缓存复用；不提交剧情，不自动重试。 */
var speechService = (function () {
    'use strict';
    var active = null,
        generation = 0,
        unsaved = null;
    function owner() {
        return mediaContext.workspaceId();
    }
    function getConfig(workspaceId) {
        return speechConfig.get(workspaceId || owner());
    }
    function saveConfig(value, workspaceId) {
        return speechConfig.save(value, workspaceId || owner());
    }
    function renderHash(units) {
        return speechPlan.renderHash(units);
    }
    function stop() {
        generation++;
        unsaved = null;
        if (active) active.controller.abort();
        if (typeof speechPlayer !== 'undefined') speechPlayer.stop();
    }
    async function validateAudio(blob) {
        var audio = new Audio(),
            url = URL.createObjectURL(blob);
        try {
            await new Promise(function (resolve, reject) {
                var timer = setTimeout(function () {
                    finish(new Error('音频解码超时'));
                }, 10000);
                function finish(error) {
                    clearTimeout(timer);
                    audio.onloadedmetadata = audio.onerror = null;
                    if (error) reject(error);
                    else resolve();
                }
                audio.onloadedmetadata = function () {
                    finish();
                };
                audio.onerror = function () {
                    finish(new Error('返回的MP3不能解码，未标记为就绪'));
                };
                audio.preload = 'metadata';
                audio.src = url;
                audio.load();
            });
        } finally {
            audio.removeAttribute('src');
            audio.load();
            URL.revokeObjectURL(url);
        }
    }
    async function prepare(turn, plan, options) {
        options = options || {};
        var requestGeneration = generation,
            context = mediaContext.capture();
        turn = structuredClone(turn);
        plan = structuredClone(plan);
        var settings = structuredClone(options.settings || (await getConfig(turn.workspaceId)));
        if (!mediaContext.isCurrent(context))
            throw new DOMException('游戏上下文已变更', 'AbortError');
        if (turn.workspaceId !== owner()) throw new Error('语音正文不属于当前Workspace');
        if (!settings.enabled && !options.manual) return { disabled: true, clips: [] };
        options = Object.assign({}, options, { settings: settings, context: context });
        var locks = options.locks || (typeof navigator !== 'undefined' && navigator.locks);
        if (!locks) throw new Error('当前环境不支持跨页面语音锁，未发送付费请求');
        return locks.request(
            'jxz-speech:' + JSON.stringify([turn.workspaceId, turn.turnId]),
            { mode: 'exclusive', ifAvailable: true },
            function (lock) {
                if (
                    requestGeneration !== generation ||
                    !mediaContext.isCurrent(context) ||
                    options.signal?.aborted
                )
                    throw new DOMException('已取消语音准备', 'AbortError');
                if (!lock) throw new Error('另一页面正在准备此正文语音，请等待后重试');
                return prepareLocked(turn, plan, options);
            },
        );
    }
    async function prepareLocked(turn, plan, options) {
        options = options || {};
        if (active) throw new Error('上一轮语音仍在处理');
        turn = structuredClone(turn);
        plan = structuredClone(plan);
        if (turn.workspaceId !== owner()) throw new Error('语音正文不属于当前Workspace');
        if (
            typeof turn.turnId !== 'string' ||
            !turn.turnId ||
            typeof turn.sourceHash !== 'string' ||
            !turn.sourceHash ||
            !Number.isFinite(turn.createdAt)
        )
            throw new Error('正文缺少稳定ID、来源或创建时间，未发送合成请求');
        var controller = new AbortController(),
            job = { controller: controller },
            ticket = ++generation;
        active = job;
        function check() {
            if (
                ticket !== generation ||
                !mediaContext.isCurrent(options.context) ||
                controller.signal.aborted ||
                turn.workspaceId !== owner()
            )
                throw new DOMException('已停止本轮语音', 'AbortError');
        }
        function abort() {
            controller.abort();
        }
        if (options.signal) {
            if (options.signal.aborted) abort();
            else options.signal.addEventListener('abort', abort, { once: true });
        }
        try {
            var settings = options.settings;
            check();
            if (!plan.sourceHash || plan.sourceHash !== turn.sourceHash)
                throw new Error('台词编排不属于这份正文，未发送合成请求');
            turn.planHash = await speechPlan.hash(
                JSON.stringify(
                    plan.units.map(function (u) {
                        return [u.id, u.text, u.speakerId, u.kind, u.sourceLine, u.start, u.end];
                    }),
                ),
            );
            check();
            if (speechPlan.requiresDecision(plan, settings.voices))
                throw new Error('部分对白归属尚未确认，请核对标记或选择无声继续');
            var units = [];
            speechPlan.speakable(plan, settings.voices).forEach(function (u) {
                var offset = 0;
                speechPlan.splitText(u.text, 240).forEach(function (text, part) {
                    units.push(
                        Object.assign({}, u, {
                            id: u.id + '/' + part,
                            text: text,
                            start: u.start + offset,
                            end: u.start + offset + text.length,
                        }),
                    );
                    offset += text.length;
                });
            });
            if (!units.length) return { disabled: false, clips: [] };
            var provider = speechDrama3.normalizeConfig(settings.provider);
            var route = options.fetch
                ? {
                      endpoint: speechDrama3.endpoint,
                      fetch: options.fetch,
                      checkVoice: function () {},
                  }
                : speechTransport.capture();
            var endpoint = route.endpoint,
                transport = route.fetch;
            // Validate the entire plan before any paid POST, including references and direction text.
            var resolved = new Map(),
                identities = new Map();
            for (var pending of units) {
                speechDrama3.composeText(pending.text, pending.emotion || '');
                if (!resolved.has(pending.speakerId)) {
                    var resolvedVoice = await speechConfig.resolveVoice(
                        settings.voices[pending.speakerId],
                        turn.workspaceId,
                    );
                    check();
                    route.checkVoice(resolvedVoice);
                    identities.set(
                        pending.speakerId,
                        await speechDrama3.voiceIdentity(resolvedVoice),
                    );
                    check();
                    resolved.set(pending.speakerId, resolvedVoice);
                }
            }
            turn.renderVersion = 'drama3-v1';
            turn.renderHash = await renderHash(plan.units);
            check();
            var existing = await speechStore.listTurns(turn.workspaceId);
            check();
            var prior = existing.find(function (t) {
                return t.turnId === turn.turnId;
            });
            if (prior && prior.sourceHash !== turn.sourceHash)
                throw new Error('正文版本已变化，不能复用旧语音身份');
            if (prior && prior.planHash !== turn.planHash)
                throw new Error('此正文已有不同的台词编排；请使用新的版本ID，未发送合成请求');
            if (
                prior &&
                (prior.renderVersion !== turn.renderVersion || prior.renderHash !== turn.renderHash)
            )
                throw new Error(
                    '音频身份与当前版本或表现描述不一致；原缓存保留，请使用新的录音身份',
                );
            if (
                !existing.some(function (t) {
                    return t.turnId === turn.turnId;
                }) &&
                existing.length >= speechStore.limit &&
                turn.createdAt <= existing[existing.length - 1].createdAt
            )
                throw new Error('此正文已在最近10轮语音保留范围之外，未发送合成请求');
            var account = await speechPlan.hash(
                JSON.stringify([speechDrama3.provider, endpoint, provider.apiKey]),
            );
            turn.units = units;
            var result = [];
            for (var unit of units) {
                check();
                var voice = settings.voices[unit.speakerId];
                var spoken = speechDrama3.composeText(unit.text, unit.emotion || '');
                var cacheKey = await speechPlan.hash(
                    JSON.stringify([
                        speechDrama3.provider,
                        speechDrama3.model,
                        account,
                        identities.get(unit.speakerId),
                        voice.version,
                        spoken,
                        provider.speed,
                        'mp3',
                        44100,
                    ]),
                );
                check();
                var cached = await speechStore.getClip(turn.workspaceId, turn.turnId, unit.id);
                check();
                if (!cached || cached.cacheKey !== cacheKey) {
                    var pendingKey = JSON.stringify([
                        turn.workspaceId,
                        turn.turnId,
                        unit.id,
                        cacheKey,
                    ]);
                    if (!unsaved || unsaved.key !== pendingKey) {
                        var audio = await speechDrama3.synthesize(
                            settings.provider,
                            {
                                text: unit.text,
                                direction: unit.emotion || '',
                                voice: resolved.get(unit.speakerId),
                            },
                            { signal: controller.signal, fetch: transport },
                        );
                        check();
                        await (options.validateAudio || validateAudio)(audio.blob);
                        check();
                        unsaved = { key: pendingKey, audio: audio };
                    }
                    var saved = await speechStore.putClip(turn, {
                        unitId: unit.id,
                        cacheKey: cacheKey,
                        speakerId: unit.speakerId,
                        blob: unsaved.audio.blob,
                    });
                    check();
                    if (!saved.retained) throw new Error('本轮已超出语音保留范围，未发布声音');
                    unsaved = null;
                }
                result.push({ unitId: unit.id, speakerId: unit.speakerId });
                if (options.onProgress) options.onProgress(result.length, units.length);
            }
            return { disabled: false, clips: result };
        } finally {
            if (options.signal) options.signal.removeEventListener('abort', abort);
            if (active === job) active = null;
        }
    }
    async function play(workspaceId, turnId, unitId) {
        var context = mediaContext.capture();
        if (workspaceId !== owner()) throw new Error('不能播放其他Workspace的语音');
        return speechPlayer.play(
            async function () {
                var clip = await speechStore.getClip(workspaceId, turnId, unitId);
                if (workspaceId !== owner() || !mediaContext.isCurrent(context))
                    throw new DOMException('游戏上下文已变更', 'AbortError');
                if (!clip) throw new Error('本机无此语音，可能已超出最近10轮；不会自动重新生成');
                return clip.blob;
            },
            { workspaceId: workspaceId, turnId: turnId, unitId: unitId },
        );
    }
    // The game-facing entry: storage/provider objects stay within the speech feature.
    return {
        getConfig: getConfig,
        saveConfig: saveConfig,
        prepare: prepare,
        play: play,
        stop: stop,
        isBusy: function () {
            return !!active;
        },
        workspaceId: owner,
        validateAudio: validateAudio,
        renderHash: renderHash,
        hash: speechPlan.hash,
        beginTurn: speechTurn.begin,
        finishTurn: speechTurn.finish,
        resumeTurn: speechTurn.resume,
        releaseTurn: speechTurn.release,
        setTurnCompletion: speechTurn.setCompletion,
        turnInstruction: speechTurn.instruction,
        hasActiveTurn: speechTurn.active,
        cancelTurn: speechTurn.cancel,
        guardProgress: speechTurn.guardProgress,
        progressReason: speechTurn.progressReason,
        loadPending: speechRound.load,
        withRoundLease: speechRound.withLease,
    };
})();
