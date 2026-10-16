// Phase 4：galPresentation GameMode 0 状态机（onCommit 门控 / enter / goto / exit / reset / 翻页纸文案）
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPresentation } from './_sandbox.mjs';

const TWO = '甲。|藏经阁|09:00|雨烛:微笑|none\n乙。|伙房|09:30|安慕:平静|none';
const THREE = TWO + '\n丙。|演武场|10:00|施延年:害羞|none';
const flush = () => new Promise(r => setTimeout(r, 0));
const imgOf = layer => layer.children[0];

function gm0(globals = {}) {
  const box = loadPresentation({ GameMode: 0, ...globals });
  return box;
}

test('onCommit does not enter when expanded / newWeek===1 / no frames / GameMode 1', async () => {
  const cases = [
    ['expanded', { isStoryExpanded: true }, TWO],
    ['newWeek', { newWeek: 1 }, TWO],
    ['no frames', {}, ''],
    ['tail only', {}, '只有一段没有标记的正文'],
    ['GameMode 1', { GameMode: 1 }, TWO],
  ];
  for (const [label, globals, text] of cases) {
    const box = gm0(globals);
    if (text) box.setFrames(text);
    assert.equal(box.pres().onCommit({ commitId: 'c1' }), false, label);
    await flush();
    assert.equal(box.pres().isPlaying(), false, label);
    assert.equal(box.layers().length, 0, label);
    assert.equal(box.bridgeCalls.curtain.length, 0, label);
    assert.equal(box.bridgeCalls.busy.length, 0, label);
  }
});

test('onCommit enters once per commitId with curtain 第一回 · detail "time · scene" · seal 话本; same id is ignored', async () => {
  const box = gm0();
  box.setFrames(TWO);
  assert.equal(box.pres().onCommit({ commitId: 'c1' }), true);
  assert.equal(box.pres().isPlaying(), true, '同步进入 playing');
  assert.equal(box.dom.body.classList.contains('gal-presenting'), true);
  assert.deepEqual(box.bridgeCalls.busy, [['gal', true]]);
  await flush();
  assert.equal(box.layers().length, 1);
  assert.equal(box.masks().length, 1);
  assert.equal(box.layers()[0].dataset.galMode, '0');
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '雨烛-微笑');
  assert.deepEqual(box.bridgeCalls.curtain, [
    { cover: true, label: '第一回', detail: '09:00 · 藏经阁', seal: '话本' },
    { cover: false, label: undefined, detail: undefined, seal: '话本' },
  ]);
  assert.equal(box.pres().onCommit({ commitId: 'c1' }), false, '同一 commitId 不重复进入');
  await flush();
  assert.equal(box.bridgeCalls.curtain.length, 2);
});

test('manual enter clamps pageIndex to the last frame; enter while playing behaves as goto', async () => {
  const box = gm0();
  box.setFrames(THREE);
  assert.equal(await box.pres().enter({ source: 'page', pageIndex: 7, curtain: true }), true);
  assert.equal(box.pres().index, 2);
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '施延年-害羞');
  assert.equal(box.bridgeCalls.curtain[0].label, '第三回');
  assert.equal(box.bridgeCalls.curtain[0].detail, '10:00 · 演武场');
  const node = box.layers()[0];
  assert.equal(await box.pres().enter({ source: 'page', pageIndex: 0, curtain: true }), true);
  assert.equal(box.pres().index, 0);
  assert.notEqual(box.layers()[0], node);
  // G19：演出中 enter 等价 goto——施延年帧 → 雨烛帧（无 CG 阵容变）播 cover+reveal 两段
  assert.equal(box.bridgeCalls.curtain.length, 4, '演出中 enter 等价 goto，按 G19 播翻页纸');
  assert.equal(box.bridgeCalls.curtain[2].label, '第一回');
});

test('mask click exits with 收卷 curtain, clears layers, releases body class and busy token', async () => {
  const box = gm0();
  box.setFrames(TWO);
  await box.pres().enter({ source: 'page', pageIndex: 1, curtain: false });
  assert.equal(box.bridgeCalls.curtain.length, 0);
  box.masks()[0].dispatch('click');
  assert.equal(box.pres().isPlaying(), false, 'exit 同步置 idle');
  await flush();
  assert.equal(box.layers().length, 0);
  assert.equal(box.masks().length, 0);
  assert.equal(box.dom.body.classList.contains('gal-presenting'), false);
  assert.deepEqual(box.bridgeCalls.busy, [['gal', true], ['gal', false]]);
  assert.deepEqual(box.bridgeCalls.curtain.map(c => [c.cover, c.label]), [[true, '收卷'], [false, undefined]]);
});

test('exit is idempotent and curtain:false clears synchronously (new-turn / special-scene path)', async () => {
  const box = gm0();
  box.setFrames(TWO);
  assert.equal(await box.pres().exit({ reason: 'noop', curtain: true }), false);
  assert.equal(box.bridgeCalls.curtain.length, 0);
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  const p = box.pres().exit({ reason: 'new-turn', curtain: false });
  assert.equal(box.layers().length, 0, '未 await 即已清层');
  assert.equal(box.dom.body.classList.contains('gal-presenting'), false);
  assert.equal(await p, true);
  assert.equal(await box.pres().exit({ reason: 'again', curtain: false }), false);
  assert.equal(box.bridgeCalls.curtain.length, 0);
});

test('G9/G12: hasPendingApply() suppresses the exit curtain but still clears', async () => {
  const box = gm0();
  box.setFrames(TWO);
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  box.bridgeState.pending = true;
  assert.equal(await box.pres().exit({ reason: 'stage-click', curtain: true }), true);
  assert.equal(box.bridgeCalls.curtain.length, 0);
  assert.equal(box.layers().length, 0);
  assert.equal(box.dom.body.classList.contains('gal-presenting'), false);
});

test('unknown scene in GM0 falls back to 天山派 seasonal background; sect location uses its own image', async () => {
  const box = gm0({ seasonStatus: 'summer', dayNightStatus: 'daytime' });
  box.setFrames('甲。|龟兹驿馆|12:00|雨烛:微笑|none\n乙。|藏经阁|12:30|雨烛:微笑|none');
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  assert.equal(imgOf(box.dom.viewport.querySelector('.slg-scene-layer')).src, 'img/location/天山派_夏_昼.webp');
  await box.pres().goto(1); // 同 cast 无 CG：G19 不播纸，但换帧统一走 chain 异步
  assert.equal(box.bridgeCalls.curtain.length, 0, '纯场景切换不播纸');
  assert.equal(imgOf(box.dom.viewport.querySelector('.slg-scene-layer')).src, 'img/location/藏经阁_昼.webp');
});

test('GM0 never flips enamor nor records __lastValid* even on 发情 frames', async () => {
  const box = gm0({ cgContentEnabled: true, randIdx: 2 });
  box.setFrames('甲。|藏经阁|09:00|雨烛:发情|露胸\n乙。|伙房|09:30|安慕:发情|none');
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: true });
  await box.pres().goto(1);
  await box.pres().exit({ reason: 'stage-click', curtain: true });
  assert.equal(box.get('enamor'), 0);
  assert.equal(box.get('window.__lastValidSceneUrl'), undefined);
  assert.equal(box.get('window.__lastValidNpcEmotionUrl'), undefined);
  assert.equal(box.get('window.__lastValidCgUrl'), undefined);
  assert.equal(box.get('window.__lastValidSlgIndex'), undefined);
});

test('reset() exits without curtain and forgets the commitId so the same commit can re-enter', async () => {
  const box = gm0();
  box.setFrames(TWO);
  assert.equal(box.pres().onCommit({ commitId: 'c9' }), true);
  await flush();
  box.bridgeCalls.curtain.length = 0;
  box.pres().reset();
  assert.equal(box.pres().isPlaying(), false);
  assert.equal(box.layers().length, 0);
  assert.equal(box.bridgeCalls.curtain.length, 0);
  assert.equal(box.pres().onCommit({ commitId: 'c9' }), true, 'reset 后同 id 可再进');
  await flush();
  assert.equal(box.pres().isPlaying(), true);
});

test('goto outside playing is a no-op false; goto clamps and repaints mask each time', async () => {
  const box = gm0();
  box.setFrames(TWO);
  assert.equal(box.pres().goto(1), false);
  assert.equal(box.layers().length, 0);
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  assert.equal(await box.pres().goto(99), true);
  assert.equal(box.pres().index, 1);
  assert.equal(box.masks().length, 1);
  assert.equal(box.layers().length, 1);
});

test('G19 播纸矩阵：CG 无↔有/不一致播；同 CG 表情变不播；无 CG 阵容变播；主次互换/表情变不播', async () => {
  const box = gm0({ randIdx: 1 });
  box.setFrames([
    '甲。|藏经阁|09:00|雨烛:微笑|none',            // 0 雨烛 无CG
    '乙。|藏经阁|09:10|雨烛:微笑|露胸',            // 1 雨烛 CG露胸（无→有，播）
    '丙。|藏经阁|09:20|雨烛:大笑|露胸',            // 2 同CG 表情变（不播）
    '丁。|藏经阁|09:30|雨烛:微笑|接吻',            // 3 CG 标记不一致（播）
    '戊。|藏经阁|09:40|安慕:微笑|接吻',            // 4 同标记换焦点 NPC（图不同，播）
    '己。|藏经阁|09:50|安慕:微笑|none',            // 5 CG 有→无（播）
    '庚。|藏经阁|10:00|雨烛:平静|none',            // 6 无CG 阵容变（播）
    '辛。|藏经阁|10:10|雨烛:微笑;安慕:平静|none',   // 7 无CG 加人（播）
    '壬。|藏经阁|10:20|安慕:大笑;雨烛:平静|none',   // 8 同两人主次互换（不播）
    '癸。|藏经阁|10:30|雨烛:害羞;安慕:平静|none',   // 9 同两人 表情变（不播）
  ].join('\n'));
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  box.bridgeCalls.curtain.length = 0;
  const go = async i => { await box.pres().goto(i); return box.bridgeCalls.curtain.length; };
  assert.equal(await go(1), 2, 'CG 无→有 播');
  assert.equal(await go(2), 2, '同 CG 仅表情变 不播');
  assert.equal(await go(3), 4, 'CG 标记不一致 播');
  assert.equal(await go(4), 6, '同标记换焦点 NPC（实际图不同）播');
  assert.equal(await go(5), 8, 'CG 有→无 播');
  assert.equal(await go(6), 10, '无 CG 阵容变 播');
  assert.equal(await go(7), 12, '无 CG 加人 播');
  assert.equal(await go(8), 12, '主次互换 不播');
  assert.equal(await go(9), 12, '仅表情变 不播');
  assert.deepEqual(box.bridgeCalls.curtain.slice(0, 2).map(c => [c.cover, c.label, c.detail, c.seal]),
    [[true, '第二回', '09:10 · 藏经阁', '话本'], [false, undefined, undefined, '话本']], '封面文案与 enter 同制');
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '雨烛-害羞');
});

test('GM0 演出场景标签：子场景帧显示子场景名、回退帧显示天山派、时间随帧有无；CG 帧标签在 CG 层之下', async () => {
  const box = gm0({ cgContentEnabled: true, randIdx: 1 });
  box.setFrames([
    '甲。|藏经阁|09:00|雨烛:微笑|none',   // 0 子场景 + 时间
    '乙。|龟兹驿馆|10:00|雨烛:微笑|none', // 1 非门派场景 → 场景图回退天山派
    '丙。|雨烛|伙房|微笑|none',           // 2 旧格式（time=null）子场景无时间
    '丁。|伙房|11:00|雨烛:微笑|露胸',     // 3 CG 帧
  ].join('\n'));
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  const readTag = () => {
    const tag = box.dom.viewport.querySelector('.slg-scene-tag');
    return {
      name: tag?.querySelector('.scene-title')?.textContent ?? null,
      time: tag?.querySelector('.slg-scene-time')?.textContent ?? null,
    };
  };
  assert.deepEqual(readTag(), { name: '藏经阁', time: '09:00' });
  await box.pres().goto(1); // 同 cast 无 CG → 不播纸
  assert.deepEqual(readTag(), { name: '天山派', time: '10:00' }, '回退天山派图的帧显示天山派');
  await box.pres().goto(2);
  assert.deepEqual(readTag(), { name: '伙房', time: null }, '旧格式帧无时间不渲染时间元素');
  await box.pres().goto(3); // 无→有 CG 播纸
  assert.deepEqual(readTag(), { name: '伙房', time: '11:00' }, 'CG 帧标签仍渲染');
  const kids = box.layers()[0].children;
  const tagIdx = kids.findIndex(el => el.classList.contains('slg-scene-tag'));
  const cgIdx = kids.findIndex(el => el.classList.contains('slg-cg-layer'));
  assert.ok(tagIdx >= 0 && cgIdx >= 0 && tagIdx < cgIdx, '标签 DOM 应在 CG 层之前（层级被 CG 盖住）');
});

test('同帧连发两个 goto 同一目标（doGoToPage 的 enter+updateStoryDisplay 双触发）只播一次纸', async () => {
  const box = gm0();
  box.setFrames(TWO); // 雨烛→安慕：无 CG 阵容变 → 播纸
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  box.bridgeCalls.curtain.length = 0;
  // 模拟 doGoToPage 同帧双触发：enter 退化的 goto + updateStoryDisplay 的 goto，均不 await
  const p1 = box.pres().enter({ source: 'page', pageIndex: 1, curtain: true });
  const p2 = box.pres().goto(1);
  assert.equal(await p1, true);
  assert.equal(await p2, true, '后到的 goto 在执行时刻被合并，视为成功');
  assert.equal(box.pres().index, 1);
  assert.equal(box.bridgeCalls.curtain.length, 2, '只播一次 cover+reveal（修复前连播两次=4 次调用）');
  assert.equal(box.bridgeCalls.curtain[0].label, '第二回');
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '安慕-平静');
  assert.equal(box.masks().length, 1);
});

test('G19：cgContentEnabled=false 时 CG 标记视为无 CG，退化为阵容判定；goto 封面期被 exit 抢先→补揭开', async () => {
  // cgContentEnabled=false：露胸→接吻 不算 CG 变化；同 cast 不播
  const box = gm0({ cgContentEnabled: false, randIdx: 1 });
  box.setFrames('甲。|藏经阁|09:00|雨烛:微笑|露胸\n乙。|藏经阁|09:10|雨烛:微笑|接吻');
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  box.bridgeCalls.curtain.length = 0;
  await box.pres().goto(1);
  assert.equal(box.bridgeCalls.curtain.length, 0, 'CG 总开关关闭时同 cast 换标记不播');
  // 封面期被 exit 抢先：补揭开并放弃换帧
  const box2 = gm0();
  box2.setFrames(TWO); // 雨烛→安慕：无 CG 阵容变 → 播纸
  await box2.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  box2.bridgeCalls.curtain.length = 0;
  const p = box2.pres().goto(1);
  await Promise.resolve(); // 让 cover 先起步（沙盒 playCurtain 一拍微任务），exit 才能打在「封面期间」
  await box2.pres().exit({ reason: 'new-turn', curtain: false });
  assert.equal(await p, false, '被 exit 抢先的 goto 放弃换帧');
  assert.deepEqual(box2.bridgeCalls.curtain.map(c => c.cover), [true, false], '盖纸后补揭开');
  assert.equal(box2.layers().length, 0);
  assert.equal(box2.pres().index, 0, '未换成帧');
});
