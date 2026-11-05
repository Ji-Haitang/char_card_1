// GM1 换段复用 GM0 的 G19 翻页规则，覆盖队列、过期动画与真实分页入口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPresentation, read } from './_sandbox.mjs';

const TWO = '甲。|沙漠|09:00|雨烛:微笑|none\n乙。|沙漠|09:30|安慕:平静|none';
const OPTS = { mask: true, allowEnamor: true, recordLastValid: true, mode: 1 };
const uiSource = await read('module/game-ui.js');
const imgOf = layer => layer.children[0];
const gm1 = (globals = {}) => loadPresentation({
  GameMode: 1, companionNPC: ['雨烛', '安慕'], mapLocation: '龟兹', randIdx: 1, ...globals,
});
const go = (box, index) => box.pres().gotoSlg(index, OPTS);

function holdCover(box) {
  let release;
  const original = box.sandbox.GameSceneBridge.playCurtain;
  box.sandbox.GameSceneBridge.playCurtain = (...args) => {
    original(...args);
    return args[0] ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  };
  return () => { assert.equal(typeof release, 'function', 'cover has started'); release(); };
}

function storyUi(globals = {}) {
  const box = gm1({ storyHistoryOffset: 0, currentStoryText: '', ...globals });
  box.sandbox.markdownit = () => ({ disable() { return this; }, render: text => `<p>${text}</p>` });
  box.sandbox._getAssistantTurns = () => [];
  const wrapper = box.dom.document.createElement('div');
  const story = box.dom.document.createElement('div'); story.id = 'story-text';
  wrapper.appendChild(story); story.parentElement = wrapper; box.dom.body.appendChild(wrapper);
  const scene = box.dom.document.createElement('div'); scene.id = 'map-scene'; scene.className = 'scene active';
  box.dom.viewport.appendChild(scene);
  box.run(uiSource.slice(uiSource.indexOf('function _slgLayerOptsGm1()'), uiSource.indexOf('// 更新日期显示')));
  box.run(uiSource.slice(uiSource.indexOf('function updateStoryText(text)'), uiSource.indexOf('\n// =========================================================================', uiSource.indexOf('function updateStoryDisplay()'))));
  box.run(uiSource.slice(uiSource.indexOf('function doGoToPage(pageNum)'), uiSource.indexOf('// 显示弹窗', uiSource.indexOf('function doGoToPage(pageNum)'))));
  return box;
}

test('GM1 first frame renders synchronously with existing side effects and no GM0 enter/exit state', () => {
  const box = gm1();
  box.setFrames('甲。|沙漠|09:00|雨烛:发情|露胸');
  assert.equal(go(box, 0), true);
  assert.equal(box.layers().length, 1);
  assert.equal(box.masks().length, 1);
  assert.equal(box.layers()[0].dataset.galMode, '1');
  assert.equal(box.get('enamor'), 1);
  assert.equal(box.get('window.__lastValidSlgIndex'), 0);
  assert.equal(box.get('window.__lastValidNpcEmotionUrl'), 'img/表情差分和CG/雨烛/表情差分/发情.webp');
  assert.equal(box.pres().isPlaying(), false);
  assert.equal(box.dom.body.classList.contains('gal-presenting'), false);
  assert.deepEqual(box.bridgeCalls, { busy: [], curtain: [] });
});

test('GM1 and GM0 use the same G19 matrix and curtain copy for CG/cast changes', async () => {
  const text = [
    '甲。|沙漠|09:00|雨烛:微笑|none',
    '乙。|沙漠|09:10|雨烛:微笑|露胸',
    '丙。|沙漠|09:20|雨烛:大笑|露胸',
    '丁。|沙漠|09:30|雨烛:微笑|接吻',
    '戊。|沙漠|09:40|安慕:微笑|接吻',
    '己。|沙漠|09:50|安慕:微笑|none',
    '庚。|沙漠|10:00|雨烛:平静|none',
    '辛。|沙漠|10:10|雨烛:微笑;安慕:平静|none',
    '壬。|沙漠|10:20|安慕:大笑;雨烛:平静|none',
    '癸。|沙漠|10:30|雨烛:害羞;安慕:平静|none',
  ].join('\n');
  const downhill = gm1(), sect = loadPresentation({ GameMode: 0, randIdx: 1 });
  downhill.setFrames(text); sect.setFrames(text);
  go(downhill, 0);
  await sect.pres().enter({ pageIndex: 0, curtain: false });
  const expected = [2, 2, 4, 6, 8, 10, 12, 12, 12];
  for (let i = 1; i < 10; i++) {
    await go(downhill, i); await sect.pres().goto(i);
    assert.equal(downhill.bridgeCalls.curtain.length, expected[i - 1], `frame ${i}`);
    assert.deepEqual(downhill.bridgeCalls.curtain, sect.bridgeCalls.curtain);
  }
  assert.deepEqual(downhill.bridgeCalls.curtain[0], { cover: true, label: '第二回', detail: '09:10 · 沙漠', seal: '话本' });
  assert.deepEqual(downhill.emotionLayers().map(layer => imgOf(layer).alt), ['雨烛-害羞', '安慕-平静']);
});

test('GM1 scene image change flips the page even with the same cast and no CG; same scene does not', async () => {
  const box = gm1();
  box.setFrames('甲。|沙漠|09:00|雨烛:微笑|none\n乙。|沙漠|09:10|雨烛:大笑|none\n丙。|客栈|09:20|雨烛:大笑|none');
  go(box, 0);
  await go(box, 1);
  assert.equal(box.bridgeCalls.curtain.length, 0, 'same scene, expression only');
  await go(box, 2);
  assert.deepEqual(box.bridgeCalls.curtain.map(c => c.cover), [true, false], 'scene change plays cover+reveal');
  assert.match(box.bridgeCalls.curtain[0].detail, /^09:20 · /);
});

test('GM1 keeps the old layers and last-valid index until the sheet covers the viewport', async () => {
  const box = gm1(); box.setFrames(TWO); go(box, 0);
  const layer = box.layers()[0], release = holdCover(box);
  const task = go(box, 1);
  await Promise.resolve();
  assert.equal(box.layers()[0], layer);
  assert.equal(box.get('window.__lastValidSlgIndex'), 0);
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '雨烛-微笑');
  release();
  assert.equal(await task, true);
  assert.notEqual(box.layers()[0], layer);
  assert.equal(box.get('window.__lastValidSlgIndex'), 1);
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '安慕-平静');
  assert.deepEqual(box.bridgeCalls.curtain.map(call => call.cover), [true, false]);
});

test('GM1 merges duplicate targets and preserves rapid forward/back click order, including return to the displayed page', async () => {
  const box = gm1(); box.setFrames(TWO); go(box, 0);
  const tasks = [go(box, 1), go(box, 1), go(box, 0)];
  assert.deepEqual(await Promise.all(tasks), [true, true, true]);
  assert.deepEqual(box.bridgeCalls.curtain.filter(call => call.cover).map(call => call.label), ['第二回', '第一回']);
  assert.equal(box.get('window.__lastValidSlgIndex'), 0);
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '雨烛-微笑');
  assert.equal(box.layers().length, 1); assert.equal(box.masks().length, 1);
});

test('GM1 respects the CG setting and refreshes same-page settings without a curtain', async () => {
  const box = gm1({ cgContentEnabled: false });
  box.setFrames('甲。|沙漠|09:00|雨烛:微笑|露胸\n乙。|沙漠|09:30|雨烛:大笑|接吻');
  go(box, 0); await go(box, 1);
  assert.equal(box.bridgeCalls.curtain.length, 0);
  assert.equal(box.dom.viewport.querySelector('.slg-cg-layer'), null);
  box.set('cgContentEnabled', true); go(box, 1);
  assert.ok(box.dom.viewport.querySelector('.slg-cg-layer'));
  box.set('cgContentEnabled', false); go(box, 1);
  assert.equal(box.dom.viewport.querySelector('.slg-cg-layer'), null);
  assert.equal(box.bridgeCalls.curtain.length, 0);
});

test('real GM1 same-page refresh during reveal applies the CG switch without another curtain', async () => {
  const box = storyUi();
  box.run('updateStoryText')('甲。|沙漠|09:00|雨烛:微笑|none\n乙。|沙漠|09:30|雨烛:微笑|露胸');
  let revealStarted, releaseReveal;
  const revealing = new Promise(resolve => { revealStarted = resolve; });
  const original = box.sandbox.GameSceneBridge.playCurtain;
  box.sandbox.GameSceneBridge.playCurtain = (...args) => {
    original(...args);
    if (args[0]) return Promise.resolve();
    revealStarted();
    return new Promise(resolve => { releaseReveal = resolve; });
  };
  box.run('doNextPage()');
  await revealing;
  assert.ok(box.dom.viewport.querySelector('.slg-cg-layer'), 'the new frame is already painted during reveal');
  box.run('cgContentEnabled = false; updateStoryDisplay();');
  const refreshed = go(box, 1);
  releaseReveal();
  assert.equal(await refreshed, true);
  assert.equal(box.dom.viewport.querySelector('.slg-cg-layer'), null, 'the queued same-page refresh must apply the new setting');
  assert.deepEqual(box.bridgeCalls.curtain.map(call => call.cover), [true, false], 'refresh does not replay the curtain');
  assert.equal(box.layers().length, 1); assert.equal(box.masks().length, 1);
});

test('GM1 stale covers reveal without repainting after reset, clear, external removal, new frames, mode change or expansion', async () => {
  for (const kind of ['reset', 'clear', 'external-remove', 'frames', 'mode', 'expand']) {
    const box = gm1(); box.setFrames(TWO); go(box, 0);
    const layer = box.layers()[0], release = holdCover(box), task = go(box, 1);
    await Promise.resolve();
    if (kind === 'reset') {
      box.pres().reset();
      assert.equal(box.layers().length, 0, 'reset clears GM1 layers synchronously');
      assert.equal(box.masks().length, 0, 'reset clears GM1 masks synchronously');
    }
    if (kind === 'clear') box.pres().clearLayers(box.dom.viewport);
    if (kind === 'external-remove') { layer.remove(); box.masks()[0].remove(); }
    if (kind === 'frames') box.setFrames('新回合。|沙漠|11:00|雨烛:平静|none');
    if (kind === 'mode') box.set('GameMode', 0);
    if (kind === 'expand') box.set('isStoryExpanded', true);
    release();
    assert.equal(await task, false, kind);
    assert.equal(box.get('window.__lastValidSlgIndex'), 0, kind);
    assert.deepEqual(box.bridgeCalls.curtain.map(call => call.cover), [true, false], kind);
    assert.equal(box.layers().length, ['reset', 'clear', 'external-remove'].includes(kind) ? 0 : 1, kind);
    if (box.layers().length) assert.equal(box.layers()[0], layer, kind);
  }
});

test('GM1 new-text replacement during a cover keeps the new frame after the old cover settles', async () => {
  const box = gm1(); box.setFrames(TWO); go(box, 0);
  const release = holdCover(box), task = go(box, 1);
  await Promise.resolve();
  box.pres().reset(); box.pres().clearLayers(box.dom.viewport);
  box.setFrames('新回合。|沙漠|11:00|雨烛:害羞|none'); go(box, 0);
  const replacement = box.layers()[0];
  release();
  assert.equal(await task, false);
  assert.equal(box.layers()[0], replacement);
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '雨烛-害羞');
});

test('GM1 without a bridge still changes paragraphs and masks normally', async () => {
  const box = gm1(); delete box.sandbox.GameSceneBridge;
  box.setFrames(TWO); go(box, 0);
  assert.equal(await go(box, 1), true);
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '安慕-平静');
  assert.equal(box.masks().length, 1);
});

test('real GM1 story navigation retains the previous layers, turns pages, and clamps event pages to the last frame', async () => {
  const box = storyUi();
  box.run('updateStoryText')(TWO);
  const first = box.layers()[0];
  box.run('doNextPage()');
  assert.equal(box.layers()[0], first, 'updateStoryDisplay must not clear the previous frame before cover');
  await go(box, 1);
  assert.equal(box.get('currentPage'), 1);
  assert.equal(box.get('window.__lastValidSlgIndex'), 1);
  assert.equal(box.bridgeCalls.curtain.length, 2);
  box.run('storyPages.push("event"); doNextPage();');
  assert.equal(box.get('currentPage'), 2);
  assert.equal(box.get('window.__lastValidSlgIndex'), 1);
  assert.equal(box.bridgeCalls.curtain.length, 2, 'event page reuses last frame without another turn');
  box.run('doGoToPage(0)'); await go(box, 0);
  assert.equal(box.bridgeCalls.curtain.length, 4, 'previous-page navigation also turns');
});

test('real GM1 expanded reading preserves the image and new text still builds a fresh frame', async () => {
  const box = storyUi(); box.run('updateStoryText')(TWO);
  box.run('doNextPage()'); await go(box, 1);
  const current = box.layers()[0], turns = box.bridgeCalls.curtain.length;
  box.run('doToggleStoryExpand()');
  assert.equal(box.get('isStoryExpanded'), true);
  assert.equal(box.layers()[0], current);
  assert.equal(box.bridgeCalls.curtain.length, turns);
  box.run('updateStoryText')('新回合。|客栈|11:00|雨烛:害羞|none');
  assert.equal(box.layers().length, 1);
  assert.notEqual(box.layers()[0], current);
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '雨烛-害羞');
  assert.equal(box.bridgeCalls.curtain.length, turns, 'new text/stream updates do not turn on every chunk');
  assert.equal(box.get('window.__lastValidSlgIndex'), 0);
});
