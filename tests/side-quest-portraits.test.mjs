import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const categories = ['正派弟子', '反派弟子', '游侠', '军士', '匪徒', '平民', '蒙面人', '野兽'];
const quiet = Object.fromEntries(['log', 'warn', 'error', 'groupCollapsed', 'groupEnd'].map((key) => [key, () => {}]));

function loadService() {
    const ctx = vm.createContext({
        console: quiet, pipeline: {}, currentWeek: 1,
        gameData: { playerStats: { 声望: 20 }, sideQuest: { active: null, history: [] } },
        syncGameDataFromVariables() {}, updateAllDisplays() {}
    });
    for (const file of ['module/template-engine.js', 'module/side-quest-service.js']) {
        vm.runInContext(read(file), ctx, { filename: file });
    }
    return ctx;
}

function makeTree(battle) {
    return { rootNodeId: 'n1', nodes: {
        n1: { type: 'stage', title: '问路', hiddenGoal: '到达客栈', onSuccess: 'n2' },
        n2: { type: 'stage', title: '抉择', hiddenGoal: '决定去向', interaction: 'choice', options: [
            { id: 'a', label: '迎战', next: 'n3' }, { id: 'b', label: '离开', next: 'n4' }
        ] },
        n3: { type: 'stage', title: '对峙', hiddenGoal: '拦住敌人', interaction: 'battle', battle: {
            enemyName: '沙州军士', level: 2, rewardGold: 1200, introText: '你横剑拦住去路。',
            winNext: 'n5', loseNext: 'n4', ...battle
        } },
        n4: { type: 'stage', title: '撤退', hiddenGoal: '脱离险地', onSuccess: 'n6' },
        n5: { type: 'ending', endingType: 'success', epilogue: '事成', rewards: {} },
        n6: { type: 'ending', endingType: 'bittersweet', epilogue: '离去', rewards: {} }
    } };
}

// 从实际脚本取顶层函数，隔离本次链路而不启动整页或调用生成 API。
function loadFunction(ctx, file, name) {
    const source = read(file);
    const start = new RegExp('^([ \\t]*)function ' + name + '\\(', 'm').exec(source);
    assert.ok(start, `${file}: ${name}`);
    const end = source.indexOf('\n' + start[1] + '}', start.index);
    assert.ok(end > start.index);
    vm.runInContext(source.slice(start.index, end + start[1].length + 2), ctx, { filename: file });
}

function bundledPrompt(key) {
    const line = read('module/prompt-data-extra.js').split('\n').find((s) => s.startsWith(`  window.PROMPT_${key} = `));
    return JSON.parse(line.slice(line.indexOf(' = ') + 3).trim().replace(/;$/, ''));
}

test('battle categories preserve explicit art choices and infer legacy enemy identities', () => {
    const { sideQuestService: service } = loadService();
    for (const category of categories) {
        assert.equal(service.resolveBattleCategory({ enemyCategory: ` ${category} `, enemyName: '沙州军士' }), category);
    }
    const cases = [
        [{ enemyCategory: '士兵', enemyName: '张三' }, '军士'],
        [{ category: '邪派弟子', enemyName: '张三' }, '反派弟子'],
        [{ enemyName: '擒生军队正' }, '军士'],
        [{ enemyName: '马贼头目' }, '匪徒'],
        [{ enemyName: '拜火教护法' }, '反派弟子'],
        [{ enemyName: '崆峒弟子' }, '正派弟子'],
        [{ enemyName: '野狼' }, '野兽'],
        [{ enemyName: '蒙面刀客' }, '蒙面人'],
        [{ enemyName: '行脚商人' }, '平民'],
        [{ enemyName: '赵三', enemyAppearance: '披甲军士，手持长刀' }, '军士'],
        [{ enemyName: '赵三', introText: '你拔剑迎向挡路的马贼。' }, '匪徒'],
        [{ enemyName: '马贼头目', introText: '你护住村民，迎向刀锋。' }, '匪徒'],
        [{ enemyCategory: '支线强敌', enemyName: '赵三' }, '游侠'],
        [{ enemyCategory: '未知', enemyName: '赵三' }, '游侠'],
        [{ enemyCategory: {}, enemyName: '赵三' }, '游侠'],
        [{ enemyName: '赵三', introText: '你护住村民，与军士一同拔剑。' }, '游侠'],
        [{}, '游侠']
    ];
    for (const [battle, expected] of cases) assert.equal(service.resolveBattleCategory(battle), expected, JSON.stringify(battle));
});

test('tree validation stores a canonical portrait category without changing combat parameters', () => {
    const ctx = loadService();
    const tree = makeTree({ enemyCategory: '未知' });
    const before = { ...tree.nodes.n3.battle };
    const result = ctx.sideQuestService.validateTree(tree, '普通');
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.deepEqual(tree.nodes.n3.battle, { ...before, enemyCategory: '军士' });
    const active = ctx.sideQuestService.acceptQuest({ relatedLocations: ['伊州'] }, tree);
    assert.equal(active.nodes.n3.battle.enemyCategory, '军士');
});

test('tree prompt exposes supported portraits and its runtime copy stays in sync', () => {
    const ctx = loadService();
    const source = read('char_card_information/211支线-剧情树生成.txt').replace(/\r\n/g, '\n');
    assert.equal(bundledPrompt('SQ_TREE'), source);
    const rendered = ctx.templateEngine.renderPromptTemplate(source, ctx.sideQuestService.buildTreeCtx({ difficulty: '普通' }));
    assert.doesNotMatch(rendered, /<%/);
    const sample = JSON.parse(rendered.slice(rendered.lastIndexOf('<SIDE_QUEST_TREE>') + '<SIDE_QUEST_TREE>'.length, rendered.lastIndexOf('</SIDE_QUEST_TREE>')));
    assert.ok(categories.includes(sample.nodes.n3.battle.enemyCategory));
    assert.ok(sample.nodes.n3.battle.enemyAppearance);
    for (const category of categories) assert.ok(rendered.includes(category));
});

test('battle buildup uses the same enemy category and appearance as the encounter', () => {
    const ctx = loadService();
    const tree = makeTree({ enemyCategory: '军士', enemyAppearance: '披甲持刀的军士' });
    ctx.gameData.sideQuest.active = { title: '客栈风波', status: 'active', nodes: tree.nodes, currentNodeId: 'n3',
        pendingInteraction: { kind: 'battle', nodeId: 'n3', state: 'buildup' } };
    ctx.PROMPT_SQ_GUIDE = bundledPrompt('SQ_GUIDE');
    assert.equal(ctx.PROMPT_SQ_GUIDE, read('char_card_information/213支线-阶段指导.txt').replace(/\r\n/g, '\n'));
    const guide = ctx.sideQuestService.buildGuideText();
    assert.match(guide, /沙州军士/);
    assert.match(guide, /披甲持刀的军士/);
    assert.doesNotMatch(guide, /<%|undefined/);
});

test('side quest encounters reach the battle URL and all four portrait states', () => {
    const ctx = loadService();
    const elements = new Map();
    const getElement = (id) => {
        if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {}, remove() {} } });
        return elements.get(id);
    };
    Object.assign(ctx, {
        window: {}, document: { getElementById: getElement, querySelector: () => null }, URLSearchParams,
        GameMode: 1, inventory: {}, difficulty: 'normal', seasonStatus: 'winter', dayNightStatus: 'daytime', equippedSkills: {},
        getTotalCombatStats: () => ({ 攻击力: 20, 生命值: 50 }), _assetUrl: (s) => s, _iframeUrl: (s) => s
    });
    for (const [file, name] of [
        ['module/game-ui.js', 'presentSideQuestBattle'], ['module/game-events.js', 'displayBattleEvent'],
        ['index.html', 'startBattle'], ['module/game-helpers.js', 'showBattleGame']
    ]) loadFunction(ctx, file, name);
    const battleHtml = read('turn-based-battle-new.html');
    vm.runInContext(battleHtml.slice(battleHtml.indexOf('const ENEMY_CATEGORIES ='), battleHtml.indexOf('// 道具系统变量')), ctx);
    for (const name of ['levenshteinDistance', 'fuzzyMatchCategory', 'getCategoryPortrait', 'getEnemyPortraitUrl']) {
        loadFunction(ctx, 'turn-based-battle-new.html', name);
    }
    ctx.commonNPCs = {};
    for (const category of categories) {
        ctx.presentSideQuestBattle(makeTree({ enemyCategory: category }).nodes.n3);
        ctx.startBattle();
        const params = new URL(getElement('battle-iframe').src, 'https://game.example/').searchParams;
        assert.equal(ctx.currentBattleType, 'sidequest');
        assert.equal(params.get('enemyCategory'), category);
        assert.equal(params.get('enemyWuxue'), '2');
        assert.equal(ctx.currentBattleEvent.敌方信息.战斗报酬.数值, 1200);
        ctx.gameState = { enemy: { name: params.get('enemyName'), category: ctx.fuzzyMatchCategory(params.get('enemyCategory')) } };
        assert.equal(ctx.getCategoryPortrait(category), `img/战斗差分_webp/${category}-待机.webp`);
        for (const state of ['待机', '攻击', '防御', '受击']) {
            const url = ctx.getEnemyPortraitUrl(state);
            assert.equal(url, `img/战斗差分_webp/${category}-${state}.webp`);
            assert.ok(fs.existsSync(new URL(url, root)), url);
        }
    }
    // 读档后旧节点未经 validateTree，呈现时仍应得到匹配的类别。
    ctx.presentSideQuestBattle(makeTree({ enemyName: '马贼头目' }).nodes.n3);
    ctx.startBattle();
    assert.equal(new URL(getElement('battle-iframe').src, 'https://game.example/').searchParams.get('enemyCategory'), '匪徒');
});
