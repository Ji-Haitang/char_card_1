import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

function loadService() {
    const context = {
        console,
        pipeline: {},
        currentWeek: 1,
        gameData: {
            sideQuest: { active: null, history: [], lastRefreshWeek: 0, pendingTree: null, judgeDisabled: false },
            sideQuestConfig: { enabled: true, confidenceThreshold: 0.7, deadlineWeeks: 10 }
        },
        playerStats: { 声望: 20 },
        playerTalents: {},
        npcFavorability: {},
        checkAllValueRanges() {},
        syncGameDataFromVariables() {},
        updateAllDisplays() {}
    };
    vm.runInNewContext(read('module/side-quest-service.js'), context, { filename: 'side-quest-service.js' });
    return context;
}

function makeRumorBatch(label, locations = ['伊州', '伊州', '伊州'], npcs = []) {
    return JSON.stringify({ rumors: [1, 2, 3].map((n) => ({
        title: `${label}-${n}`,
        background: `background-${n}`,
        playerGoal: `goal-${n}`,
        difficulty: '普通',
        relatedNpcs: npcs,
        relatedLocations: [locations[n - 1]]
    })) });
}

/** 构造一个可用的剧情树（含带 id 的抉择选项） */
function makeTree() {
    return {
        rootNodeId: 'root',
        nodes: {
            root: {
                type: 'stage', title: 'root', hiddenGoal: 'x', interaction: 'choice',
                options: [
                    { id: 'a', label: '甲', narrative: '甲之白描', next: 'end' },
                    { id: 'b', label: '乙', narrative: '乙之白描', next: 'end2' }
                ]
            },
            end: { type: 'ending', title: 'end', endingType: 'success', epilogue: 'e', rewards: {} },
            end2: { type: 'ending', title: 'end2', endingType: 'bittersweet', epilogue: 'e2', rewards: {} }
        }
    };
}

function makeRunner(options = {}) {
    const state = {
        calls: 0,
        notices: [],
        busy: [],
        quotaUsed: false,
        markCalls: 0,
        accepted: 0,
        pendingTree: null,
        responses: [],
        requests: []
    };
    const context = {
        console,
        window: {},
        currentWeek: 1,
        gameData: { sideQuest: { history: [] } },
        Math: { floor: Math.floor, random: () => 0 },
        AbortController,
        setTimeout,
        clearTimeout,
        pipeline: {
            isBusy: () => false,
            showBusyOverlay: (text) => { state.busy.push(`show:${text}`); return true; },
            hideBusyOverlay: () => state.busy.push('hide')
        },
        apiService: {
            getConfig: () => ({ streamMode: 'non-stream' }),
            sendMessages: async (messages, options) => {
                state.calls++;
                state.requests.push(messages);
                const next = state.responses.shift();
                if (typeof next === 'function') return next(messages, options);
                if (next instanceof Error) throw next;
                if (next === 'HANG') {
                    // 模拟 api-service 的行为：fetch 被 abort 时以 AbortError 拒绝
                    return new Promise((resolve, reject) => {
                        const signal = options && options.signal;
                        if (!signal) return;
                        signal.addEventListener('abort', () => {
                            const err = new Error('The operation was aborted');
                            err.name = 'AbortError';
                            reject(err);
                        }, { once: true });
                    });
                }
                return { content: next };
            }
        },
        responseParser: {
            extractXmlBlock: (raw) => ({ found: true, closed: true, content: raw })
        },
        templateEngine: { renderPromptTemplate: () => 'prompt' },
        promptOverrides: { get: () => 'prompt' },
        PROMPT_SQ_RUMOR: 'rumor-prompt',
        PROMPT_SQ_TREE: 'tree-prompt',
        sideQuestService: {
            isEnabled: () => true,
            getActive: () => null,
            rumorRefreshUsed: () => state.quotaUsed,
            markCurrentWeekUsed: () => { state.quotaUsed = true; state.markCalls++; },
            buildSharedCtx: () => ({}),
            getAccessibleLocations: () => ['伊州'],
            buildTreeCtx: () => ({}),
            sanitizeRelatedNpcs: (v) => v || [],
            sanitizeRelatedLocations: (v) => v || [],
            validateTree: options.validateTree || ((tree) => tree && tree.rootNodeId ? { ok: true, errors: [] } : { ok: false, errors: ['invalid'] }),
            acceptQuest: () => { state.accepted++; return {}; },
            getPendingTree: () => state.pendingTree,
            setPendingTree: (rumor, index) => { state.pendingTree = { rumor, index, week: 1 }; },
            clearPendingTree: () => { state.pendingTree = null; }
        },
        showModal: (message) => state.notices.push(String(message))
    };
    vm.runInNewContext(read('module/side-quest-runner.js'), context, { filename: 'side-quest-runner.js' });
    return { runner: context.sideQuestRunner, state, context };
}

test('side quest quota is marked on accept and on cross-week resolution', () => {
    const ctx = loadService();
    const service = ctx.sideQuestService;

    assert.equal(service.rumorRefreshUsed(), false);
    service.markCurrentWeekUsed();
    assert.equal(ctx.gameData.sideQuest.lastRefreshWeek, 1);
    assert.equal(service.rumorRefreshUsed(), true);

    ctx.currentWeek = 2;
    assert.equal(service.rumorRefreshUsed(), false);

    ctx.gameData.sideQuest.active = {
        questId: 'sq-complete', title: 'complete', status: 'active', currentNodeId: 'start',
        nodes: {
            start: { type: 'stage', title: 'start', onSuccess: 'end' },
            end: { type: 'ending', title: 'end', endingType: 'success', epilogue: '', rewards: { 'playerStats.声望': { add: 5 } } }
        },
        log: [], progressNotes: '', turnsInNode: 0
    };
    const completed = service.applyJudgement(
        { result: 'success', confidence: 1 },
        { uiIndex: 1, userMessage: 'done' }
    );
    assert.equal(completed.action, 'endingReached', '抵达结局只挂起收束，不当场结算');
    assert.equal(ctx.gameData.sideQuest.lastRefreshWeek, 2);
    assert.equal(ctx.playerStats.声望, 20, '奖励不得在抵达结局节点时下发');

    // 收束轮（余韵正文写完后）才下发奖励并弹出完成结算
    const finalized = service.finalizeEpilogue();
    assert.equal(finalized.action, 'ending');
    assert.equal(ctx.playerStats.声望, 25);
    assert.deepEqual(JSON.parse(JSON.stringify(finalized.rewards)), [{ label: '声望', add: 5 }]);
    assert.equal(ctx.gameData.sideQuest.active, null);

    ctx.currentWeek = 3;
    ctx.gameData.sideQuest.active = {
        questId: 'sq-fail', title: 'fail', status: 'active', currentNodeId: 'start',
        nodes: { start: { type: 'stage', title: 'start' } },
        log: []
    };
    const failed = service.failQuest('failed', { uiIndex: 2 });
    assert.equal(failed.action, 'fail');
    assert.equal(ctx.gameData.sideQuest.lastRefreshWeek, 3);
});

test('returning to sect fails the active quest and preserves one-shot narrative context', () => {
    const ctx = loadService();
    const service = ctx.sideQuestService;
    ctx.mapLocation = '伊州';
    ctx.companionNPC = ['施延年'];
    ctx.gameData.sideQuest.active = {
        questId: 'sq-return', title: '断线追查', background: '一桩未完的追查', playerGoal: '找出线索',
        status: 'active', started: true, currentNodeId: 'stage-2', relatedNpcs: ['H'],
        nodes: { 'stage-2': { type: 'stage', title: '线索中断' } },
        pendingInteraction: null, progressNotes: '只找到半枚信物', pendingEpilogue: false,
        log: [], turnsInNode: 2
    };

    const outcome = service.failQuestForReturn();
    assert.equal(outcome.action, 'fail');
    assert.equal(outcome.returnToSect, true);
    assert.equal(ctx.playerStats.声望, 17);
    assert.equal(ctx.gameData.sideQuest.active, null);
    assert.equal(ctx.gameData.sideQuest.history.at(-1).outcome, 'failed');
    assert.equal(ctx.gameData.sideQuest.pendingReturnFailure.originLocation, '伊州');
    assert.deepEqual(ctx.gameData.sideQuest.pendingReturnFailure.companions, ['施延年']);
    assert.match(service.buildGuideText(), /中途放弃/);

    assert.equal(service.clearPendingReturnFailure(), true);
    assert.equal(ctx.gameData.sideQuest.pendingReturnFailure, null);
});

test('returning during ending epilogue changes the existing archive to failed', () => {
    const ctx = loadService();
    const service = ctx.sideQuestService;
    ctx.gameData.sideQuest.active = {
        questId: 'sq-epilogue-return', title: '余韵未尽', status: 'completed', currentNodeId: 'end',
        endingId: 'end', pendingEpilogue: true,
        nodes: { end: { type: 'ending', title: '迟来的回响', endingType: 'success', epilogue: 'e',
            rewards: { 'playerStats.声望': { add: 5 } } } },
        log: []
    };
    ctx.gameData.sideQuest.history.push({ questId: 'sq-epilogue-return', outcome: 'completed', endingId: 'end' });

    const outcome = service.failQuestForReturn();
    assert.equal(outcome.action, 'fail');
    assert.equal(ctx.gameData.sideQuest.history.length, 1);
    assert.equal(ctx.gameData.sideQuest.history[0].outcome, 'failed');
    assert.equal(ctx.gameData.sideQuest.history[0].endingId, null);
    assert.equal(service.finalizeEpilogue(), null, 'aborted ending cannot grant deferred rewards');
    assert.equal(ctx.playerStats.声望, 17);
    assert.match(service.buildGuideText(), /保留前文已经发生的事实/);
});

test('return risk starts only at the task location with a related companion and survives reload', () => {
    const ctx = loadService();
    const service = ctx.sideQuestService;
    ctx.GameMode = 1;
    ctx.npcNameToId = { '施延年': 'H' };
    ctx.mapLocation = '博斯坦村';
    ctx.companionNPC = ['施延年'];
    const active = ctx.gameData.sideQuest.active = {
        questId: 'sq-travel', title: '待启程', status: 'active', started: false,
        relatedLocations: ['伊州'], relatedNpcs: ['H'], log: []
    };
    service.markStarted();
    assert.equal(active.started, false);
    assert.equal(service.getReturnRisk(), null);
    assert.equal(service.failQuestForReturn().action, 'none');
    assert.equal(ctx.playerStats.声望, 20);
    ctx.mapLocation = '伊州';
    ctx.companionNPC = ['A'];
    service.markStarted();
    assert.equal(service.getReturnRisk(), null);
    ctx.companionNPC = ['施延年'];
    assert.equal(service.getReturnRisk(), active, 'arrival is protected before the first reply');
    service.markStarted();
    assert.equal(active.started, true);
    ctx.gameData = JSON.parse(JSON.stringify(ctx.gameData));
    ctx.companionNPC = [];
    ctx.mapLocation = '博斯坦村';
    assert.equal(service.getReturnRisk(), ctx.gameData.sideQuest.active, 'leaving the gates does not erase a started task');
});

test('return failure is idempotent, clamps reputation, and survives a narrative retry snapshot', () => {
    const ctx = loadService();
    const service = ctx.sideQuestService;
    ctx.playerStats.声望 = 2;
    ctx.mapLocation = '伊州';
    ctx.companionNPC = ['H'];
    ctx.npcs = { H: { name: '施延年' } };
    const active = ctx.gameData.sideQuest.active = {
        questId: 'sq-once', title: '待战', status: 'active', started: true, currentNodeId: 'battle',
        nodes: { battle: { title: '拦路人', type: 'stage' } }, log: [],
        pendingInteraction: { kind: 'battle', state: 'awaiting' }
    };
    service.failQuestForReturn(active);
    assert.equal(ctx.playerStats.声望, 0);
    assert.equal(active.pendingInteraction, null);
    assert.equal(service.failQuestForReturn(active).action, 'none');
    assert.equal(ctx.gameData.sideQuest.history.length, 1);
    const snapshot = JSON.parse(JSON.stringify(ctx.gameData));
    service.clearPendingReturnFailure();
    ctx.gameData = snapshot;
    ctx.gameData.sideQuestConfig.enabled = false;
    assert.match(service.buildGuideText(), /施延年/);
    assert.match(service.buildGuideText(), /不得.*重复扣罚/);
    assert.equal(service.failQuestForReturn().action, 'none');
    assert.equal(ctx.playerStats.声望, 0);
});

test('choice options must carry unique non-empty ids', () => {
    const ctx = loadService();
    const service = ctx.sideQuestService;

    const noId = makeTree();
    delete noId.nodes.root.options[1].id;
    assert.equal(service.validateTree(noId, '普通').ok, false);

    const dupId = makeTree();
    dupId.nodes.root.options[1].id = 'a';
    assert.equal(service.validateTree(dupId, '普通').ok, false);
});


test('rumor batches can be replaced and tree failure is a manual retry', async () => {
    const { runner, state } = makeRunner();
    state.responses.push(
        makeRumorBatch('first'),
        makeRumorBatch('second'),
        JSON.stringify({ nodes: 'invalid' }),
        JSON.stringify(makeTree())
    );

    const first = await runner.generateRumors();
    assert.equal(first[0].title, 'first-1');
    const second = await runner.generateRumors();
    assert.equal(second[0].title, 'second-1');
    assert.equal(state.markCalls, 0, 'candidate generation must not consume the weekly quota');

    const failed = await runner.acceptRumor(0);
    assert.equal(failed, false);
    assert.equal(state.markCalls, 1, 'accept must consume quota before tree generation');
    assert.equal(state.calls, 3, 'tree failure must not trigger an automatic second request');
    assert.match(state.notices.at(-1), /重新生成剧情树/);
    assert.deepEqual(state.busy, ['show:施延年伏案疾书', 'hide']);
    assert.equal(state.pendingTree.rumor.title, 'second-1', 'failed rumor must stay persisted for retry');
    assert.equal(runner.getTreeRetryIndex(), 0);

    const retried = await runner.acceptRumor(0);
    assert.equal(retried, true);
    assert.equal(state.markCalls, 1, 'manual tree retry must not consume quota again');
    assert.equal(state.accepted, 1);
    assert.equal(state.pendingTree, null, 'successful accept clears the pending-tree record');
    assert.deepEqual(state.busy, [
        'show:施延年伏案疾书', 'hide',
        'show:施延年伏案疾书', 'hide'
    ]);
});

function recentCandidates(messages) {
    const block = messages[2].content.match(/<RecentRumorCandidates>\n([\s\S]*?)\n<\/RecentRumorCandidates>/);
    return block ? block[1].split('\n').filter(line => line.startsWith('- ')).map(line => JSON.parse(line.slice(2))) : [];
}

test('batch replacement sends prior candidates as non-factual context without changing game history', async () => {
    const { runner, state, context } = makeRunner();
    const before = JSON.stringify(context.gameData);
    state.responses.push(makeRumorBatch('first'), makeRumorBatch('second'), makeRumorBatch('third'), JSON.stringify(makeTree()));
    const first = await runner.generateRumors();
    assert.equal(recentCandidates(state.requests[0]).length, 0);
    first[0].background = 'edited by a later consumer';
    await runner.generateRumors();
    const previous = recentCandidates(state.requests[1]);
    assert.equal(previous.length, 3);
    assert.deepEqual(previous[0], { title: 'first-1', location: '伊州', background: 'background-1', playerGoal: 'goal-1' });
    assert.match(state.requests[1][2].content, /不代表这些事件已经发生/);
    assert.match(state.requests[1][2].content, /核心起因、冲突和任务目标/);
    assert.match(state.requests[1][2].content, /仅修改标题、地点、敌人称谓或道具名称，不算新题材/);
    assert.match(state.requests[1][2].content, /允许再次使用同一 NPC 或地点/);
    assert.equal(state.requests[1].length, 6, 'existing request format stays intact');
    await runner.generateRumors();
    assert.equal(recentCandidates(state.requests[2]).length, 6);
    assert.equal(JSON.stringify(context.gameData), before, 'candidates are not persisted as history or world facts');
    assert.equal(state.markCalls, 0);
    await runner.acceptRumor(0);
    assert.equal(recentCandidates(state.requests[3]).length, 0, 'avoidance context must not enter the chosen quest tree');
});

test('rumor memory keeps the last five successful batches and excludes malformed or failed requests', async () => {
    const { runner, state } = makeRunner();
    for (let batch = 1; batch <= 6; batch++) {
        state.responses.push(makeRumorBatch(`batch${batch}`));
        await runner.generateRumors();
    }
    const invalid = JSON.parse(makeRumorBatch('invalid'));
    invalid.rumors.forEach(rumor => { rumor.relatedLocations = []; });
    state.responses.push(JSON.stringify(invalid), new Error('synthetic transport failure'), makeRumorBatch('replacement'));
    const current = runner.getRumorCandidates();
    assert.equal(await runner.generateRumors(), null);
    assert.equal(runner.getRumorCandidates(), current);
    assert.equal(await runner.generateRumors(), null);
    assert.equal(runner.getRumorCandidates(), current);
    await runner.generateRumors();
    for (const index of [6, 7, 8]) {
        const candidates = recentCandidates(state.requests[index]);
        assert.equal(candidates.length, 15);
        assert.equal(candidates[0].title, 'batch2-1');
        assert.equal(candidates.at(-1).title, 'batch6-3');
        assert.ok(candidates.every(rumor => !rumor.title.startsWith('invalid')));
    }
    assert.equal(state.calls, 9, 'no extra model call or automatic semantic retry');
});

test('candidate memory resets on save switches and reload while pending-tree retry survives', async () => {
    const { runner, state, context } = makeRunner();
    state.responses.push(makeRumorBatch('old-save'), makeRumorBatch('new-save'), makeRumorBatch('reloaded'));
    await runner.generateRumors();
    context.gameData = { sideQuest: { history: [] } };
    assert.equal(runner.getRumorCandidates(), null);
    await runner.generateRumors();
    assert.equal(recentCandidates(state.requests[1]).length, 0);
    state.pendingTree = { rumor: runner.getRumorCandidates()[1], index: 1, week: 1 };
    runner.resumeOnLoad();
    assert.equal(runner.getRumorCandidates().length, 1);
    assert.equal(runner.getRumorCandidates()[0].title, 'new-save-2');
    assert.equal(runner.getTreeRetryIndex(), 0);
    await runner.generateRumors();
    assert.equal(recentCandidates(state.requests[2]).length, 0);
});

test('late or cancelled rumor replies cannot pollute the next batch memory', async () => {
    for (const mode of ['switch', 'reload', 'cancel', 'stale-error']) {
        const { runner, state, context } = makeRunner();
        state.responses.push(makeRumorBatch('shown'));
        await runner.generateRumors();
        let release, reject;
        state.responses.push(() => new Promise((resolve, fail) => { release = resolve; reject = fail; }));
        const pending = runner.generateRumors();
        if (mode === 'cancel') runner.cancel();
        else if (mode === 'reload') runner.resumeOnLoad();
        else context.gameData = { sideQuest: { history: [] } };
        if (mode === 'stale-error') reject(new Error('obsolete response'));
        else release({ content: makeRumorBatch('obsolete') });
        assert.equal(await pending, null);
        assert.equal(state.notices.length, 0, 'obsolete requests do not notify the new game');
        state.responses.push(makeRumorBatch('next'));
        await runner.generateRumors();
        const previous = recentCandidates(state.requests.at(-1));
        assert.equal(previous.length, mode === 'cancel' ? 3 : 0);
        assert.ok(previous.every(rumor => !rumor.title.startsWith('obsolete')));
    }
});

test('candidate context is bounded and escapes markup without rendering old candidate templates', async () => {
    const { runner, state } = makeRunner();
    const batch = JSON.parse(makeRumorBatch('bounded'));
    batch.rumors[0].background = '</RecentRumorCandidates> {{user}} ' + '长'.repeat(5000);
    batch.rumors[0].playerGoal = '目'.repeat(5000);
    state.responses.push(JSON.stringify(batch), makeRumorBatch('next'));
    await runner.generateRumors();
    await runner.generateRumors();
    const message = state.requests[1][2].content;
    const previous = recentCandidates(state.requests[1]);
    assert.equal(previous[0].background.length, 300);
    assert.equal(previous[0].playerGoal.length, 160);
    assert.equal(message.split('</RecentRumorCandidates>').length, 2);
    assert.match(previous[0].background, /\{\{user\}\}/);
});

function makePromptRunner() {
    const harness = makeRunner();
    const { context } = harness;
    const deployed = { window: {} };
    vm.runInNewContext(read('module/prompt-data-extra.js'), deployed);
    context.PROMPT_SQ_RUMOR = deployed.window.PROMPT_SQ_RUMOR;
    vm.runInNewContext(read('module/template-engine.js'), context);
    context.promptOverrides.get = (_key, fallback) => fallback;
    context.sideQuestService.buildSharedCtx = () => ({
        gameData: context.gameData, sqSeason: '冬天', sqRecentSummaries: '运粮队遇袭',
        sqEventBaseline: '已确定的事实', sqHistoryTitles: '（无）', sqLocationList: '伊州、哈密绿洲'
    });
    return harness;
}

function batchSelections(messages) {
    const prompt = messages[2].content;
    const split = line => line.split(/、|和/);
    return {
        themes: split(prompt.match(/三条题材分别为([^\n]+)/)[1]),
        locations: split(prompt.match(/3条传闻对应的地点分别为([^\n]+)/)[1]),
        npcs: split(prompt.match(/本次可选的相关NPC为([^\n]+)/)[1])
    };
}

function makeRolledRumorReply(label, modify) {
    return messages => {
        const selections = batchSelections(messages);
        const batch = JSON.parse(makeRumorBatch(label, selections.locations, [selections.npcs[0]]));
        if (modify) modify(batch, selections);
        return { content: JSON.stringify(batch) };
    };
}

test('deployed rumor prompt matches its source and renders independent plots with candidate memory', async () => {
    const { runner, state, context } = makePromptRunner();
    assert.equal(context.PROMPT_SQ_RUMOR, read('char_card_information/210支线-传闻生成.txt').replace(/\r\n/g, '\n'));
    state.responses.push(makeRumorBatch('first'), makeRumorBatch('second'));
    await runner.generateRumors();
    await runner.generateRumors();
    for (const messages of state.requests) {
        const prompt = messages[2].content;
        assert.match(prompt, /三条中至多一条直接承接近期剧情/);
        assert.match(prompt, /不得违背近期剧情中的既定事实和人物状态/);
        assert.match(prompt, /不要反复把同一性格标签直接作为事件起因/);
        assert.doesNotMatch(prompt, /传闻应与之呼应|贴合当前季节、所在势力与近期剧情|<%/);
        assert.match(prompt, /运粮队遇袭/);
        assert.match(prompt, /relatedLocations 必须且只能包含 1 个地点/);
        assert.match(prompt, /暗中组织义军，庇护流民/);
        assert.match(prompt, /西夏擒生军与吕氏伪军皆为天山派的敌人。\n- 白驼山/);
        assert.match(prompt, /严禁以天山派弟子为反派（本派团结，无有叛徒）\n/);
        assert.doesNotMatch(prompt, /涉及"叛门"|暗中组织义军对抗吕氏与党项|\{\{题材|\{\{地点|\{\{编号/);
    }
    assert.equal(recentCandidates(state.requests[1]).length, 3);
});

test('each rumor request rolls exactly three distinct themes, locations and NPCs before rendering', async () => {
    const { runner, state, context } = makePromptRunner();
    let randomCalls = 0;
    context.Math = Object.create(Math);
    context.Math.random = () => randomCalls++ < 9 ? 0 : 0.999999;
    context.gameData.npcVisibility = {}; // 所有编号都有资格，不以出场状态筛选。
    const before = JSON.stringify(context.gameData);
    const locationPool = ['伊州', '博斯坦村', '天山派外堡', '迪坎儿村'];
    context.sideQuestService.getAccessibleLocations = () => locationPool;
    state.responses.push(makeRolledRumorReply('first'), makeRolledRumorReply('second'));
    assert.equal((await runner.generateRumors()).length, 3);
    assert.equal(randomCalls, 9);
    assert.equal((await runner.generateRumors()).length, 3);
    assert.equal(randomCalls, 18, 'the recent-candidate reminder must reuse these draws');
    const first = batchSelections(state.requests[0]);
    const second = batchSelections(state.requests[1]);
    assert.deepEqual(first, { themes: ['寻人', '夺宝', '恩怨'], locations: ['伊州', '博斯坦村', '天山派外堡'], npcs: ['A', 'B', 'C'] });
    assert.deepEqual(second, { themes: ['调解', '比武', '护送'], locations: ['迪坎儿村', '天山派外堡', '博斯坦村'], npcs: ['O', 'N', 'M'] });
    const join = list => list[0] + '、' + list[1] + '和' + list[2];
    assert.ok(state.requests[1][2].content.includes(
        `本次可选的地点为${join(second.locations)}，可选的相关NPC编号为${join(second.npcs)}。允许再次使用同一 NPC 或地点，但应设计不同的事件与人物诉求。`
    ));
    for (const messages of state.requests) {
        const selections = batchSelections(messages);
        const profileIds = [...messages[2].content.matchAll(/^\s+[^\n]+（([A-O])）:/gm)].map(match => match[1]);
        assert.deepEqual(profileIds.sort(), [...selections.npcs].sort(), 'the three drawn NPCs have matching biographies');
        assert.equal(new Set(selections.npcs).size, 3);
        assert.ok(!selections.npcs.includes('L'));
    }
    assert.equal(JSON.stringify(context.gameData), before, 'rolling does not reveal NPCs or mutate game state');
    assert.deepEqual(locationPool, ['伊州', '博斯坦村', '天山派外堡', '迪坎儿村']);
});

test('random draws cover all eight themes and fourteen NPCs while remaining valid', async () => {
    const { runner, state, context } = makePromptRunner();
    context.sideQuestService.getAccessibleLocations = () => ['伊州', '博斯坦村', '天山派外堡', '迪坎儿村'];
    let seed = 12345;
    context.Math = Object.create(Math);
    context.Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const themes = new Set();
    const npcs = new Set();
    for (let n = 0; n < 40; n++) {
        state.responses.push(makeRolledRumorReply(`sample-${n}`));
        assert.equal((await runner.generateRumors()).length, 3);
        const selected = batchSelections(state.requests.at(-1));
        for (const values of Object.values(selected)) assert.equal(new Set(values).size, 3);
        selected.themes.forEach(value => themes.add(value));
        selected.npcs.forEach(value => npcs.add(value));
        assert.ok(selected.locations.every(value => context.sideQuestService.getAccessibleLocations().includes(value)));
    }
    assert.deepEqual([...themes].sort(), ['寻人', '夺宝', '恩怨', '除害', '秘闻', '护送', '比武', '调解'].sort());
    assert.deepEqual([...npcs].sort(), 'ABCDEFGHIJKMNO'.split(''));
});

test('location draws use current reputation and repeat only when fewer than three places are open', async () => {
    const { runner, state, context } = makePromptRunner();
    const realService = loadService();
    context.sideQuestService.getAccessibleLocations = () => {
        realService.gameData = context.gameData;
        return realService.sideQuestService.getAccessibleLocations();
    };
    for (const reputation of [0, 10, 20, 200]) {
        context.gameData.playerStats = { 声望: reputation };
        const allowed = context.sideQuestService.getAccessibleLocations();
        state.responses.push(makeRolledRumorReply(`reputation-${reputation}`));
        assert.equal((await runner.generateRumors()).length, 3);
        const selected = batchSelections(state.requests.at(-1));
        assert.equal(selected.locations.length, 3);
        assert.ok(selected.locations.every(location => allowed.includes(location)));
        assert.equal(new Set(selected.locations).size, Math.min(3, allowed.length));
        assert.ok(!selected.locations.includes('天山派'));
        if (allowed.length >= 3) assert.equal(selected.locations.join('|'), Array.from(allowed.slice(0, 3)).join('|'));
        if (reputation === 200) assert.ok(selected.locations.includes('千佛洞'), 'high-reputation draws must expand beyond the four example locations');
    }
});

test('out-of-scope replies preserve the previous candidates and do not enter memory', async () => {
    for (const mode of ['location-order', 'unselected-location', 'unselected-npc', 'excluded-L']) {
        const { runner, state, context } = makePromptRunner();
        context.sideQuestService.getAccessibleLocations = () => ['伊州', '博斯坦村', '天山派外堡', '迪坎儿村'];
        state.responses.push(makeRolledRumorReply('existing'));
        const existing = await runner.generateRumors();
        assert.equal(existing.length, 3);
        const before = JSON.stringify(context.gameData);
        state.responses.push(makeRolledRumorReply('invalid', (batch, selected) => {
            if (mode === 'location-order') batch.rumors[0].relatedLocations = [selected.locations[1]];
            if (mode === 'unselected-location') batch.rumors[0].relatedLocations = ['迪坎儿村'];
            if (mode === 'unselected-npc') batch.rumors[0].relatedNpcs = ['O'];
            if (mode === 'excluded-L') batch.rumors[0].relatedNpcs = ['L'];
        }));
        assert.equal(await runner.generateRumors(), null, mode);
        assert.equal(runner.getRumorCandidates(), existing);
        assert.equal(state.calls, 2, 'invalid output does not trigger automatic retries');
        assert.equal(state.markCalls, 0);
        assert.equal(JSON.stringify(context.gameData), before);
        assert.match(state.notices.at(-1), /指定地点|范围外的相关 NPC/);
        state.responses.push(makeRolledRumorReply('next'));
        assert.equal((await runner.generateRumors()).length, 3);
        const remembered = recentCandidates(state.requests.at(-1));
        assert.equal(remembered.length, 3);
        assert.ok(remembered.every(rumor => rumor.title.startsWith('existing-')));
    }
});

test('legacy custom templates receive concrete selections with real newlines', async () => {
    const { runner, state, context } = makePromptRunner();
    context.promptOverrides.get = () => '自定义传闻任务：保留用户内容';
    state.responses.push(makeRolledRumorReply('first'), makeRolledRumorReply('second'));
    assert.equal((await runner.generateRumors()).length, 3);
    assert.equal((await runner.generateRumors()).length, 3);
    for (const messages of state.requests) {
        const prompt = messages[2].content;
        assert.match(prompt, /^自定义传闻任务：保留用户内容\n{2,3}本批预抽结果/);
        assert.ok(!prompt.includes('\\n'));
        const selected = batchSelections(messages);
        assert.equal(selected.themes.length, 3);
        assert.equal(selected.locations.length, 3);
        assert.equal(selected.npcs.length, 3);
        assert.equal((prompt.match(/三条题材分别为/g) || []).length, 1);
    }
    assert.equal(recentCandidates(state.requests[1]).length, 3);
});

test('default templates include each sampled requirement once without a redundant appendix', async () => {
    const { runner, state } = makePromptRunner();
    state.responses.push(makeRolledRumorReply('first'), makeRolledRumorReply('second'));
    assert.equal((await runner.generateRumors()).length, 3);
    assert.equal((await runner.generateRumors()).length, 3);
    for (const messages of state.requests) {
        const prompt = messages[2].content;
        for (const phrase of ['三条题材分别为', '3条传闻对应的地点分别为', '本次可选的相关NPC为']) {
            assert.equal(prompt.split(phrase).length - 1, 1);
        }
        assert.doesNotMatch(prompt, /本批预抽结果|本批抽选硬约束/);
    }
});

test('empty location pool keeps the current candidates and does not send a model request', async () => {
    const { runner, state, context } = makePromptRunner();
    state.responses.push(makeRumorBatch('existing'));
    await runner.generateRumors();
    const existing = runner.getRumorCandidates();
    context.sideQuestService.getAccessibleLocations = () => [];
    assert.equal(await runner.generateRumors(), null);
    assert.equal(state.calls, 1);
    assert.equal(runner.getRumorCandidates(), existing);
    assert.match(state.notices.at(-1), /当前没有可前往的支线地点/);
});

test('pending tree survives a reload and stays retryable', async () => {
    // 第一次会话：建树失败
    const first = makeRunner();
    first.state.responses.push(makeRumorBatch('batch'), JSON.stringify({ nodes: 'invalid' }));
    await first.runner.generateRumors();
    await first.runner.acceptRumor(0);
    const saved = first.state.pendingTree;
    assert.equal(saved.rumor.title, 'batch-1');

    // 读档：候选数组已失，但存档里的 pendingTree 仍在 → 仍可重试
    const second = makeRunner();
    second.state.quotaUsed = true;
    second.state.pendingTree = saved;
    const candidates = second.runner.getRumorCandidates();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].title, 'batch-1');
    assert.equal(second.runner.getTreeRetryIndex(), 0);

    second.state.responses.push(JSON.stringify(makeTree()));
    const ok = await second.runner.acceptRumor(0);
    assert.equal(ok, true, 'retry must work using only the persisted rumor');
    assert.equal(second.state.accepted, 1);
});

test('aborted tree request releases the busy overlay and keeps the retry entry', async () => {
    const { runner, state } = makeRunner();
    state.responses.push(makeRumorBatch('batch'), 'HANG');
    await runner.generateRumors();

    const pending = runner.acceptRumor(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    runner.cancel();  // 模拟读档/重生成抢占

    const accepted = await pending;
    assert.equal(accepted, false);
    assert.deepEqual(state.busy, ['show:施延年伏案疾书', 'hide'], 'overlay must be released after abort');
    assert.equal(state.pendingTree.rumor.title, 'batch-1', 'abort keeps the manual retry entry');
    assert.match(state.notices.at(-1), /重新生成剧情树/);
});

test('UI exposes batch replacement and tree retry actions', () => {
    const panel = read('module/side-quest-panel.js');
    assert.match(panel, /换一批传闻/);
    assert.match(panel, /重新生成剧情树/);
    assert.match(panel, /getTreeRetryIndex/);
    // 跨周额度恢复后不得继续锁死到旧候选
    assert.match(panel, /lockedRetryIndex/);
});
