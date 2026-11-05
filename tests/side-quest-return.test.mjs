import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const index = read('index.html');
const returnSource = index.slice(index.indexOf('        async function returnFromSLG('), index.indexOf('        // 下拉菜单控制'));

function fixture() {
    const state = { confirmations: [], messages: [], busy: false, cancellations: 0, hiddenChoice: 0, hiddenBattle: 0 };
    const node = { style: {}, classList: { add() {}, remove() {} }, querySelectorAll: () => [], querySelector: () => null };
    const context = {
        console: { log() {}, warn() {} }, window: {},
        document: { getElementById: () => node, querySelectorAll: () => [] },
        GameMode: 1, mapLocation: '伊州', companionNPC: ['H'], currentWeek: 3,
        currentSpecialEvent: '', inputEnable: 1, playerStats: { 声望: 20 },
        npcs: { H: { name: '施延年' } }, seasonStatus: 'winter', seasonNameMap: { winter: '冬天' },
        slgModeData: [], userLocation: 'shanmen', randomEvent: 0, battleEvent: 0,
        currentBattleType: null, currentBattleEvent: null, currentBattleReward: null, currentRandomEvent: null,
        gameData: { sideQuest: { active: null, history: [] }, sideQuestConfig: { enabled: true }, locationVisit: null },
        pipeline: { isBusy: () => state.busy },
        sideQuestRunner: { cancel: () => { state.cancellations++; }, notifyOutcome() {} },
        showConfirmModal: (title, message, confirm) => state.confirmations.push({ title, message, confirm }),
        handleMessageOutput: async message => { state.messages.push(message); return false; },
        hideSideQuestChoice: () => { state.hiddenChoice++; },
        hideBattleEvent: () => { state.hiddenBattle++; },
        hideRandomEvent() {}, checkAllValueRanges() {}, syncGameDataFromVariables() {}, updateAllDisplays() {},
        switchScene() {}, updateSLGReturnButton() {}, refreshNpcLocations() {}
    };
    vm.createContext(context);
    vm.runInContext(read('module/side-quest-service.js'), context);
    vm.runInContext(returnSource, context);
    context.gameData.sideQuest.active = {
        questId: 'return-ui', title: '<返程>', status: 'active', started: true,
        currentNodeId: 'n', nodes: { n: { title: '未竟之事', type: 'stage' } },
        log: [], relatedLocations: ['伊州'], relatedNpcs: ['H'], pendingInteraction: null
    };
    return { context, state };
}

test('return confirmation has no effects until confirmed and ignores stale loaded state', async () => {
    const { context: ctx, state } = fixture();
    const before = JSON.stringify(ctx.gameData);
    await ctx.returnFromSLG();
    assert.equal(JSON.stringify(ctx.gameData), before);
    assert.equal(ctx.GameMode, 1);
    assert.equal(ctx.mapLocation, '伊州');
    assert.equal(state.messages.length, 0);
    assert.equal(state.cancellations, 0);
    assert.match(state.confirmations[0].message, /任务失败/);
    assert.match(state.confirmations[0].message, /&lt;返程&gt;/);
    assert.doesNotMatch(state.confirmations[0].message, /「<返程>」/);
    // Cancelling simply never invokes the callback; reopening creates another confirmation.
    await ctx.returnFromSLG();
    ctx.gameData = JSON.parse(JSON.stringify(ctx.gameData));
    await state.confirmations[1].confirm();
    assert.equal(ctx.playerStats.声望, 20);
    assert.equal(ctx.gameData.sideQuest.active.questId, 'return-ui');
    assert.equal(state.messages.length, 0);
});

test('repeated confirmation submits a single failed return and clears waiting battle state', async () => {
    const { context: ctx, state } = fixture();
    ctx.inputEnable = 0;
    ctx.gameData.sideQuest.active.pendingInteraction = { kind: 'battle', state: 'awaiting' };
    ctx.currentBattleType = 'sidequest';
    ctx.currentBattleEvent = { 敌方信息: {} };
    ctx.currentBattleReward = { 数值: 100 };
    await ctx.returnFromSLG();
    const confirm = state.confirmations[0].confirm;
    await confirm();
    await confirm();
    await ctx.returnFromSLG();
    assert.equal(state.messages.length, 1);
    assert.equal(state.cancellations, 1);
    assert.equal(ctx.playerStats.声望, 17);
    assert.equal(ctx.gameData.sideQuest.active, null);
    assert.equal(ctx.gameData.sideQuest.history.length, 1);
    assert.equal(ctx.gameData.sideQuest.history[0].outcome, 'failed');
    assert.equal(ctx.GameMode, 0);
    assert.equal(ctx.mapLocation, '天山派');
    assert.equal(ctx.userLocation, 'tianshanpai');
    assert.equal(ctx.companionNPC.length, 0);
    assert.equal(ctx.inputEnable, 1);
    assert.equal(ctx.currentBattleType, null);
    assert.equal(ctx.currentBattleEvent, null);
    assert.equal(ctx.currentBattleReward, null);
    assert.equal(state.hiddenChoice, 1);
    assert.equal(state.hiddenBattle, 1);
    assert.match(state.messages[0], /施延年/);
    assert.match(state.messages[0], /伊州/);
    assert.match(state.messages[0], /支线因主动放弃而失败/);
    assert.ok(ctx.gameData.sideQuest.pendingReturnFailure, 'transport failure keeps the narrative context');
});

test('ordinary return before task arrival and after completion does not fail a quest', async () => {
    for (const completed of [false, true]) {
        const { context: ctx, state } = fixture();
        if (completed) ctx.gameData.sideQuest.active = null;
        else {
            ctx.gameData.sideQuest.active.started = false;
            ctx.mapLocation = '博斯坦村';
        }
        await ctx.returnFromSLG();
        assert.equal(state.confirmations.length, 0);
        assert.equal(ctx.playerStats.声望, 20);
        assert.equal(ctx.gameData.sideQuest.history.length, 0);
        assert.equal(state.messages.length, 1);
        assert.match(state.messages[0], /你结束了山下的游历/);
        if (!completed) assert.ok(ctx.gameData.sideQuest.active);
    }
});

test('busy or moved scenes reject a previously opened return confirmation', async () => {
    for (const change of [ctx => { ctx.mapLocation = '博斯坦村'; }, (_ctx, state) => { state.busy = true; }]) {
        const { context: ctx, state } = fixture();
        await ctx.returnFromSLG();
        change(ctx, state);
        await state.confirmations[0].confirm();
        assert.equal(state.messages.length, 0);
        assert.equal(ctx.playerStats.声望, 20);
        assert.ok(ctx.gameData.sideQuest.active);
    }
});
