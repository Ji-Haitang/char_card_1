/** M3 local round draft and cache identity. One pending round per Workspace; never settles gameplay. */
var speechRound = (function () {
    'use strict';
    var MAX_CHARS = 3000,
        MAX_CLIPS = 24,
        leaseContext = null;
    // Synchronous user-entry gate. Existing isBusy keeps its actual in-flight meaning.
    var pendingCache = { ready: false, pending: false, id: null, phase: null },
        cacheRevision = 0;
    function rememberPending(draft, revision) {
        if (revision !== undefined && revision !== cacheRevision) return;
        cacheRevision++;
        pendingCache = {
            ready: true,
            pending: !!pending(draft),
            id: draft ? draft.id : null,
            phase: draft ? draft.phase : null,
        };
    }
    function pendingState() {
        return Object.assign({}, pendingCache);
    }
    function owner() {
        return mediaContext.workspaceId();
    }
    function characters() {
        return Object.keys(npcs)
            .filter(function (id) {
                return id !== 'USER';
            })
            .map(function (id) {
                return { id: id, name: npcs[id].name };
            });
    }
    function sorted(value) {
        if (Array.isArray(value)) return value.map(sorted);
        if (value && typeof value === 'object') {
            var out = {};
            Object.keys(value)
                .sort()
                .forEach(function (k) {
                    Object.defineProperty(out, k, { value: sorted(value[k]), enumerable: true });
                });
            return out;
        }
        return value;
    }
    function check(workspaceId, signal) {
        if (
            workspaceId !== owner() ||
            (signal && signal.aborted) ||
            (leaseContext && !mediaContext.isCurrent(leaseContext))
        )
            throw new DOMException('整轮准备已取消或工作区已切换', 'AbortError');
    }
    function key(workspaceId) {
        return 'round-draft:' + workspaceId;
    }
    async function preferences(workspaceId) {
        var v = await speechStore.getSetting('round-speech:' + (workspaceId || owner()));
        return {
            enabled: !!(v && v.enabled === true && v.provider === 'fish-drama3'),
            maxChars: MAX_CHARS,
            maxClips: MAX_CLIPS,
        };
    }
    async function savePreferences(value, workspaceId) {
        workspaceId = workspaceId || owner();
        check(workspaceId);
        if (value.enabled === true) await settings(workspaceId);
        check(workspaceId);
        await speechStore.setSetting('round-speech:' + workspaceId, {
            version: 2,
            provider: 'fish-drama3',
            enabled: value.enabled === true,
        });
        return preferences(workspaceId);
    }
    async function settings(workspaceId) {
        var config = structuredClone(await speechService.getConfig(workspaceId));
        check(workspaceId);
        speechDrama3.normalizeConfig(config.provider);
        var endpoint = speechTransport.endpoint();
        if (
            !characters().some(function (c) {
                return (
                    config.voices[c.id] &&
                    config.voices[c.id].kind === 'fish-drama3' &&
                    typeof config.voices[c.id].speakerId === 'string' &&
                    config.voices[c.id].speakerId.trim()
                );
            })
        )
            throw new Error('请先保存至少一个NPC声线绑定');
        var fingerprint = await speechPlan.hash(
            JSON.stringify(
                sorted({ provider: config.provider, voices: config.voices, endpoint: endpoint }),
            ),
        );
        check(workspaceId);
        config.enabled = true;
        return { settings: config, fingerprint: fingerprint };
    }
    async function context(workspaceId) {
        var prefs;
        try {
            prefs = await preferences(workspaceId);
        } catch (_) {
            check(workspaceId);
            return null;
        }
        check(workspaceId);
        if (!prefs.enabled) return null;
        var captured = await settings(workspaceId);
        return {
            version: 'round-v1',
            workspaceId: workspaceId,
            settingsFingerprint: captured.fingerprint,
            maxChars: MAX_CHARS,
            maxClips: MAX_CLIPS,
            finishReason: null,
        };
    }
    async function withLease(workspaceId, operation) {
        check(workspaceId);
        if (!navigator.locks) throw new Error('当前环境不支持整轮语音锁，请先关闭整轮朗读');
        return navigator.locks.request(
            'jxz-round:' + workspaceId,
            { mode: 'exclusive', ifAvailable: true },
            async function (lock) {
                if (!lock) throw new Error('另一个页面正在处理本轮声音');
                check(workspaceId);
                var context = mediaContext.capture();
                leaseContext = context;
                try {
                    return await operation();
                } finally {
                    if (leaseContext === context) leaseContext = null;
                }
            },
        );
    }
    async function load(workspaceId) {
        workspaceId = workspaceId || owner();
        var revision = workspaceId === owner() ? ++cacheRevision : null;
        try {
            var draft = await speechStore.getSetting(key(workspaceId));
            if (
                draft &&
                (draft.schema !== 1 ||
                    draft.renderVersion !== 'drama3-v1' ||
                    draft.workspaceId !== workspaceId ||
                    typeof draft.id !== 'string' ||
                    ![
                        'draft',
                        'preparing',
                        'paused',
                        'ready',
                        'committing',
                        'published',
                        'discarded',
                    ].includes(draft.phase))
            )
                throw new Error('本机整轮待办结构不兼容，未覆盖旧数据');
            if (revision !== null) rememberPending(draft, revision);
            return draft ? structuredClone(draft) : null;
        } catch (error) {
            // Unavailable optional storage must not disable an otherwise default-off text game.
            // A previously observed pending draft remains blocked until a successful read/write resolves it.
            if (revision !== null && revision === cacheRevision) {
                cacheRevision++;
                pendingCache = Object.assign({}, pendingCache, { ready: true });
            }
            throw error;
        }
    }
    function pending(draft) {
        return draft && !['published', 'discarded'].includes(draft.phase);
    }
    async function assertNoPending(workspaceId) {
        var old = await load(workspaceId);
        check(workspaceId);
        if (pending(old))
            throw new Error('此工作区还有整轮语音待办，请先在语音配置中继续、无声发布或放弃');
    }
    // Caller holds the round lease. No key/provider object is persisted with the story draft.
    async function create(input, ctx, signal) {
        input = structuredClone(input);
        ctx = structuredClone(ctx);
        check(ctx.workspaceId, signal);
        await assertNoPending(ctx.workspaceId);
        var baseline = await mediaContext.publicationFingerprint();
        check(ctx.workspaceId, signal);
        var draft = {
            schema: 1,
            renderVersion: 'drama3-v1',
            id: 'sr_' + crypto.randomUUID().replace(/-/g, ''),
            workspaceId: ctx.workspaceId,
            createdAt: Date.now(),
            phase: 'draft',
            baseFingerprint: baseline,
            settingsFingerprint: ctx.settingsFingerprint,
            finishReason: ctx.finishReason,
            maxChars: MAX_CHARS,
            maxClips: MAX_CLIPS,
            input: {
                preprocessed: input.preprocessed,
                rawText: input.rawText,
                rawSource: input.rawSource,
                mainText: input.mainText,
                isRegenerate: !!input.isRegenerate,
                summarySource: input.summarySource || null,
            },
            readingPlan: input.readingPlan,
            plan: input.plan,
            silent: false,
            error: '',
        };
        draft.payloadHash = await speechPlan.hash(
            JSON.stringify({ input: draft.input, readingPlan: draft.readingPlan }),
        );
        check(ctx.workspaceId, signal);
        await speechStore.setSetting(key(draft.workspaceId), draft);
        if (draft.workspaceId === owner()) rememberPending(draft);
        check(ctx.workspaceId, signal);
        return draft;
    }
    async function update(draft, patch) {
        var current = await load(draft.workspaceId);
        if (!current || current.id !== draft.id) throw new Error('整轮待办已失效，未覆盖新待办');
        if (['published', 'discarded'].includes(current.phase)) {
            if (Object.keys(patch).length !== 1 || patch.phase !== current.phase)
                throw new Error('整轮待办已结束');
            return current;
        }
        var fields = ['phase', 'silent', 'error', 'settingsFingerprint', 'plan'];
        if (
            !patch ||
            typeof patch !== 'object' ||
            Array.isArray(patch) ||
            Object.keys(patch).some(function (k) {
                return !fields.includes(k);
            }) ||
            (patch.phase !== undefined &&
                ![
                    'draft',
                    'preparing',
                    'paused',
                    'ready',
                    'committing',
                    'published',
                    'discarded',
                ].includes(patch.phase))
        )
            throw new Error('整轮待办更新字段无效');
        var next = Object.assign({}, current, structuredClone(patch), { updatedAt: Date.now() });
        await speechStore.setSetting(key(draft.workspaceId), next);
        if (draft.workspaceId === owner()) rememberPending(next);
        return next;
    }
    async function assertCurrent(draft, signal) {
        check(draft.workspaceId, signal);
        var current = await load(draft.workspaceId);
        check(draft.workspaceId, signal);
        if (
            !current ||
            current.id !== draft.id ||
            !pending(current) ||
            current.phase === 'committing'
        )
            throw new Error('此待办已结束或上次提交状态待核对，不能重复结算');
        var payloadHash = await speechPlan.hash(
            JSON.stringify({ input: draft.input, readingPlan: draft.readingPlan }),
        );
        check(draft.workspaceId, signal);
        if (payloadHash !== draft.payloadHash)
            throw new Error('整轮待办内容已损坏，未提交游戏状态');
        var baseline = await mediaContext.publicationFingerprint();
        check(draft.workspaceId, signal);
        if (baseline !== draft.baseFingerprint)
            throw new Error('游戏进度已变化，不能将旧配音待办发布到当前状态');
    }
    async function prepare(draft, options) {
        options = options || {};
        await assertCurrent(draft, options.signal);
        if (draft.renderVersion !== 'drama3-v1')
            throw new Error('语音待办版本不受支持，原记录保持不变');
        var captured = await settings(draft.workspaceId);
        check(draft.workspaceId, options.signal);
        if (captured.fingerprint !== draft.settingsFingerprint) {
            if (options.adoptSettings !== captured.fingerprint)
                throw new Error('连接或声线已经改变，请暂停后从待办入口确认使用当前配置');
            draft = await update(draft, { settingsFingerprint: captured.fingerprint });
            check(draft.workspaceId, options.signal);
        }
        var plan = await speechRoundPlan.compile(draft.input.rawSource, characters(), {
            finishReason: draft.finishReason,
            readingPlan: draft.readingPlan,
            voices: captured.settings.voices,
            maxChars: MAX_CHARS,
            maxClips: MAX_CLIPS,
        });
        check(draft.workspaceId, options.signal);
        if (plan.issues.length) {
            var reasons = {
                'completion-not-confirmed': '主回复结束标志不完整',
                'line-unmarked': '正文行缺少台词标记',
                'uncertain-speaker': '说话人归属不确定',
                'unbound-npc': 'NPC尚未绑定声线',
                'max-chars': '台词超过3000字上限',
                'max-clips': '语音超过24片段上限',
                'invalid-marker': '台词标记格式不合法',
                'invalid-segment': '台词片段不合法',
                'line-shape': '正文分隔格式不支持',
            };
            throw new Error(
                '本轮台词尚不能自动配音：' +
                    Array.from(
                        new Set(
                            plan.issues.map(function (i) {
                                return (
                                    (i.speakerId && npcs[i.speakerId]
                                        ? npcs[i.speakerId].name + '：'
                                        : '') +
                                    (reasons[i.reason] || '台词或阅读范围未通过校验') +
                                    '（' +
                                    i.reason +
                                    '）'
                                );
                            }),
                        ),
                    )
                        .slice(0, 4)
                        .join('；'),
            );
        }
        if (
            plan.source !== draft.input.mainText ||
            plan.sourceHash !== draft.plan.sourceHash ||
            plan.planHash !== draft.plan.planHash
        )
            throw new Error('待办编排与原文身份不一致，未准备声音');
        draft = await update(draft, { phase: 'preparing', error: '' });
        check(draft.workspaceId, options.signal);
        if (plan.units.length)
            await speechService.prepare(
                {
                    workspaceId: draft.workspaceId,
                    turnId: 'm3:' + draft.id,
                    sourceHash: plan.sourceHash,
                    createdAt: draft.createdAt,
                },
                plan,
                {
                    settings: captured.settings,
                    signal: options.signal,
                    onProgress: options.onProgress,
                },
            );
        check(draft.workspaceId, options.signal);
        return update(draft, { phase: 'ready', silent: !plan.units.length, plan: plan, error: '' });
    }
    function record(draft) {
        return {
            version: 'round-v1',
            draftId: draft.id,
            audioTurnId: 'm3:' + draft.id,
            rawSource: draft.input.rawSource,
            sourceHash: draft.plan.sourceHash,
            planHash: draft.plan.planHash,
            finishReason: draft.finishReason,
            status: draft.silent ? 'silent' : 'ready',
            renderVersion: 'drama3-v1',
        };
    }
    async function discard(id) {
        return withLease(owner(), async function () {
            var draft = await load();
            if (!draft || draft.id !== id) throw new Error('待办不存在');
            if (draft.phase === 'committing') throw new Error('提交状态待核对，不能自动放弃或重放');
            return update(draft, { phase: 'discarded' });
        });
    }
    async function replay(message, readingPlan, index) {
        var workspaceId = owner(),
            copy = structuredClone(message),
            saved = copy && copy.roundSpeech;
        if (
            !saved ||
            saved.version !== 'round-v1' ||
            saved.renderVersion !== 'drama3-v1' ||
            saved.status !== 'ready' ||
            saved.audioTurnId !== 'm3:' + saved.draftId
        )
            return null;
        var plan = await speechRoundPlan.compile(saved.rawSource, characters(), {
            finishReason: saved.finishReason,
            readingPlan: readingPlan,
            maxChars: MAX_CHARS,
            maxClips: MAX_CLIPS,
        });
        check(workspaceId);
        if (
            plan.issues.length ||
            plan.source !== copy.content ||
            plan.sourceHash !== saved.sourceHash ||
            plan.planHash !== saved.planHash
        )
            return null;
        var turn = await speechStore.getTurn(workspaceId, saved.audioTurnId);
        check(workspaceId);
        if (
            !turn ||
            turn.id !== JSON.stringify([workspaceId, saved.audioTurnId]) ||
            turn.workspaceId !== workspaceId ||
            turn.turnId !== saved.audioTurnId ||
            turn.sourceHash !== plan.sourceHash ||
            turn.planHash !== plan.planHash ||
            !Array.isArray(turn.units) ||
            turn.units.length !== plan.units.length
        )
            return null;
        if (
            turn.renderVersion !== 'drama3-v1' ||
            turn.renderHash !== (await speechPlan.renderHash(plan.units))
        )
            return null;
        check(workspaceId);
        if (
            plan.units.some(function (u, i) {
                var chunk = turn.units[i];
                return (
                    !chunk ||
                    chunk.id !== u.id + '/0' ||
                    ['text', 'speakerId', 'sourceLine', 'start', 'end'].some(function (k) {
                        return chunk[k] !== u[k];
                    })
                );
            })
        )
            return null;
        return {
            workspaceId: workspaceId,
            turnId: saved.audioTurnId,
            sourceHash: plan.sourceHash,
            planHash: plan.planHash,
            renderVersion: turn.renderVersion,
            renderHash: turn.renderHash,
            units: plan.units.filter(function (u) {
                return u.readingIndex === index;
            }),
        };
    }
    async function clip(binding, unit) {
        check(binding.workspaceId);
        if (
            !unit ||
            !Array.isArray(binding.units) ||
            !binding.units.some(function (u) {
                return [
                    'id',
                    'text',
                    'speakerId',
                    'sourceLine',
                    'start',
                    'end',
                    'readingIndex',
                ].every(function (k) {
                    return u[k] === unit[k];
                });
            })
        )
            throw new Error('台词不属于当前阅读短段');
        var turn = await speechStore.getTurn(binding.workspaceId, binding.turnId);
        check(binding.workspaceId);
        var id = unit.id + '/0',
            entry =
                turn &&
                Array.isArray(turn.units) &&
                turn.units.find(function (u) {
                    return u.id === id;
                });
        if (
            !turn ||
            turn.id !== JSON.stringify([binding.workspaceId, binding.turnId]) ||
            turn.workspaceId !== binding.workspaceId ||
            turn.turnId !== binding.turnId ||
            turn.sourceHash !== binding.sourceHash ||
            turn.planHash !== binding.planHash ||
            turn.renderVersion !== binding.renderVersion ||
            turn.renderHash !== binding.renderHash ||
            !entry ||
            ['text', 'speakerId', 'sourceLine', 'start', 'end'].some(function (k) {
                return entry[k] !== unit[k];
            })
        )
            throw new Error('本段声音已失效');
        var clip = await speechStore.getClip(binding.workspaceId, binding.turnId, id);
        check(binding.workspaceId);
        if (
            !clip ||
            clip.id !== JSON.stringify([binding.workspaceId, binding.turnId, id]) ||
            clip.turnKey !== JSON.stringify([binding.workspaceId, binding.turnId]) ||
            clip.unitId !== id ||
            clip.speakerId !== unit.speakerId ||
            typeof clip.cacheKey !== 'string' ||
            !clip.cacheKey.trim() ||
            !(clip.blob instanceof Blob) ||
            clip.blob.type !== 'audio/mpeg' ||
            !clip.blob.size ||
            clip.blob.size > 16 * 1024 * 1024 ||
            clip.bytes !== clip.blob.size
        )
            throw new Error('本段没有可播放的完整录音');
        return clip.blob;
    }
    return {
        preferences: preferences,
        savePreferences: savePreferences,
        context: context,
        settings: settings,
        characters: characters,
        withLease: withLease,
        load: load,
        pending: pending,
        pendingState: pendingState,
        assertNoPending: assertNoPending,
        create: create,
        update: update,
        assertCurrent: assertCurrent,
        prepare: prepare,
        record: record,
        discard: discard,
        replay: replay,
        clip: clip,
    };
})();

/** Game-facing speech coordination. The supplied commit callback owns all gameplay side effects. */
var speechTurn = (function () {
    'use strict';
    var active = null;
    var COMPLETE = ['stop', 'STOP', 'end_turn', 'tool_calls'];
    function assertContext(ctx) {
        if (!ctx || !mediaContext.isCurrent(ctx.context) || ctx.controller.signal.aborted)
            throw new DOMException('本轮语音准备已取消', 'AbortError');
    }
    function cancel() {
        if (active) active.controller.abort();
        speechService.stop();
    }
    function progressReason() {
        var state = speechRound.pendingState();
        if (!state.ready) return '正在读取本机声音待办，请稍后再行动；游戏设置仍可打开。';
        if (!state.pending) return '';
        return state.phase === 'committing'
            ? '声音待办的提交状态待核对，请先到游戏设置 → 语音配置检查已发布状态，暂不能开始新行动。'
            : '请先处理声音待办：在游戏设置 → 语音配置中继续准备、本轮无声继续或放弃待办，再进行新行动。';
    }
    function guardProgress() {
        var reason = progressReason();
        if (!reason) return true;
        if (typeof showModal === 'function') showModal(reason);
        return false;
    }
    async function begin() {
        var context = mediaContext.capture(),
            workspaceId = mediaContext.workspaceId();
        var pending;
        try {
            pending = await speechRound.load(workspaceId);
        } catch (_) {
            if (!mediaContext.isCurrent(context))
                throw new DOMException('游戏上下文已变更', 'AbortError');
            if (speechRound.pendingState().pending) throw new Error(progressReason());
            console.warn('[Speech] 本机语音状态暂不可读，本轮继续正文流程');
            return null;
        }
        if (speechRound.pending(pending))
            throw new Error('本机还有待发布的语音正文，请先在语音配置中处理');
        var round = await speechRound.context(workspaceId),
            single = null;
        if (!round)
            try {
                single = await speechStore.getSetting('single-test:' + workspaceId);
            } catch (_) {
                single = null;
            }
        if (!mediaContext.isCurrent(context))
            throw new DOMException('游戏上下文已变更', 'AbortError');
        if (
            !round &&
            !(
                single &&
                single.provider === 'fish-drama3' &&
                single.enabled === true &&
                single.targetNpcId !== 'USER' &&
                npcs[single.targetNpcId]
            )
        )
            return null;
        var ctx = {
            kind: round ? 'round' : 'single',
            workspaceId: workspaceId,
            context: context,
            controller: new AbortController(),
            round: round,
            targetNpcId: single && single.targetNpcId,
            finishReason: null,
        };
        active = ctx;
        return ctx;
    }
    function release(ctx) {
        if (active === ctx) active = null;
    }
    function instruction(ctx) {
        if (!ctx) return '';
        return ctx.kind === 'round'
            ? speechRoundPlan.instruction(speechRound.characters())
            : speechPlan.singleInstruction({
                  id: ctx.targetNpcId,
                  name: npcs[ctx.targetNpcId].name,
              });
    }
    async function singlePlan(text, ctx) {
        var plan = await speechPlan.fromMainText(text, speechRound.characters());
        assertContext(ctx);
        if (!COMPLETE.includes(ctx.finishReason))
            plan.issues.push({ reason: 'completion-not-confirmed' });
        return Object.assign(plan, {
            targetNpcId: ctx.targetNpcId,
            finishReason: ctx.finishReason,
            renderVersion: 'drama3-v1',
        });
    }
    function envelope(raw) {
        var parsed = responseParser.run(raw);
        if (
            !parsed.mainText ||
            !parsed.summaries ||
            !parsed.summaries.length ||
            parsed.sideNote === null
        )
            throw new Error('本轮正文格式不完整，未进入语音提交');
        return parsed;
    }
    function evidence(draft) {
        return storageService.loadUIConversation().filter(function (m) {
            return m && m.roundSpeech && m.roundSpeech.draftId === draft.id;
        });
    }
    async function publish(draft, ctx, options, commit, status) {
        options = options || {};
        assertContext(ctx);
        var previous = evidence(draft);
        if (previous.length) {
            if (previous.length !== 1 || previous[0].content !== draft.input.mainText)
                throw new Error('待办发布记录需要核对');
            await speechRound.update(draft, { phase: 'published' });
            return true;
        }
        await speechRound.assertCurrent(draft, ctx.controller.signal);
        assertContext(ctx);
        var commitStarted = false;
        try {
            if (options.silent)
                draft = await speechRound.update(draft, { silent: true, phase: 'ready' });
            while (!draft.silent) {
                assertContext(ctx);
                if (status) status('准备本轮声音…');
                try {
                    draft = await speechRound.prepare(draft, {
                        signal: ctx.controller.signal,
                        adoptSettings: options.adoptSettings,
                        onProgress: function (done, total) {
                            if (status) status('声音准备 ' + done + ' / ' + total);
                        },
                    });
                    assertContext(ctx);
                    break;
                } catch (error) {
                    assertContext(ctx);
                    options.adoptSettings = null;
                    draft = await speechRound.update(draft, {
                        phase: 'paused',
                        error: String(error.message || error).slice(0, 300),
                    });
                    var choice = await speechRoundUI.decision(draft, error, ctx.controller.signal);
                    assertContext(ctx);
                    if (choice === 'pause') return false;
                    if (choice === 'silent') {
                        draft = await speechRound.update(draft, { silent: true, phase: 'ready' });
                        break;
                    }
                }
            }
            await speechRound.assertCurrent(draft, ctx.controller.signal);
            assertContext(ctx);
            draft = await speechRound.update(draft, { phase: 'committing' });
            assertContext(ctx);
            commitStarted = true;
            var success = await commit(
                draft.input.preprocessed,
                draft.input.rawText,
                draft.input.isRegenerate,
                {
                    mainText: draft.input.mainText,
                    readingPlan: draft.readingPlan,
                    roundSpeech: speechRound.record(draft),
                },
            );
            assertContext(ctx);
            var saved = evidence(draft);
            if (saved.length !== 1 || saved[0].content !== draft.input.mainText)
                throw new Error('本轮提交结果需要核对');
            await speechRound.update(draft, { phase: 'published' });
            return success;
        } catch (error) {
            if (!commitStarted && mediaContext.isCurrent(ctx.context)) {
                var current = await speechRound.load(ctx.workspaceId);
                if (
                    current &&
                    current.id === draft.id &&
                    speechRound.pending(current) &&
                    current.phase !== 'committing'
                )
                    await speechRound.update(current, {
                        phase: 'paused',
                        error: String(error.message || error).slice(0, 300),
                    });
            }
            if (error.name === 'AbortError') return false;
            throw error;
        }
    }
    async function finish(ctx, preprocessed, rawText, isRegenerate, commit, status) {
        if (!ctx) return commit(preprocessed, rawText, isRegenerate);
        assertContext(ctx);
        var parsed = ctx.kind === 'round' ? envelope(rawText) : responseParser.run(rawText);
        if (ctx.kind === 'single') {
            var single = await singlePlan(parsed.mainText, ctx);
            return commit(preprocessed, rawText, isRegenerate, {
                mainText: single.source,
                singleSpeech: single,
            });
        }
        ctx.round.finishReason = ctx.finishReason;
        var clean = await speechPlan.fromMainText(parsed.mainText, speechRound.characters());
        assertContext(ctx);
        var reading = presentationPlan.validate(
            clean.source,
            presentationPlan.captureCurrent(clean.source, 'committed', ''),
        );
        var plan = await speechRoundPlan.compile(parsed.mainText, speechRound.characters(), {
            finishReason: ctx.finishReason,
            readingPlan: reading,
            maxChars: ctx.round.maxChars,
            maxClips: ctx.round.maxClips,
        });
        assertContext(ctx);
        if (typeof summaryRunner !== 'undefined' && summaryRunner.isRunning())
            summaryRunner.cancel();
        if (typeof eventRunner !== 'undefined' && eventRunner.cancel) eventRunner.cancel();
        if (typeof locationRunner !== 'undefined' && locationRunner.cancel) locationRunner.cancel();
        var draft = await speechRound.create(
            {
                preprocessed: preprocessed,
                rawText: rawText,
                rawSource: parsed.mainText,
                mainText: plan.source,
                isRegenerate: isRegenerate,
                readingPlan: reading,
                plan: plan,
            },
            ctx.round,
            ctx.controller.signal,
        );
        assertContext(ctx);
        return publish(draft, ctx, {}, commit, status);
    }
    async function resume(id, options, commit, status) {
        var ctx = {
            kind: 'round',
            workspaceId: mediaContext.workspaceId(),
            context: mediaContext.capture(),
            controller: new AbortController(),
        };
        active = ctx;
        try {
            return await speechRound.withLease(ctx.workspaceId, async function () {
                var draft = await speechRound.load(ctx.workspaceId);
                assertContext(ctx);
                if (!draft || draft.id !== id) throw new Error('这份语音待办已失效');
                return publish(draft, ctx, options, commit, status);
            });
        } finally {
            release(ctx);
        }
    }
    return {
        begin: begin,
        release: release,
        instruction: instruction,
        finish: finish,
        resume: resume,
        cancel: cancel,
        guardProgress: guardProgress,
        progressReason: progressReason,
        active: function () {
            return !!active;
        },
        setCompletion: function (ctx, value) {
            if (ctx) ctx.finishReason = (value && value.finishReason) || null;
        },
    };
})();
