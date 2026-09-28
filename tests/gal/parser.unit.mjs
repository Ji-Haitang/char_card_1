// Phase 1：GalParser 新格式 / GameMode 0 白名单 / 兼容旧格式 单测
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadParser, readFixture, read, pick, plain, uiHasParserBlock } from './_sandbox.mjs';

assert.ok(uiHasParserBlock(), 'game-ui.js 应含 GAL_PARSER_BEGIN/END 切片标记');
const companions = ['雨烛', '安慕'];

test('legacy GM1 through GalParser still equals Phase 0 snapshot (byte-for-byte subset)', async () => {
  const box = loadParser({ GameMode: 1, companionNPC: companions });
  const frames = box.parse(await readFixture('legacy-gm1.txt'));
  assert.deepEqual(pick(frames), JSON.parse(await read('tests/gal/fixtures/legacy-gm1.expected.json')));
  for (const f of frames) { assert.equal(f.legacy, true); assert.equal(f.time, null); assert.ok(f.cast.length <= 1); }
  assert.equal(frames.at(-1).tail, true);
});

test('new format GM1: dual cast order/focus, fullwidth separators, tail fallback, plain head merged', async () => {
  const box = loadParser({ GameMode: 1, companionNPC: companions });
  const frames = box.parse(await readFixture('new-gm1.txt'));
  assert.equal(frames.length, 4);
  const [a, b, c, tail] = frames;
  assert.ok(a.text.startsWith('出了山门') && a.text.includes('水囊'), '开头纯文本并入首帧');
  assert.equal(a.legacy, false); assert.equal(a.time, '10:00'); assert.equal(a.scene, '沙漠');
  assert.deepEqual(a.cast, [{ npc: '雨烛', emotion: '微笑' }, { npc: '安慕', emotion: '不满' }]);
  assert.equal(a.npc, '雨烛'); assert.equal(a.emotion, '微笑');
  assert.deepEqual(b.cast, [{ npc: '雨烛', emotion: '严肃' }]); assert.equal(b.time, '11:30'); assert.equal(b.scene, '绿洲');
  assert.deepEqual(c.cast, [{ npc: '安慕', emotion: '平静' }, { npc: '雨烛', emotion: '发情' }]);
  assert.equal(c.npc, '安慕', '首个为焦点'); assert.equal(c.cg, '露胸'); assert.equal(c.time, '22:00');
  assert.equal(tail.tail, true); assert.equal(tail.text, '天快亮的时候，远处传来一阵驼铃');
  assert.deepEqual(tail.cast, c.cast); assert.equal(tail.scene, '山洞');
});

test('new format GM1: non-companion cast members are dropped; frame with only invalid cast is rejected (merged into next)', () => {
  const box = loadParser({ GameMode: 1, companionNPC: companions });
  const frames = box.parse([
    '甲。|沙漠|09:00|施延年:平静;雨烛:微笑|none',
    '乙。|沙漠|09:10|施延年:平静|none',
    '丙。|沙漠|09:20|安慕:平静|none',
  ].join('\n'));
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0].cast, [{ npc: '雨烛', emotion: '微笑' }]);
  assert.equal(frames[1].text, '乙。\n\n丙。');
  assert.deepEqual(frames[1].cast, [{ npc: '安慕', emotion: '平静' }]);
  assert.ok(box.logs.some(l => l.includes('丢弃不合法 NPC') && l.includes('施延年')));
});

test('new format GM1: none scene is still rejected (G14 behaviour parity with legacy)', () => {
  const box = loadParser({ GameMode: 1, companionNPC: companions });
  const frames = box.parse('甲。|none|09:00|雨烛:微笑|none\n乙。|沙漠|09:10|雨烛:平静|none');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].text, '甲。\n\n乙。');
});

test('new format GM0 fixture: whitelist = full roster, strict match, no fuzzy, scenes passthrough, frames never rejected', async () => {
  const box = loadParser({ GameMode: 0, companionNPC: [] });
  const frames = box.parse(await readFixture('new-gm0.txt'));
  assert.equal(frames.length, 10, 'GM0 每个标记行都是一帧');
  assert.ok(frames.every(f => !f.legacy && !f.tail));
  // 1 双 NPC 半角
  assert.deepEqual(frames[0].cast, [{ npc: '雨烛', emotion: '微笑' }, { npc: '安慕', emotion: '平静' }]);
  assert.equal(frames[0].time, '07:30'); assert.equal(frames[0].scene, '演武场');
  // 2 全角 ：；
  assert.deepEqual(frames[1].cast, [{ npc: '雨烛', emotion: '大笑' }, { npc: '安慕', emotion: '得意' }]);
  // 3 路人丢弃、“雨烛姑娘”命中
  assert.deepEqual(frames[2].cast, [{ npc: '雨烛', emotion: '微笑' }]);
  assert.equal(frames[2].scene, '山门');
  // 4 缺表情 → none；8:05 → 08:05；“破阵子长老”命中
  assert.deepEqual(frames[3].cast, [{ npc: '破阵子', emotion: 'none' }]); assert.equal(frames[3].time, '08:05');
  // 5 none cast
  assert.deepEqual(frames[4].cast, []); assert.equal(frames[4].npc, 'none'); assert.equal(frames[4].emotion, 'none');
  // 6 非门派场景原样保留（渲染层负责回退）
  assert.equal(frames[5].scene, '龟兹驿馆'); assert.deepEqual(frames[5].cast, [{ npc: '施延年', emotion: '害羞' }]);
  // 7 三个 NPC 只取前两个
  assert.deepEqual(frames[6].cast, [{ npc: '唐沐梨', emotion: '严肃' }, { npc: '洛潜幽', emotion: '不满' }]);
  // 8 “唐沐梨的侍女”（长度 6 > 3+2）丢弃，同段唐沐梨保留且不重复
  assert.deepEqual(frames[7].cast, [{ npc: '唐沐梨', emotion: '平静' }]);
  // 9 CG
  assert.equal(frames[8].cg, '露胸'); assert.equal(frames[8].emotion, '发情');
  // 10 时间倒退合法，仅原样记录
  assert.equal(frames[9].time, '08:30');
  assert.ok(box.logs.some(l => l.includes('路过的百姓')));
  assert.ok(box.logs.some(l => l.includes('唐沐梨的侍女')));
});

test('GM0 strict NPC match: no similarity layer, +2 suffix tolerance, exact id', () => {
  const box = loadParser({ GameMode: 0 });
  const strict = (tok) => box.run('GalParser.strictMatchNpc')(tok, box.get('Object.keys(npcs).map(id => ({ id, name: npcs[id].name }))'));
  assert.equal(strict('雨烛'), '雨烛');
  assert.equal(strict('H'), '雨烛');
  assert.equal(strict('雨烛姑娘'), '雨烛');
  assert.equal(strict('雨烛姑娘和众人'), null);
  assert.equal(strict('萧白瑚师姐'), '萧白瑚');
  assert.equal(strict('唐沐梨的侍女'), null);
  // 相似度 ≥0.6 但不包含全名（“破阵字” vs “破阵子” = 0.67）：matchNPC 会误命中，strict 必须拒绝
  const fuzzy = box.run('matchNPC')('破阵字');
  assert.equal(fuzzy, '破阵子', '前提：matchNPC 会模糊命中');
  assert.equal(strict('破阵字'), null);
  assert.equal(strict('none'), 'none');
});

test('GM0 legacy special-event sample: parsed, legacy=true, time=null, scene passthrough, non-roster NPC → none', async () => {
  const box = loadParser({ GameMode: 0 });
  const frames = box.parse(await readFixture('legacy-special-event.txt'));
  assert.equal(frames.length, 5);
  for (const f of frames) { assert.equal(f.legacy, true); assert.equal(f.time, null); }
  assert.deepEqual(frames[0].cast, [{ npc: '施延年', emotion: '悲伤' }]); assert.equal(frames[0].scene, '藏经阁');
  assert.equal(frames[2].npc, 'none'); assert.equal(frames[2].emotion, '悲伤'); assert.deepEqual(frames[2].cast, []);
  assert.equal(frames[3].scene, '武侠门派', 'GM0 不走 matchScene，原样保留');
});

test('GM0 legacy: non-roster NPC in legacy line is dropped but frame kept', () => {
  const box = loadParser({ GameMode: 0 });
  const frames = box.parse('甲。|路人甲|藏经阁|平静|none');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].npc, 'none'); assert.deepEqual(frames[0].cast, []); assert.equal(frames[0].emotion, '平静');
  assert.ok(box.logs.some(l => l.includes('非花名册 NPC')));
});

test('time parsing edge cases', () => {
  const box = loadParser({ GameMode: 0 });
  const parseTime = box.run('GalParser.parseTime');
  assert.equal(parseTime('8:05'), '08:05');
  assert.equal(parseTime('23：59'), '23:59');
  assert.equal(parseTime('25:00'), null, '越界：新格式但 time=null');
  assert.equal(parseTime('藏经阁'), undefined, '非时间 → 旧格式');
  assert.equal(parseTime('12:5'), undefined);
  const frames = box.parse('甲。|藏经阁|25:00|雨烛:平静|none');
  assert.equal(frames[0].legacy, false); assert.equal(frames[0].time, null); assert.equal(frames[0].scene, '藏经阁');
});

test('GalParser.lastTime: last valid time, skipping null tails', () => {
  const box = loadParser({ GameMode: 0 });
  const lastTime = box.run('GalParser.lastTime');
  const frames = plain(box.run('parseSlgMainText')('甲。|藏经阁|09:00|none|none\n乙。|伙房|25:00|none|none\n残文'));
  assert.equal(frames.length, 3);
  assert.equal(lastTime(frames), '09:00');
  assert.equal(lastTime([]), null);
  assert.equal(lastTime(box.parse('只有正文')), null);
});

test('plain text → single tail frame; empty → []; explicit mode argument overrides GameMode global', () => {
  const box = loadParser({ GameMode: 1, companionNPC: [] });
  assert.deepEqual(box.parse(''), []);
  const frames = box.parse('纯文本。');
  assert.equal(frames.length, 1); assert.equal(frames[0].tail, true); assert.equal(frames[0].npc, 'none');
  // GameMode 全局=1 且无随行，显式 mode=0 应走花名册白名单
  const gm0 = plain(box.run('parseSlgMainText')('甲。|藏经阁|09:00|雨烛:平静|none', 0));
  assert.deepEqual(gm0[0].cast, [{ npc: '雨烛', emotion: '平静' }]);
  const gm1 = box.parse('甲。|藏经阁|09:00|雨烛:平静|none');
  assert.equal(gm1.length, 1, 'GM1 无随行：雨烛被拒 → 帧拒收 → 残文兜底成 1 帧');
  assert.equal(gm1[0].tail, true);
});
