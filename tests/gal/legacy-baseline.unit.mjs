// Phase 0 基线：把改造前 parseSlgMainText 在 GameMode 1 下对旧五元组的输出钉成快照。
// 首次运行（快照缺失）写入 fixtures/legacy-gm1.expected.json；之后每次运行都与快照深比较。
// 只比较 {text,npc,scene,emotion,cg} 子集：Phase 1 之后帧上会多 cast/time/legacy 等字段，不影响基线。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { loadParser, readFixture, read, pick } from './_sandbox.mjs';

const expectedUrl = new URL('./fixtures/legacy-gm1.expected.json', import.meta.url);
const companions = ['雨烛', '安慕'];

test('legacy GameMode 1 parse output matches frozen snapshot', async () => {
  const box = loadParser({ GameMode: 1, companionNPC: companions });
  const frames = pick(box.parse(await readFixture('legacy-gm1.txt')));
  if (!existsSync(expectedUrl)) {
    await writeFile(expectedUrl, JSON.stringify(frames, null, 2) + '\n', 'utf8');
    console.log('[gal] wrote baseline snapshot', expectedUrl.pathname);
  }
  const expected = JSON.parse(await read('tests/gal/fixtures/legacy-gm1.expected.json'));
  assert.deepEqual(frames, expected);
});

test('legacy baseline shape: rejected lines merge into next frame, tail uses last valid display', async () => {
  const box = loadParser({ GameMode: 1, companionNPC: companions });
  const frames = box.parse(await readFixture('legacy-gm1.txt'));
  // 5 frames: 开头纯文本并入第1帧；施延年(非随行)与 none 场景两行被拒并入后续；末尾残文兜底
  assert.equal(frames.length, 4);
  assert.ok(frames[0].text.startsWith('你们一行人'), '开头纯文本并入首帧');
  assert.deepEqual([frames[0].npc, frames[0].scene, frames[0].emotion, frames[0].cg], ['雨烛', '沙漠', '大笑', 'none']);
  assert.ok(frames[1].text.includes('牵驼的老汉') && frames[1].text.includes('沙王'), '非随行 NPC 行文本并入下一帧');
  assert.equal(frames[1].npc, '安慕');
  assert.ok(frames[2].text.includes('绕什么') && frames[2].text.includes('篝火'), 'none 场景行文本并入下一帧');
  assert.deepEqual([frames[2].npc, frames[2].scene, frames[2].emotion, frames[2].cg], ['雨烛', '山洞', '发情', '露胸']);
  assert.equal(frames[3].text, '天快亮的时候，你被一阵驼铃声惊醒');
  assert.deepEqual([frames[3].npc, frames[3].scene, frames[3].emotion, frames[3].cg], ['雨烛', '山洞', '发情', '露胸'], '残文沿用上一有效展示');
});

test('legacy parse: plain text without markers yields a single all-none frame; empty input yields []', () => {
  const box = loadParser({ GameMode: 1, companionNPC: companions });
  assert.deepEqual(box.parse(''), []);
  assert.deepEqual(box.parse(null), []);
  const frames = box.parse('只有正文，没有任何标记。\n\n第二段。');
  assert.equal(frames.length, 1);
  assert.deepEqual(pick(frames), [{ text: '只有正文，没有任何标记。\n\n第二段。', npc: 'none', scene: 'none', emotion: 'none', cg: 'none' }]);
});
