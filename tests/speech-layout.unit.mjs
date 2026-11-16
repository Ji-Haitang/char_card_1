import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { harness, FAKE_KEY } from './media-speech-fixture.mjs';

const root = new URL('../', import.meta.url);
test('speech has eight core files, a single ordered HTML load and one game-facing entry', () => {
    const names = ['config.js', 'msgpack.js', 'plan.js', 'playback.js', 'provider.js', 'runtime.js', 'service.js', 'store.js'];
    assert.deepEqual(fs.readdirSync(new URL('module/speech/', root)).sort(), names);
    const html = fs.readFileSync(new URL('index.html', root), 'utf8');
    const scripts = [...html.matchAll(/src="(module\/speech\/[^"?]+)\?/g)].map(m => m[1]);
    assert.deepEqual(scripts, ['msgpack', 'provider', 'plan', 'config', 'store', 'playback', 'runtime', 'service'].map(n => 'module/speech/' + n + '.js'));
    for (const name of ['pipeline', 'game-ui', 'presentation-actions', 'presentation-reader', 'media-context']) {
        const source = fs.readFileSync(new URL('module/' + name + '.js', root), 'utf8');
        assert.doesNotMatch(source, /\bspeech(?:Turn|Round|Plan|InlinePlayer|SingleTest|RoundPlayback)\b/);
    }
    const h = harness(), service = h.get('speechService'), turn = h.get('speechTurn');
    assert.equal(service.beginTurn, turn.begin);
    assert.equal(service.finishTurn, turn.finish);
    assert.equal(service.guardProgress, turn.guardProgress);
    assert.equal(service.loadPending, h.get('speechRound').load);
});

test('existing D3 credentials and bindings survive projection and explicit save', async () => {
    const h = harness(), config = h.get('speechConfig');
    const saved = { enabled: true, provider: { kind: 'fish-drama3', apiKey: FAKE_KEY, speed: 1.15 }, voices: { A: { kind: 'fish-drama3', speakerId: 'current-voice', version: '3' } }, parser: { useMain: true, config: {} } };
    h.settings.set('config:main', structuredClone(saved));
    const projected = await config.get();
    assert.equal(projected.provider.apiKey, FAKE_KEY);
    assert.deepEqual(projected.voices, saved.voices);
    assert.equal('parser' in projected, false);
    assert.equal(h.writes.length, 0);
    assert.deepEqual(h.settings.get('config:main'), saved);
    const updated = await config.save({ provider: { kind: 'fish-drama3', speed: 1.2 } });
    assert.equal(updated.provider.apiKey, FAKE_KEY);
    assert.deepEqual(updated.voices, saved.voices);
    assert.equal(updated.provider.speed, 1.2);
    assert.equal('parser' in h.settings.get('config:main'), false);
});

test('unsupported provider records are rejected without migration, network or data deletion', async () => {
    const h = harness(), saved = { provider: { kind: 'unsupported-fixture', token: 'public-token' } };
    h.settings.set('config:main', structuredClone(saved));
    await assert.rejects(h.get('speechConfig').get(), /版本不受支持/);
    await assert.rejects(h.get('speechConfig').save({ provider: { kind: 'fish-drama3', apiKey: FAKE_KEY } }), /版本不受支持/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.settings.get('config:main'), saved);
});
