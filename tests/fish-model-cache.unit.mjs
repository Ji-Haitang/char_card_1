import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './media-speech-fixture.mjs';

test('同一待办换模型保留两套录音；旧 D3 消息仍从自己的录音库回听', async () => {
    const h = harness();
    await h.configure(true);
    const round = h.get('speechRound');
    const config = h.get('speechConfig');
    await round.withLease('main', async () => {
        await config.save({ provider: { kind: 'fish-drama3', model: 'drama-3' } });
        const first = await round.prepare(await h.createDraft());
        const original = round.record(first);
        // 老档不记录模型字段，以此前的回合键与渲染指纹读取。
        delete original.audioModel;
        const oldTurn = h.turns.get(JSON.stringify(['main', original.audioTurnId]));
        delete oldTurn.model;
        await config.save({ provider: { kind: 'fish-drama3', model: 's2.1-pro' } });
        const captured = await round.settings('main');
        const next = await round.prepare(first, { adoptSettings: captured.fingerprint });
        const current = round.record(next);
        assert.notEqual(original.audioTurnId, current.audioTurnId);
        assert.equal(h.requests.length, 4);
        for (const metadata of [original, current]) {
            const binding = await round.replay({ content: first.input.mainText, roundSpeech: metadata }, first.readingPlan, null);
            assert.equal(binding.units.length, 2);
            assert.ok((await round.clip(binding, binding.units[0])).size > 0);
        }
        assert.equal(h.requests.length, 4);
    });
});
