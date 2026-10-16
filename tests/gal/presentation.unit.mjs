// Phase 3：galPresentation.renderLayers / clearLayers（GameMode 1 回归 + 双 NPC 站位 + G6/G7 开关）
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPresentation, readFixture } from './_sandbox.mjs';

const companions = ['雨烛', '安慕'];
const gm1Opts = { mask: true, allowEnamor: true, recordLastValid: true, mode: 1 };
const gm0Opts = { mask: true, allowEnamor: false, recordLastValid: false, mode: 0, portraitFallback: true };

function render(box, frame, opts) {
  box.sandbox.__frame = frame; box.sandbox.__opts = opts;
  return box.run('galPresentation.renderLayers(document.getElementById("main-viewport"), __frame, __opts)');
}
const imgOf = layer => layer.children[0];

test('single NPC frame → one .slg-emotion-layer without cast class; scene/emotion URLs match legacy _appendSlgLayers', () => {
  const box = loadPresentation({ GameMode: 1, companionNPC: companions, mapLocation: '龟兹' });
  const [frame] = box.run('parseSlgMainText')('甲。|雨烛|沙漠|微笑|none');
  render(box, frame, gm1Opts);
  assert.equal(box.layers().length, 1);
  assert.equal(box.masks().length, 1);
  const emo = box.emotionLayers();
  assert.equal(emo.length, 1);
  assert.equal(emo[0].classList.contains('slg-cast-left'), false);
  assert.equal(emo[0].classList.contains('slg-cast-right'), false);
  assert.equal(imgOf(emo[0]).src, 'img/表情差分和CG/雨烛/表情差分/微笑.webp');
  const scene = box.dom.viewport.querySelector('.slg-scene-layer');
  assert.equal(imgOf(scene).src, 'img/location/scene_webp/龟兹/昼/沙漠.webp');
  assert.equal(box.get('window.__lastValidSceneUrl'), 'img/location/scene_webp/龟兹/昼/沙漠.webp');
  assert.equal(box.get('window.__lastValidNpcEmotionUrl'), 'img/表情差分和CG/雨烛/表情差分/微笑.webp');
  assert.equal(imgOf(emo[0]).onerror, undefined, 'GM1 不挂立绘 404 回退');
});

test('dual cast → .slg-cast-left then .slg-cast-right in cast order; focus (first) drives __lastValid* and CG', () => {
  const box = loadPresentation({ GameMode: 1, companionNPC: companions, cgContentEnabled: true, randIdx: 3 });
  const [frame] = box.run('parseSlgMainText')('甲。|沙漠|10:00|安慕:发情;雨烛:微笑|露胸');
  render(box, frame, gm1Opts);
  const emo = box.emotionLayers();
  assert.equal(emo.length, 2);
  assert.ok(emo[0].classList.contains('slg-cast-left') && !emo[0].classList.contains('slg-cast-right'));
  assert.ok(emo[1].classList.contains('slg-cast-right') && !emo[1].classList.contains('slg-cast-left'));
  assert.equal(imgOf(emo[0]).alt, '安慕-发情');
  assert.equal(imgOf(emo[1]).alt, '雨烛-微笑');
  assert.equal(box.get('window.__lastValidNpcEmotionUrl'), 'img/表情差分和CG/安慕/表情差分/发情.webp');
  const cg = box.dom.viewport.querySelector('.slg-cg-layer');
  assert.ok(cg); assert.equal(imgOf(cg).src, 'img/表情差分和CG/安慕/色图/露胸3.webp');
  assert.equal(box.get('window.__lastValidCgUrl'), 'img/表情差分和CG/安慕/色图/露胸3.webp');
  assert.equal(box.get('enamor'), 1, 'GM1 任一成员发情 → enamor');
});

test('G7 switches: allowEnamor=false keeps enamor 0; recordLastValid=false leaves __lastValid* undefined; cg disabled → no CG layer', () => {
  const box = loadPresentation({ GameMode: 0, cgContentEnabled: false });
  const [frame] = box.run('parseSlgMainText')('甲。|藏经阁|10:00|雨烛:发情|露胸');
  render(box, frame, gm0Opts);
  assert.equal(box.get('enamor'), 0);
  assert.equal(box.get('window.__lastValidSceneUrl'), undefined);
  assert.equal(box.get('window.__lastValidNpcEmotionUrl'), undefined);
  assert.equal(box.get('window.__lastValidCgUrl'), undefined);
  assert.equal(box.dom.viewport.querySelector('.slg-cg-layer'), null);
  assert.equal(box.emotionLayers().length, 1);
});

test('GM0 scene URL (G6): sect location → {name}_{昼|夜}; anything else (incl. none) → 天山派_{季}_{昼|夜}; portrait 404 fallback wired', () => {
  const box = loadPresentation({ GameMode: 0, seasonStatus: 'autumn', dayNightStatus: 'night' });
  const url = (scene) => box.run('galPresentation.sceneUrlFor')({ scene }, 0);
  assert.equal(url('藏经阁'), 'img/location/藏经阁_夜.webp');
  assert.equal(url('龟兹驿馆'), 'img/location/天山派_秋_夜.webp');
  assert.equal(url('none'), 'img/location/天山派_秋_夜.webp');
  assert.equal(url('天山派'), 'img/location/天山派_秋_夜.webp', 'tianshanpai 本身走四季图');
  const [frame] = box.run('parseSlgMainText')('甲。|龟兹驿馆|21:00|施延年:害羞|none');
  render(box, frame, gm0Opts);
  const scene = box.dom.viewport.querySelector('.slg-scene-layer');
  assert.ok(scene, 'GM0 恒有场景层');
  assert.equal(imgOf(scene).src, 'img/location/天山派_秋_夜.webp');
  const img = imgOf(box.emotionLayers()[0]);
  assert.equal(typeof img.onerror, 'function');
  img.onerror();
  assert.equal(img.src, box.get('npcPortraits[npcNameToId["施延年"]]'));
});

test('GM1 scene URL: legacySceneOptions → img/location/{name}_{昼}; none scene → no scene layer (unchanged)', () => {
  const box = loadPresentation({ GameMode: 1, companionNPC: companions, mapLocation: '龟兹' });
  const url = (scene) => box.run('galPresentation.sceneUrlFor')({ scene }, 1);
  assert.equal(url('藏经阁'), 'img/location/藏经阁_昼.webp');
  assert.equal(url('沙漠'), 'img/location/scene_webp/龟兹/昼/沙漠.webp');
  assert.equal(url('none'), null);
  const frames = box.run('parseSlgMainText')('甲。|沙漠|10:00|雨烛:微笑|none\n乙。|none|10:10|雨烛:微笑|none');
  // GM1 拒 none 场景帧，故此处直接构造一个 none 场景帧验证渲染层
  render(box, { ...frames[0], scene: 'none' }, gm1Opts);
  assert.equal(box.dom.viewport.querySelector('.slg-scene-layer'), null);
  assert.equal(box.emotionLayers().length, 1);
});

test('legacy fixture frames render identically via cast mirror (npc/emotion) — Phase 0 parity', async () => {
  const box = loadPresentation({ GameMode: 1, companionNPC: companions, cgContentEnabled: true, randIdx: 1 });
  const frames = box.run('parseSlgMainText')(await readFixture('legacy-gm1.txt'));
  for (const frame of frames) {
    box.run('galPresentation.clearLayers(document.getElementById("main-viewport"))');
    render(box, frame, gm1Opts);
    const emo = box.emotionLayers();
    if (frame.npc && frame.npc !== 'none') {
      assert.equal(emo.length, 1);
      const emotion = (frame.emotion && frame.emotion !== 'none') ? frame.emotion : '平静';
      assert.equal(imgOf(emo[0]).src, `img/表情差分和CG/${frame.npc}/表情差分/${emotion}.webp`);
      if (frame.cg && frame.cg !== 'none') assert.equal(imgOf(box.dom.viewport.querySelector('.slg-cg-layer')).src, `img/表情差分和CG/${frame.npc}/色图/${frame.cg}1.webp`);
    } else {
      assert.equal(emo.length, 0);
    }
  }
  assert.equal(box.get('enamor'), 1, '夹具含发情帧');
});

test('special CG emotion adds .slg-emotion-special-cg; mask option off → no mask; onMaskClick wired', () => {
  const box = loadPresentation({ GameMode: 1, companionNPC: companions, mapLocation: '龟兹' }); 
  const [frame] = box.run('parseSlgMainText')('甲。|沙漠|10:00|雨烛:特殊CG3|none');
  let clicked = 0;
  box.sandbox.__onMask = () => { clicked++; };
  render(box, frame, { mask: false, mode: 1 });
  assert.equal(box.masks().length, 0);
  assert.ok(box.emotionLayers()[0].classList.contains('slg-emotion-special-cg'));
  // G20 补充：特殊CG帧地点标签仍渲染（DOM 在立绘层之后），由真机 CSS 把 .slg-emotion-special-cg 抬到 z:3 盖住标签——与 NSFW CG 帧同口径
  assert.ok(box.dom.viewport.querySelector('.slg-scene-tag'), '特殊CG帧场景标签仍渲染，靠 z 序盖住而非不渲染');
  box.run('galPresentation.clearLayers(document.getElementById("main-viewport"))');
  box.run('galPresentation.renderLayers(document.getElementById("main-viewport"), __frame, { mask: true, mode: 1, onMaskClick: __onMask })');
  assert.equal(box.masks().length, 1);
  box.masks()[0].dispatch('click');
  assert.equal(clicked, 1);
});

test('clearLayers removes every container and mask; null viewport is a no-op', () => {
  const box = loadPresentation({ GameMode: 1, companionNPC: companions });
  const [frame] = box.run('parseSlgMainText')('甲。|沙漠|10:00|雨烛:微笑|none');
  render(box, frame, gm1Opts); render(box, frame, gm1Opts);
  assert.equal(box.layers().length, 2); assert.equal(box.masks().length, 2);
  box.run('galPresentation.clearLayers(null)');
  box.run('galPresentation.clearLayers(document.getElementById("main-viewport"))');
  assert.equal(box.layers().length, 0); assert.equal(box.masks().length, 0);
});

test('GM0 state machine smoke (Phase 3 acceptance): goto idempotent, exit clears viewport', async () => {
  const box = loadPresentation({ GameMode: 0 });
  box.setFrames('甲。|藏经阁|09:00|雨烛:微笑|none\n乙。|伙房|09:30|安慕:平静|none');
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  assert.equal(box.pres().isPlaying(), true);
  assert.equal(box.layers().length, 1);
  const before = box.layers()[0];
  assert.equal(box.pres().goto(0), true);
  assert.equal(box.layers()[0], before, '同页不重建节点');
  assert.equal(await box.pres().goto(1), true);
  assert.notEqual(box.layers()[0], before);
  assert.equal(box.layers().length, 1); assert.equal(box.masks().length, 1);
  assert.equal(imgOf(box.emotionLayers()[0]).alt, '安慕-平静');
  await box.pres().exit({ reason: 'test', curtain: false });
  assert.equal(box.pres().isPlaying(), false);
  assert.equal(box.layers().length, 0); assert.equal(box.masks().length, 0);
  assert.equal(box.dom.body.classList.contains('gal-presenting'), false);
});

test('3D 显示中（use3dVer）：GM0 场景走 3D.ver 连字符命名、立绘走像素目录、容器加 gal-3dver；GM1 与 3D 不可见时完全回落', () => {
  const box = loadPresentation({ GameMode: 0, seasonStatus: 'autumn', dayNightStatus: 'night' });
  const diag = (enabled, visible) => ({ preferences: { enabled }, snapshot: { visible } });
  const url = (scene) => box.run('galPresentation.sceneUrlFor')({ scene }, 0);
  // 默认假 bridge 无 getDiagnostics → use3dVer 恒 false，与现状一致
  assert.equal(url('丹房'), 'img/location/丹房_夜.webp');
  // 3D 启用且可见 → 3D.ver + 像素立绘 + gal-3dver
  box.sandbox.GameSceneBridge.getDiagnostics = () => diag(true, true);
  assert.equal(url('丹房'), 'img/location/3D.ver/丹房-秋-夜.webp');
  assert.equal(url('龟兹驿馆'), 'img/location/3D.ver/天山派-秋-夜.webp', '非门派场景回退天山派（G6 口径不变）');
  assert.equal(url('none'), 'img/location/3D.ver/天山派-秋-夜.webp');
  const [frame] = box.run('parseSlgMainText')('甲。|丹房|21:00|施延年:微笑|none');
  render(box, frame, gm0Opts);
  assert.ok(box.layers()[0].classList.contains('gal-3dver'));
  assert.equal(imgOf(box.dom.viewport.querySelector('.slg-scene-layer')).src, 'img/location/3D.ver/丹房-秋-夜.webp');
  const emoImg = imgOf(box.emotionLayers()[0]);
  assert.equal(emoImg.src, 'img/表情差分和CG/像素/施延年/微笑.webp');
  assert.equal(typeof emoImg.onerror, 'function', 'portraitFallback 仍挂');
  // 3D 启用但不可见 / 未启用 → 回落旧路径
  box.sandbox.GameSceneBridge.getDiagnostics = () => diag(true, false);
  assert.equal(url('丹房'), 'img/location/丹房_夜.webp');
  box.sandbox.GameSceneBridge.getDiagnostics = () => diag(false, true);
  assert.equal(url('丹房'), 'img/location/丹房_夜.webp');
  // GM1 即使 3D 可见也不加 gal-3dver、不走像素目录
  box.sandbox.GameSceneBridge.getDiagnostics = () => diag(true, true);
  box.run('galPresentation.clearLayers(document.getElementById("main-viewport"))');
  render(box, frame, { ...gm0Opts, mode: 1 });
  assert.ok(!box.layers()[0].classList.contains('gal-3dver'), 'GM1 不加 gal-3dver');
  assert.equal(imgOf(box.emotionLayers()[0]).src, 'img/表情差分和CG/施延年/表情差分/微笑.webp');
});

test('双人站位记忆：相邻帧同两人仅主次互换时站位不换；换人对按 cast 序；exit/enter 清空', async () => {
  const box = loadPresentation({ GameMode: 0 });
  box.setFrames('甲。|藏经阁|09:00|雨烛:微笑;安慕:平静|none\n乙。|伙房|09:30|安慕:大笑;雨烛:平静|none\n丙。|伙房|10:00|钱塘君:平静;安慕:微笑|none');
  await box.pres().enter({ source: 'page', pageIndex: 0, curtain: false });
  let emo = box.emotionLayers();
  assert.deepEqual(emo.map(l => imgOf(l).alt), ['雨烛-微笑', '安慕-平静'], '首帧按 cast 序');
  assert.ok(emo[0].classList.contains('slg-cast-left') && emo[1].classList.contains('slg-cast-right'));
  // 帧 2 cast 为 [安慕,雨烛]（主次互换）→ 站位保持：雨烛仍左、安慕仍右；同两人集合未变按 G19 不播纸
  const curtainsBefore = box.bridgeCalls.curtain.length;
  await box.pres().goto(1);
  assert.equal(box.bridgeCalls.curtain.length, curtainsBefore, '主次互换不播翻页纸');
  emo = box.emotionLayers();
  assert.deepEqual(emo.map(l => imgOf(l).alt), ['雨烛-平静', '安慕-大笑'], '同两人主次互换不调动站位');
  assert.ok(emo[0].classList.contains('slg-cast-left') && emo[1].classList.contains('slg-cast-right'));
  // 帧 3 换成另一对人 → 按自身 cast 序；阵容变按 G19 播纸
  await box.pres().goto(2);
  assert.equal(box.bridgeCalls.curtain.length, curtainsBefore + 2, '阵容变化播 cover+reveal');
  emo = box.emotionLayers();
  assert.deepEqual(emo.map(l => imgOf(l).alt), ['钱塘君-平静', '安慕-微笑'], '换了对子按新 cast 序');
  // 收卷后从帧 2 重新进入：记忆已清 → 按 cast 序（安慕左、雨烛右）
  await box.pres().exit({ reason: 'test', curtain: false });
  await box.pres().enter({ source: 'page', pageIndex: 1, curtain: false });
  emo = box.emotionLayers();
  assert.deepEqual(emo.map(l => imgOf(l).alt), ['安慕-大笑', '雨烛-平静'], 'exit/enter 清空站位记忆');
  await box.pres().exit({ reason: 'test', curtain: false });
});

test('GM1 直渲染翻页同样保持双人站位（焦点/CG 仍认 cast[0]）', () => {
  const box = loadPresentation({ GameMode: 1, companionNPC: companions, cgContentEnabled: true, randIdx: 2 });
  const frames = box.run('parseSlgMainText')('甲。|沙漠|10:00|安慕:微笑;雨烛:平静|none\n乙。|沙漠|10:10|雨烛:发情;安慕:平静|露胸');
  render(box, frames[0], gm1Opts);
  assert.deepEqual(box.emotionLayers().map(l => imgOf(l).alt), ['安慕-微笑', '雨烛-平静']);
  box.run('galPresentation.clearLayers(document.getElementById("main-viewport"))');
  render(box, frames[1], gm1Opts);
  const emo = box.emotionLayers();
  assert.deepEqual(emo.map(l => imgOf(l).alt), ['安慕-平静', '雨烛-发情'], '站位不随主次互换');
  assert.ok(emo[0].classList.contains('slg-cast-left') && emo[1].classList.contains('slg-cast-right'));
  // 焦点仍是 cast[0]（雨烛）→ CG 与 __lastValidNpcEmotionUrl 按雨烛取
  assert.equal(imgOf(box.dom.viewport.querySelector('.slg-cg-layer')).src, 'img/表情差分和CG/雨烛/色图/露胸2.webp');
  assert.equal(box.get('window.__lastValidNpcEmotionUrl'), 'img/表情差分和CG/雨烛/表情差分/发情.webp');
});

test('cnNumber for curtain labels', () => {
  const box = loadPresentation({ GameMode: 0 });
  const cn = box.run('galPresentation.cnNumber');
  assert.equal(cn(1), '一'); assert.equal(cn(10), '十'); assert.equal(cn(11), '十一'); assert.equal(cn(20), '二十'); assert.equal(cn(37), '三十七'); assert.equal(cn(0), '一');
});

test('scene tag: GM1 恒显示 mapLocation；该帧有时间才渲染小字时间；CG 帧标签在 CG 层之下', () => {
  const box = loadPresentation({ GameMode: 1, companionNPC: companions, mapLocation: '龟兹', cgContentEnabled: true, randIdx: 1 });
  const readTag = () => {
    const tag = box.dom.viewport.querySelector('.slg-scene-tag');
    return {
      name: tag?.querySelector('.scene-title')?.textContent ?? null,
      time: tag?.querySelector('.slg-scene-time')?.textContent ?? null,
    };
  };
  // 新格式帧：有时间 → 标签=mapLocation + 时间
  const [f1] = box.run('parseSlgMainText')('甲。|沙漠|10:00|雨烛:微笑|none');
  render(box, f1, gm1Opts);
  assert.deepEqual(readTag(), { name: '龟兹', time: '10:00' }, 'GM1 标签显示 mapLocation 而非帧场景名');
  // 旧格式帧：time=null → 不渲染时间元素，标签仍显示 mapLocation
  box.run('galPresentation.clearLayers(document.getElementById("main-viewport"))');
  const [f2] = box.run('parseSlgMainText')('乙。|雨烛|沙漠|微笑|none');
  render(box, f2, gm1Opts);
  assert.deepEqual(readTag(), { name: '龟兹', time: null }, '旧格式无时间不渲染时间元素');
  // CG 帧：标签仍渲染但 DOM 序先于 .slg-cg-layer（z:2 < z:3，被 CG 盖住）
  box.run('galPresentation.clearLayers(document.getElementById("main-viewport"))');
  const [f3] = box.run('parseSlgMainText')('丙。|沙漠|11:00|雨烛:微笑|露胸');
  render(box, f3, gm1Opts);
  assert.deepEqual(readTag(), { name: '龟兹', time: '11:00' }, 'CG 帧标签仍渲染');
  const kids = box.dom.viewport.querySelector('.slg-layer-container').children;
  const tagIdx = kids.findIndex(el => el.classList.contains('slg-scene-tag'));
  const cgIdx = kids.findIndex(el => el.classList.contains('slg-cg-layer'));
  assert.ok(tagIdx >= 0 && cgIdx >= 0 && tagIdx < cgIdx, '标签 DOM 应在 CG 层之前（层级被 CG 盖住）');
});
