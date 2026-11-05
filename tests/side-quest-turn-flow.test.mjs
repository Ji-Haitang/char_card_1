import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

class FakeTimers {
    constructor() {
        this.now = 0;
        this.nextId = 1;
        this.pending = new Map();
        this.delays = [];
    }

    setTimeout = (callback, delay = 0) => {
        const id = this.nextId++;
        const ms = Number(delay) || 0;
        this.delays.push(ms);
        this.pending.set(id, { at: this.now + ms, callback });
        return id;
    };

    clearTimeout = (id) => {
        this.pending.delete(id);
    };

    advance(ms) {
        const target = this.now + ms;
        while (true) {
            let nextId = null;
            let next = null;
            for (const [id, timer] of this.pending) {
                if (timer.at <= target && (!next || timer.at < next.at)) {
                    nextId = id;
                    next = timer;
                }
            }
            if (!next) break;
            this.pending.delete(nextId);
            this.now = next.at;
            next.callback();
        }
        this.now = target;
    }
}

const flush = async (rounds = 12) => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
};

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeQuest() {
    return {
        questId: 'sq-regression',
        title: 'regression quest',
        status: 'active',
        currentNodeId: 'node-1',
        nodes: {
            'node-1': {
                type: 'stage',
                title: 'node-1',
                interaction: 'free',
                maxTurns: 0
            }
        },
        deadlineWeek: 100,
        turnsInNode: 0,
        lastJudgedUiIndex: 0,
        pendingInteraction: null
    };
}

function quietConsole() {
    return {
        log() {},
        warn() {},
        error() {},
        group() {},
        groupCollapsed() {},
        groupEnd() {}
    };
}

function makeRunnerHarness({ active = true, streamMode = 'non-stream', responses = [] } = {}) {
    const clock = new FakeTimers();
    const state = {
        active: active ? makeQuest() : null,
        responses: [...responses],
        apiCalls: 0,
        statuses: [],
        notices: [],
        applied: 0,
        judgeDisabled: false,
        saves: 0,
        deferred: null,
        pendingReturnFailure: null
    };

    const gameData = {
        sideQuest: { active: state.active, pendingReturnFailure: null, judgeDisabled: false },
        sideQuestConfig: { enabled: true, confidenceThreshold: 0.7 }
    };

    const context = {
        console: quietConsole(),
        window: {},
        AbortController,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        currentWeek: 1,
        currentSpecialEvent: '',
        gameData,
        pipeline: { isBusy: () => false },
        PROMPT_SQ_JUDGE: 'judge prompt',
        PROMPT_SQ_RUMOR: 'rumor prompt',
        PROMPT_SQ_TREE: 'tree prompt',
        templateEngine: { renderPromptTemplate: () => 'rendered prompt' },
        promptOverrides: { get: (_key, fallback) => fallback },
        responseParser: {
            extractXmlBlock: (_raw, _tag) => ({ found: true, closed: true, content: _raw })
        },
        apiService: {
            getConfig: () => ({ streamMode }),
            sendMessages: (_messages, options) => {
                state.apiCalls++;
                const next = state.responses.shift();
                if (next === 'DEFER') {
                    state.deferred = deferred();
                    return state.deferred.promise;
                }
                if (next === 'HANG') {
                    return new Promise((_resolve, reject) => {
                        const signal = options && options.signal;
                        if (!signal) return;
                        signal.addEventListener('abort', () => {
                            const error = new Error('aborted');
                            error.name = 'AbortError';
                            reject(error);
                        }, { once: true });
                    });
                }
                if (next instanceof Error) return Promise.reject(next);
                return Promise.resolve({ content: next });
            }
        },
        sideQuestService: {
            isEnabled: () => true,
            getActive: () => state.active,
            getPendingReturnFailure: () => state.pendingReturnFailure,
            clearPendingReturnFailure: () => { state.pendingReturnFailure = null; gameData.sideQuest.pendingReturnFailure = null; },
            checkStageGates: () => true,
            buildJudgeCtx: () => ({}),
            applyJudgement: (_result, meta) => {
                state.applied++;
                state.active.lastJudgedUiIndex = meta.uiIndex;
                return { action: 'continue' };
            },
            setJudgeDisabled: (value) => {
                state.judgeDisabled = !!value;
                gameData.sideQuest.judgeDisabled = !!value;
            }
        },
        storageService: {
            saveAppState: () => { state.saves++; }
        },
        syncGameDataFromVariables() {},
        showModal: (text) => state.notices.push(String(text)),
        showToast() {}
    };

    vm.runInNewContext(read('module/side-quest-runner.js'), context, { filename: 'side-quest-runner.js' });
    return { context, runner: context.sideQuestRunner, state, clock };
}

function makeElement(id = '') {
    const classNames = new Set();
    const element = {
        id,
        disabled: false,
        style: {},
        classList: {
            add(name) { classNames.add(name); },
            remove(name) { classNames.delete(name); },
            contains(name) { return classNames.has(name); }
        },
        children: [],
        appendChild(child) { this.children.push(child); }
    };
    return element;
}

function makePipelineHarness({ streamMode = 'non-stream', active = true, judgeResponses = [] } = {}) {
    const clock = new FakeTimers();
    const controls = new Map();
    for (const id of [
        'main-viewport', 'stream-controls', 'story-expand-btn', 'stream-mask', 'stream-log',
        'skip-week-btn', 'slg-return-btn', 'free-action-send-btn',
        'regenerate-btn', 'free-action-input'
    ]) controls.set(id, makeElement(id));

    const state = {
        active: active ? makeQuest() : null,
        judgeResponses: [...judgeResponses],
        apiCalls: 0,
        mainCalls: 0,
        judgeCalls: 0,
        promptBuilds: 0,
        autoSaves: 0,
        notices: [],
        statuses: [],
        inputUpdates: 0,
        inputLocked: false,
        mainStream: null,
        judgeStream: null,
        applied: 0,
        judgeDisabled: false,
        ui: [],
        appSaves: 0,
        snapshotAttempts: 0,
        snapshots: [],
        snapshotDeferred: null,
        listeners: {},
        rendered: [],
        errors: []
    };
    const statusLog = controls.get('stream-log');
    let currentStatus = '';
    Object.defineProperty(statusLog, 'innerHTML', {
        get: () => currentStatus,
        set: (value) => {
            if (value === '') {
                if (currentStatus) state.statuses.push(currentStatus);
                currentStatus = '';
                statusLog.children = [];
            } else {
                currentStatus = String(value);
            }
        }
    });
    statusLog.appendChild = (child) => {
        statusLog.children.push(child);
        currentStatus += child.textContent || '';
    };

    const gameData = {
        playerName: 'hero',
        sideQuest: { active: state.active, pendingReturnFailure: null, judgeDisabled: false },
        sideQuestConfig: { enabled: true, confidenceThreshold: 0.7 },
        recallConfig: { fragments: { maxTokens: 3000 }, events: { maxTokens: 5000, enabled: true } }
    };

    const context = {
        console: quietConsole(),
        window: {},
        document: {
            getElementById: (id) => controls.get(id) || null,
            createElement: () => makeElement(),
            querySelector: () => null,
            addEventListener: (type, listener) => { state.listeners[type] = listener; },
            removeEventListener: (type, listener) => {
                if (state.listeners[type] === listener) delete state.listeners[type];
            }
        },
        AbortController,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        currentWeek: 1,
        newWeek: 0,
        markWeek: 1,
        seasonStatus: 'winter',
        seasonNameMap: { winter: '冬天' },
        GameMode: 0,
        mapLocation: '天山派',
        companionNPC: [],
        npcs: {},
        inputEnable: 1,
        enamor: 0,
        randomEvent: 0,
        battleEvent: 0,
        currentRandomEvent: null,
        currentBattleEvent: null,
        currentSpecialEvent: '',
        summary_Small: '',
        summary_Week: '',
        summary_Backup: '',
        gameData,
        PROMPT_SQ_JUDGE: 'judge prompt',
        PROMPT_SQ_RUMOR: 'rumor prompt',
        PROMPT_SQ_TREE: 'tree prompt',
        window: {},
        pipeline: { isBusy: () => false },
        responseParser: {
            removeThinkingContent: (text) => text,
            extractMainText: (text) => text,
            extractXmlBlock: (_raw, _tag) => ({ found: true, closed: true, content: _raw }),
            run: (raw) => {
                assert.equal(raw, 'MAIN_RESPONSE');
                return { mainText: 'main body', sideNote: {}, summaries: ['summary'] };
            }
        },
        templateEngine: { renderPromptTemplate: () => 'rendered prompt' },
        promptOverrides: { get: (_key, fallback) => fallback },
        promptBuilder: {
            buildMessages: () => {
                state.promptBuilds++;
                return [{ role: 'user', content: 'prompt' }];
            }
        },
        storageService: {
            loadUIConversation: () => state.ui.slice(),
            appendUIConversation: (message) => state.ui.push(message),
            saveAppState: () => { state.appSaves++; },
            restoreFromSnapshot: () => {},
            saveFullSnapshot: () => {
                const attempt = ++state.snapshotAttempts;
                const commitSnapshot = () => state.snapshots.push({ attempt, lastUserMessage: context.lastUserMessage });
                return state.snapshotDeferred
                    ? state.snapshotDeferred.promise.then(commitSnapshot)
                    : Promise.resolve().then(commitSnapshot);
            },
            loadAllEmbeddings: () => [],
            loadAllL2Embeddings: () => [],
            saveEmbedding() {},
            saveL2Embedding() {}
        },
        summaryHistoryService: {
            getAll: () => [],
            append() {},
            trimWindow() {}
        },
        weekHistoryService: {
            getAll: () => [],
            append() {},
            hasRunSummaryEntry: () => false
        },
        sideQuestService: {
            isEnabled: () => true,
            getActive: () => state.active,
            getPendingReturnFailure: () => state.pendingReturnFailure,
            clearPendingReturnFailure: () => { state.pendingReturnFailure = null; gameData.sideQuest.pendingReturnFailure = null; },
            checkStageGates: () => true,
            buildJudgeCtx: () => ({}),
            applyJudgement: (_result, meta) => {
                state.applied++;
                state.active.lastJudgedUiIndex = meta.uiIndex;
                return { action: 'continue' };
            },
            setJudgeDisabled: (value) => {
                state.judgeDisabled = !!value;
                gameData.sideQuest.judgeDisabled = !!value;
            }
        },
        apiService: {
            getConfig: () => ({ streamMode }),
            sendMessages: (messages, options) => {
                state.apiCalls++;
                if (!messages || messages[0]?.role !== 'system') {
                    state.mainCalls++;
                    return Promise.resolve({ content: 'MAIN_RESPONSE' });
                }
                state.judgeCalls++;
                const next = state.judgeResponses.shift();
                if (next === 'DEFER') {
                    state.judgeDeferred = deferred();
                    const signal = options && options.signal;
                    if (signal) {
                        signal.addEventListener('abort', () => {
                            const error = new Error('aborted');
                            error.name = 'AbortError';
                            state.judgeDeferred.reject(error);
                        }, { once: true });
                    }
                    return state.judgeDeferred.promise;
                }
                if (next === 'HANG') {
                    return new Promise((_resolve, reject) => {
                        const signal = options && options.signal;
                        if (!signal) return;
                        signal.addEventListener('abort', () => {
                            const error = new Error('aborted');
                            error.name = 'AbortError';
                            reject(error);
                        }, { once: true });
                    });
                }
                if (next instanceof Error) return Promise.reject(next);
                return Promise.resolve({ content: next });
            },
            sendMessagesStream: (messages, callbacks) => {
                state.apiCalls++;
                if (!messages || messages[0]?.role !== 'system') {
                    state.mainCalls++;
                    state.mainStream = callbacks;
                } else {
                    state.judgeCalls++;
                    state.judgeStream = callbacks;
                }
                return { abort() { state.streamAborted = true; } };
            }
        },
        syncGameDataFromVariables() {},
        checkAllValueRanges() {},
        calculateSeason: () => 'winter',
        updateSceneBackgrounds() {},
        updateLocationHeadcountLabels() {},
        displayNpcs() {},
        updateAllDisplays() {},
        updateSLGReturnButton() {},
        renderMainText: (text) => state.rendered.push(text),
        updateNpcTurnEmotions() {},
        refreshNpcEmotionPortraits() {},
        resetNpcTurnEmotions() {},
        showModal: (text) => state.notices.push(String(text)),
        showToast() {},
        autoSave: () => { state.autoSaves++; },
        updateFreeActionInputState: () => {
            state.inputUpdates++;
            const busy = !!(context.pipeline && context.pipeline.isBusy && context.pipeline.isBusy());
            state.inputLocked = busy;
            for (const id of ['skip-week-btn', 'slg-return-btn', 'free-action-send-btn', 'regenerate-btn', 'free-action-input']) {
                const element = controls.get(id);
                if (element) element.disabled = busy;
            }
        }
    };

    // Keep the production contract visible to the test: UI refreshes consult pipeline.isBusy.
    context.pipeline = {};
    vm.runInNewContext(read('module/side-quest-runner.js'), context, { filename: 'side-quest-runner.js' });
    vm.runInNewContext(read('module/pipeline.js'), context, { filename: 'pipeline.js' });
    return { context, pipeline: context.pipeline, runner: context.sideQuestRunner, state, controls, clock };
}

function judgeSuccess() {
    return JSON.stringify({ result: 'continue', confidence: 1 });
}

function assertStatusPhases(statuses) {
    assert.ok(statuses.length >= 3, `expected judging/retry-wait/completion status updates, got ${JSON.stringify(statuses)}`);
    assert.ok(statuses.some((text) => /判定|推敲|judg/i.test(text)), 'missing judging status');
    assert.ok(statuses.some((text) => /重试|重判|retry/i.test(text)), 'missing retry status');
    assert.ok(statuses.some((text) => /等待|1秒|wait/i.test(text)), 'missing retry-wait status');
    assert.ok(statuses.some((text) => /完成|成功|收好判词|未成|complete|success/i.test(text)), 'missing terminal status');
}

async function settleRetries(harness, count) {
    for (let i = 0; i < count; i++) {
        harness.clock.advance(1000);
        await flush();
    }
}

test('afterCommit bypasses cleanly when there is no active quest', async () => {
    const harness = makeRunnerHarness({ active: false, responses: [judgeSuccess()] });
    const result = await harness.runner.afterCommit(
        { mainText: 'main body' },
        { uiIndex: 1, userMessage: 'input', onStatus: (text) => harness.state.statuses.push(text) }
    );

    assert.equal(result, undefined, 'no active quest is a no-op rather than a judge failure');
    assert.equal(harness.state.apiCalls, 0, 'no judge request should be built without an active quest');
    assert.deepEqual(harness.state.statuses, []);
});

test('return failure afterCommit consumes the one-shot narrative context without judging', async () => {
    const harness = makeRunnerHarness({ active: false, responses: [judgeSuccess()] });
    const failure = { title: '中断的追查', originLocation: '伊州' };
    harness.state.pendingReturnFailure = failure;
    harness.context.gameData.sideQuest.pendingReturnFailure = failure;

    const result = await harness.runner.afterCommit(
        { mainText: '你带着同行者沉默返程，终于回到天山派。', sideNote: {} },
        { uiIndex: 1, userMessage: '中途放弃任务并返回门派' }
    );

    assert.equal(result, true);
    assert.equal(harness.state.apiCalls, 0);
    assert.equal(harness.state.pendingReturnFailure, null);
    assert.equal(harness.context.gameData.sideQuest.pendingReturnFailure, null);
});

test('return failure keeps context when the generated body is empty', async () => {
    const harness = makeRunnerHarness({ active: false });
    const failure = { title: '中断的追查', originLocation: '伊州' };
    harness.state.pendingReturnFailure = failure;
    harness.context.gameData.sideQuest.pendingReturnFailure = failure;

    const result = await harness.runner.afterCommit(
        { mainText: '', sideNote: {} },
        { uiIndex: 1, userMessage: '中途放弃任务并返回门派' }
    );

    assert.equal(result, false);
    assert.equal(harness.state.apiCalls, 0);
    assert.equal(harness.state.pendingReturnFailure, failure);
});
test('return and ending epilogues keep context for truncated replies', async () => {
    const harness = makeRunnerHarness({ active: false });
    const failure = { title: '中断的追查' };
    harness.state.pendingReturnFailure = failure;
    harness.context.gameData.sideQuest.pendingReturnFailure = failure;
    harness.context.sideQuestService.isEnabled = () => false;
    assert.equal(await harness.runner.afterCommit({ mainText: '未完整返回', sideNote: null }, {}), false);
    assert.equal(harness.state.pendingReturnFailure, failure);
    assert.equal(await harness.runner.afterCommit({ mainText: '已返回', sideNote: {} }, {}), true,
        'already settled failure must be narrated even with the feature disabled');
    assert.equal(harness.state.pendingReturnFailure, null);

    const ending = makeRunnerHarness();
    ending.state.active.pendingEpilogue = true;
    let finalized = 0;
    ending.context.sideQuestService.finalizeEpilogue = () => { finalized++; return null; };
    assert.equal(await ending.runner.afterCommit({ mainText: '截断余韵', sideNote: null }, {}), false);
    assert.equal(finalized, 0);
    ending.context.sideQuestService.checkStageGates = () => false;
    await ending.runner.afterCommit({ mainText: '其他地点的正文', sideNote: {} }, {});
    assert.equal(finalized, 0);
    ending.context.sideQuestService.checkStageGates = () => true;
    await ending.runner.afterCommit({ mainText: '完整余韵', sideNote: {} }, {});
    assert.equal(finalized, 1);
});

test('runner retries once, reports status phases, and settles true on retry success', async () => {
    const harness = makeRunnerHarness({ responses: [new Error('temporary'), judgeSuccess()] });
    const pending = harness.runner.afterCommit(
        { mainText: 'main body' },
        { uiIndex: 1, userMessage: 'input', onStatus: (text) => harness.state.statuses.push(text) }
    );
    await flush();
    assert.equal(harness.state.apiCalls, 1);
    assert.ok(harness.runner.isRunning());

    harness.clock.advance(1000);
    await flush();
    const result = await pending;

    assert.equal(result, true);
    assert.equal(harness.state.apiCalls, 2);
    assert.equal(harness.state.applied, 1);
    assert.equal(harness.state.judgeDisabled, false);
    assert.deepEqual(harness.clock.delays, [1000]);
    assertStatusPhases(harness.state.statuses);
});

test('runner cancellation during retry wait settles false and never retries', async () => {
    const harness = makeRunnerHarness({ responses: [new Error('temporary'), judgeSuccess()] });
    const pending = harness.runner.afterCommit(
        { mainText: 'main body' },
        { uiIndex: 1, userMessage: 'input', onStatus: (text) => harness.state.statuses.push(text) }
    );
    await flush();
    assert.equal(harness.state.apiCalls, 1);
    assert.deepEqual(harness.clock.delays, [1000]);

    harness.runner.cancel();
    const result = await pending;

    assert.equal(result, false);
    assert.equal(harness.state.apiCalls, 1);
    assert.equal(harness.state.judgeDisabled, false);
});

test('non-stream runTurn keeps mask, input lock, and busy state through a deferred judge', async () => {
    const harness = makePipelineHarness({ streamMode: 'non-stream', judgeResponses: ['DEFER'] });
    const run = harness.pipeline.runTurn('first input');
    await flush();

    assert.equal(harness.state.promptBuilds, 1);
    assert.equal(harness.state.apiCalls, 2, 'one main request plus one judge request');
    assert.equal(harness.pipeline.isBusy(), true);
    assert.equal(harness.controls.get('stream-mask').classList.contains('active'), true);
    assert.equal(harness.state.inputLocked, true);
    assert.equal(harness.controls.get('free-action-input').disabled, true);

    const blocked = await harness.pipeline.runTurn('blocked input');
    assert.equal(blocked, false);
    assert.equal(harness.state.promptBuilds, 1, 'busy second turn must not build a prompt');
    assert.match(harness.state.notices.at(-1), /已有生成任务|稍候/);
    assert.equal(harness.state.autoSaves, 0, 'autosave waits for the judge');

    harness.state.judgeDeferred.resolve({ content: judgeSuccess() });
    const result = await run;
    assert.equal(result, true);
    assert.equal(harness.state.autoSaves, 1, 'autosave occurs only after successful judge');
    assert.equal(harness.pipeline.isBusy(), false);
    assert.equal(harness.controls.get('stream-mask').classList.contains('active'), false);
    assert.equal(harness.controls.get('free-action-input').disabled, false);
});

test('stream runTurn also holds the scene lock until sideQuest afterCommit settles', async () => {
    const harness = makePipelineHarness({ streamMode: 'stream', judgeResponses: [] });
    const run = harness.pipeline.runTurn('stream input');
    await flush();
    assert.ok(harness.state.mainStream, 'stream main request should be started');
    assert.equal(harness.pipeline.isBusy(), true);
    assert.equal(harness.controls.get('stream-mask').classList.contains('active'), true);

    harness.state.mainStream.onComplete('MAIN_RESPONSE', {});
    await flush();
    assert.ok(harness.state.judgeStream, 'stream judge request should be started');
    assert.equal(harness.pipeline.isBusy(), true);
    assert.equal(harness.controls.get('free-action-input').disabled, true);
    assert.equal(harness.state.autoSaves, 0);

    harness.state.judgeStream.onComplete(judgeSuccess(), {});
    await run;

    assert.equal(harness.state.autoSaves, 1);
    assert.equal(harness.pipeline.isBusy(), false);
    assert.equal(harness.controls.get('stream-mask').classList.contains('active'), false);
    assert.equal(harness.controls.get('free-action-input').disabled, false);
});

test('held handleMessageOutput prepare rejects duplicate helper/runTurn calls before snapshot mutation', async () => {
    const harness = makePipelineHarness({ streamMode: 'non-stream', active: false });
    const heldSnapshot = deferred();
    harness.state.snapshotDeferred = heldSnapshot;
    harness.context.console = {
        ...quietConsole(),
        error: (...args) => harness.state.errors.push(args.map(String).join(' '))
    };
    harness.context.isInRenderEnvironment = () => false;
    harness.context.getRenderFunction = () => null;
    const helpers = read('module/game-helpers.js');
    const messageOutput = helpers.slice(helpers.indexOf('async function handleMessageOutput('), helpers.indexOf('// 显示21点游戏'));
    vm.runInNewContext(messageOutput, harness.context, { filename: 'game-helpers.js' });

    const firstTurn = harness.context.handleMessageOutput('first turn');
    await flush();

    assert.equal(harness.pipeline.isBusy(), true, 'scene lock starts before the async snapshot callback');
    assert.equal(harness.state.snapshotAttempts, 1);
    assert.equal(harness.state.snapshots.length, 0, 'the first snapshot is still awaiting persistence');
    assert.equal(harness.state.promptBuilds, 0, 'pipeline must not build a prompt before prepare finishes');

    const duplicateHelper = await harness.context.handleMessageOutput('行动选择:新的一周开始了');
    let duplicatePrepareCalls = 0;
    const duplicateDirectRun = await harness.pipeline.runTurn('third turn', {
        prepare: async () => { duplicatePrepareCalls++; }
    });

    assert.equal(duplicateHelper, false, 'the normal message-output entry point must ignore duplicate sends');
    assert.equal(duplicateDirectRun, false, 'a duplicate direct runTurn must be rejected');
    assert.equal(duplicatePrepareCalls, 0, 'a rejected run must not run its snapshot callback');
    assert.equal(harness.state.snapshotAttempts, 1, 'duplicate actions must not take/overwrite snapshots');
    assert.equal(harness.context.lastUserMessage, 'first turn', 'duplicate input must not replace rollback metadata');
    assert.equal(harness.context.newWeek, 0, 'duplicate input must not alter new-week state');
    assert.equal(harness.state.promptBuilds, 0);
    assert.equal(harness.state.apiCalls, 0);

    heldSnapshot.resolve();
    const completed = await firstTurn;

    assert.equal(completed, true, JSON.stringify({ errors: harness.state.errors, notices: harness.state.notices, ui: harness.state.ui, snapshots: harness.state.snapshots }));
    assert.equal(harness.state.snapshotAttempts, 1);
    assert.deepEqual(harness.state.snapshots, [{ attempt: 1, lastUserMessage: 'first turn' }]);
    assert.equal(harness.state.promptBuilds, 1);
    assert.equal(harness.state.mainCalls, 1);
    assert.equal(harness.pipeline.isBusy(), false);
});

test('pipeline cancellation returns false, skips autosave, and releases the full-turn lock', async () => {
    const harness = makePipelineHarness({ streamMode: 'non-stream', judgeResponses: ['HANG'] });
    const run = harness.pipeline.runTurn('cancel input');
    await flush();

    assert.equal(harness.pipeline.isBusy(), true);
    assert.equal(harness.controls.get('free-action-input').disabled, true);
    harness.runner.cancel();
    const result = await run;

    assert.equal(result, false);
    assert.equal(harness.state.autoSaves, 0);
    assert.equal(harness.pipeline.isBusy(), false);
    assert.equal(harness.controls.get('stream-mask').classList.contains('active'), false);
    assert.equal(harness.controls.get('free-action-input').disabled, false);
});

test('exhaustion is initial attempt plus three 1000ms retries: false, no autosave, regenerate modal, no judge disable', async () => {
    const harness = makePipelineHarness({
        streamMode: 'non-stream',
        judgeResponses: [new Error('bad 1'), new Error('bad 2'), new Error('bad 3'), new Error('bad 4')]
    });
    const run = harness.pipeline.runTurn('failure input');
    await flush();

    assert.equal(harness.state.apiCalls, 2, 'main request plus initial judge attempt');
    assert.equal(harness.pipeline.isBusy(), true);
    assert.equal(harness.controls.get('stream-mask').classList.contains('active'), true);

    await settleRetries(harness, 3);
    await run;
    assert.equal(await harness.runner.whenSettled(), false, 'whenSettled must expose failed exhaustion');

    assert.equal(harness.state.apiCalls, 5, 'one initial judge attempt plus exactly three retries');
    assert.equal(harness.state.judgeCalls, 4, 'initial attempt plus exactly three retries');
    assert.deepEqual(harness.clock.delays, [1000, 1000, 1000]);
    assert.equal(harness.state.autoSaves, 0, 'failed judge must not autosave');
    assert.equal(harness.state.judgeDisabled, false, 'judge exhaustion must not disable the judge');
    assert.ok(harness.state.notices.some((text) => /自动存档|auto.?save/i.test(text)), 'failure should explain autosave was skipped');
    assert.ok(harness.state.notices.some((text) => /重新生成|重生成|regenerat/i.test(text)), 'failure should suggest regenerating');
    assert.equal(harness.pipeline.isBusy(), false, 'failure must release the scene lock');
    assert.equal(harness.controls.get('stream-mask').classList.contains('active'), false);
    assert.equal(harness.controls.get('free-action-input').disabled, false);
    assertStatusPhases(harness.state.statuses);
});

test('busy capture blocks click and keyboard activation, permits Stop, and releases listeners', async () => {
    const harness = makePipelineHarness({ judgeResponses: ['DEFER'] });
    const run = harness.pipeline.runTurn('held input');
    await flush();
    for (const type of ['click', 'keydown']) {
        let prevented = false, stopped = false;
        const event = {
            target: { closest: () => null },
            preventDefault() { prevented = true; },
            stopImmediatePropagation() { stopped = true; }
        };
        harness.state.listeners[type](event);
        assert.ok(prevented && stopped, `${type} must not activate covered controls`);
        prevented = stopped = false;
        event.target.closest = selector => selector === '#stream-stop-btn' ? {} : null;
        harness.state.listeners[type](event);
        assert.equal(prevented || stopped, false, 'narrative Stop remains operable');
        // 只读的正文翻页控件（箭头/页码点/正文点击区）在生成中仍可用
        event.target.closest = selector => /#story-prev-btn/.test(selector) ? {} : null;
        harness.state.listeners[type](event);
        assert.equal(prevented || stopped, false, 'story page navigation remains operable while busy');
    }
    harness.state.judgeDeferred.resolve({ content: judgeSuccess() });
    await run;
    assert.deepEqual(harness.state.listeners, {}, 'busy capture must be removed on completion');
});

test('actual input updater keeps every control locked then restores event-specific regeneration rules', async () => {
    const harness = makePipelineHarness({ judgeResponses: ['DEFER'] });
    const html = read('index.html');
    const updater = html.slice(html.indexOf('function updateFreeActionInputState()'), html.indexOf('// ========== 初始化 =========='));
    vm.runInNewContext(updater, harness.context, { filename: 'index.html' });
    harness.context.storageService.hasSnapshot = () => true;
    const run = harness.pipeline.runTurn('held input');
    await flush();
    harness.context.inputEnable = 0;
    harness.context.updateFreeActionInputState();
    for (const id of ['skip-week-btn', 'slg-return-btn', 'free-action-send-btn', 'regenerate-btn', 'free-action-input']) {
        assert.equal(harness.controls.get(id).disabled, true, `${id} stays locked even on UI refresh`);
    }
    harness.state.judgeDeferred.resolve({ content: judgeSuccess() });
    await run;
    assert.equal(harness.controls.get('free-action-input').disabled, true, 'event lock remains after generation');
    assert.equal(harness.controls.get('regenerate-btn').disabled, false, 'snapshot regeneration is restored');
});

test('Gemini non-stream request forwards cancellation to its pending fetch', async () => {
    let capturedSignal;
    const context = {
        console: quietConsole(), window: { location: { protocol: 'file:' } },
        localStorage: { getItem: () => null, setItem() {} },
        fetch: (_url, options) => {
            capturedSignal = options.signal;
            return new Promise((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
            });
        }
    };
    vm.runInNewContext(read('module/api-service.js'), context, { filename: 'api-service.js' });
    context.apiService.updateConfig({ type: 'gemini', endpoint: 'https://fixture.invalid', apiKey: 'fixture', model: 'fixture', corsProxyEnabled: false });
    const controller = new AbortController();
    const request = context.apiService.sendMessages([{ role: 'user', content: 'fixture' }], { signal: controller.signal });
    assert.equal(capturedSignal, controller.signal, 'transport must receive the cancellation signal');
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
});
