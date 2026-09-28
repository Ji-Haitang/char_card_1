// Phase 2：时间源迁移到 MAIN_TEXT 末帧（resolveTurnTime / applyTurnTime）
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTime, readFixture } from './_sandbox.mjs';

const companions = ['雨烛', '安慕'];
const sideNote = (t) => ({ 时间: t, 当前NPC: {} });

test('last frame with time wins over SIDE_NOTE', () => {
  const box = loadTime({ GameMode: 1, companionNPC: companions });
  const { resolved, applied } = box.applyFrom(
    '甲。|沙漠|09:00|雨烛:平静|none\n乙。|绿洲|11:30|安慕:平静|none',
    sideNote('10:00'),
  );
  assert.equal(applied, true);
  assert.deepEqual(resolved, { time: '11:30', source: 'frame' });
  assert.equal(box.get('currentGameTime'), '11:30');
  assert.equal(box.get('dayNightStatus'), 'daytime');
  assert.deepEqual(box.captured, ['11:30']);
  assert.equal(box.bgCalls(), 1);
});

test('last frame time=null (out of range) → walk back to previous frame; tail plain text ignored', () => {
  const box = loadTime({ GameMode: 1, companionNPC: companions });
  const { resolved } = box.applyFrom(
    '甲。|沙漠|13:00|雨烛:平静|none\n乙。|绿洲|25:00|安慕:平静|none\n残文',
    sideNote('10:00'),
  );
  assert.deepEqual(resolved, { time: '13:00', source: 'frame' });
  assert.equal(box.get('currentGameTime'), '13:00');
});

test('no frame time (legacy text) → SIDE_NOTE.时间 fallback, same behaviour as before migration', async () => {
  const box = loadTime({ GameMode: 1, companionNPC: companions });
  const { resolved, applied } = box.applyFrom(await readFixture('legacy-gm1.txt'), sideNote('21:15'));
  assert.equal(applied, true);
  assert.deepEqual(resolved, { time: '21:15', source: 'sideNote' });
  assert.equal(box.get('currentGameTime'), '21:15');
  assert.equal(box.get('dayNightStatus'), 'night');
  assert.deepEqual(box.captured, ['21:15']);
});

test('SIDE_NOTE.时间 with surrounding text (e.g. "约 9:05 左右") still extracts HH:MM', () => {
  const box = loadTime({ GameMode: 0 });
  const { resolved } = box.applyFrom('纯文本。', sideNote('约 9:05 左右'));
  assert.deepEqual(resolved, { time: '9:05', source: 'sideNote' });
  assert.equal(box.get('currentGameTime'), '9:05');
  assert.equal(box.get('dayNightStatus'), 'daytime');
});

test('neither frames nor SIDE_NOTE → unchanged, no bridge/background side effects', () => {
  const box = loadTime({ GameMode: 0, currentGameTime: '08:00', dayNightStatus: 'daytime' });
  const a = box.applyFrom('纯文本。', null);
  assert.equal(a.applied, false);
  assert.deepEqual(a.resolved, { time: null, source: 'none' });
  const b = box.applyFrom('', { 当前NPC: {} });
  assert.equal(b.applied, false);
  assert.equal(box.get('currentGameTime'), '08:00');
  assert.equal(box.get('dayNightStatus'), 'daytime');
  assert.deepEqual(box.captured, []);
  assert.equal(box.bgCalls(), 0);
});

test('invalid SIDE_NOTE time → warn, unchanged', () => {
  const box = loadTime({ GameMode: 0, currentGameTime: '08:00' });
  const { resolved, applied } = box.applyFrom('纯文本。', sideNote('黄昏'));
  assert.equal(applied, false);
  assert.deepEqual(resolved, { time: null, source: 'invalid', raw: '黄昏' });
  assert.equal(box.get('currentGameTime'), '08:00');
  assert.ok(box.logs.some(l => l.startsWith('WARN') && l.includes('无法解析时间格式')));
  assert.equal(box.bgCalls(), 0);
});

test('day/night boundaries: 05:59 night, 06:00 day, 17:59 day, 18:00 night, 23:30 night', () => {
  const box = loadTime({ GameMode: 0 });
  const status = t => { box.applyFrom(`甲。|藏经阁|${t}|none|none`); return box.get('dayNightStatus'); };
  assert.equal(status('05:59'), 'night');
  assert.equal(status('06:00'), 'daytime');
  assert.equal(status('17:59'), 'daytime');
  assert.equal(status('18:00'), 'night');
  assert.equal(status('23:30'), 'night');
  assert.equal(box.bgCalls(), 5);
});

test('time going backwards is applied but produces a [GalTime] warn', () => {
  const box = loadTime({ GameMode: 0, currentGameTime: '21:00' });
  const { applied } = box.applyFrom('甲。|藏经阁|08:30|none|none');
  assert.equal(applied, true);
  assert.equal(box.get('currentGameTime'), '08:30');
  assert.ok(box.logs.some(l => l.startsWith('WARN') && l.includes('[GalTime] 时间回退') && l.includes('21:00') && l.includes('08:30')));
});

test('GM0 new-format fixture: last frame 08:30 wins even though earlier frames are later in the day', async () => {
  const box = loadTime({ GameMode: 0, currentGameTime: '07:00' });
  const { resolved } = box.applyFrom(await readFixture('new-gm0.txt'), sideNote('21:30'));
  assert.deepEqual(resolved, { time: '08:30', source: 'frame' });
  assert.equal(box.get('currentGameTime'), '08:30');
});

test('frames rejected by GM1 whitelist do not contribute time (parity with what is rendered)', () => {
  const box = loadTime({ GameMode: 1, companionNPC: companions });
  // 第二行 NPC 非随行 → 整帧拒收并入残文 → 其时间不生效
  const { resolved } = box.applyFrom('甲。|沙漠|09:00|雨烛:平静|none\n乙。|沙漠|12:00|施延年:平静|none', sideNote('10:00'));
  assert.deepEqual(resolved, { time: '09:00', source: 'frame' });
});
