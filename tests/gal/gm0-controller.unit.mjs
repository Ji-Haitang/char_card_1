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
  assert.equal(box.bridgeCalls.curtain.length, 2, '演出中 enter 等价 goto，不再播翻页纸');
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
  box.pres().goto(1);
  assert.equal(imgOf(box.dom.viewport.querySelector('.slg-scene-layer')).src, 'img/location/藏经阁_昼.webp');
});

test('GM0 never flips enamor nor records __lastValid* even on 发情 frames', async () => {
  const box = gm0({ cgContentEnabled: true, randIdx: 2 });
  box.setFrames('甲。|藏经阁|09:00|雨烛:发情|露胸\n乙。|伙房|09:30|安慕:发情|none');
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: true });
  box.pres().goto(1);
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
  assert.equal(box.pres().goto(99), true);
  assert.equal(box.pres().index, 1);
  assert.equal(box.masks().length, 1);
  assert.equal(box.layers().length, 1);
});
