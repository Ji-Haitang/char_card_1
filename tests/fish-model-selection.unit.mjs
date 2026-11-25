import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { harness } from './media-speech-fixture.mjs';

const PUBLIC_KEY = 'fish-model-selection-public-fixture-not-real';
const PUBLIC_VOICE = {
    kind: 'fish-drama3',
    speakerId: 'public-model-selection-voice',
    version: '7',
};
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 1, 2, 3, 4, 5, 6, 7]);

function loadProvider() {
    const context = vm.createContext({
        Blob,
        Uint8Array,
        DataView,
        TextEncoder,
        TextDecoder,
        Response,
        crypto: webcrypto,
    });
    for (const name of ['msgpack.js', 'provider.js']) {
        const source = fs.readFileSync(new URL('../module/speech/' + name, import.meta.url), 'utf8');
        vm.runInContext(source, context, { filename: name });
    }
    return context.speechDrama3;
}

function audioResponse() {
    return new Response(MP3, { headers: { 'Content-Type': 'audio/mpeg' } });
}

test('S2.1 Pro 与 Drama 3 分别发送精确模型头，Free 在联网前拒绝', async () => {
    const provider = loadProvider();
    const request = {
        text: '公开模型选择测试。',
        direction: '平静',
        voice: { kind: 'fish-drama3', referenceId: 'public-model-selection-voice' },
    };

    assert.deepEqual(Array.from(provider.models), ['s2.1-pro', 'drama-3']);
    for (const model of provider.models) {
        let sent;
        const result = await provider.synthesize(
            { kind: 'fish-drama3', apiKey: PUBLIC_KEY, model },
            request,
            {
                fetch: async (url, options) => {
                    sent = { url, options };
                    return audioResponse();
                },
            },
        );
        assert.equal(sent.url, 'https://api.fish.audio/v1/tts');
        assert.equal(sent.options.headers.model, model);
        assert.equal(result.model, model);
    }

    // Free 不在可选合同内，必须在产生任何网络请求之前明确失败。
    let requests = 0;
    await assert.rejects(
        provider.synthesize(
            { kind: 'fish-drama3', apiKey: PUBLIC_KEY, model: 's2.1-pro-free' },
            request,
            {
                fetch: async () => {
                    requests++;
                    return audioResponse();
                },
            },
        ),
        error => error?.code === 'configuration',
    );
    assert.equal(requests, 0);
});

test('旧配置继续按 Drama 3 解释，新配置默认 S2.1 Pro，切换模型不改凭据和绑定', async () => {
    const provider = loadProvider();
    const old = harness();
    const oldRecord = {
        enabled: true,
        provider: { kind: 'fish-drama3', apiKey: PUBLIC_KEY, speed: 1.25 },
        voices: { A: structuredClone(PUBLIC_VOICE) },
    };
    old.settings.set('config:main', structuredClone(oldRecord));

    const projected = await old.get('speechConfig').get();
    assert.equal(Object.hasOwn(projected.provider, 'model'), false);
    assert.equal(provider.normalizeConfig(projected.provider).model, 'drama-3');
    assert.equal(old.writes.length, 0);
    assert.deepEqual(old.settings.get('config:main'), oldRecord);

    const saved = await old.get('speechConfig').save({
        provider: { kind: 'fish-drama3', model: 's2.1-pro' },
    });
    assert.equal(saved.provider.model, 's2.1-pro');
    assert.equal(saved.provider.apiKey, PUBLIC_KEY);
    assert.equal(saved.provider.speed, 1.25);
    assert.deepEqual(saved.voices, oldRecord.voices);
    assert.deepEqual(old.settings.get('config:main').voices, oldRecord.voices);

    // 没有历史记录时才采用新默认，读取默认值本身不应落盘。
    const fresh = harness();
    const defaults = await fresh.get('speechConfig').get();
    assert.equal(defaults.provider.model, 's2.1-pro');
    assert.equal(defaults.provider.apiKey, '');
    assert.equal(fresh.writes.length, 0);
});

test('费用按实际 UTF-8 请求字节计算，模型价格和 D3 活动价保持既定合同', () => {
    const provider = loadProvider();
    const text = '公开对白😀。';
    const direction = '轻声、稍慢';
    const expectedBytes = new TextEncoder().encode(`[${direction}] ${text}`).length;

    const s21 = provider.estimate(text, direction, '2026-11-25T00:00:00.000Z', 's2.1-pro');
    assert.equal(s21.billableBytes, expectedBytes);
    assert.equal(s21.usdPerMillionBytes, 15);
    assert.equal(s21.standardUsdPerMillionBytes, 15);
    assert.equal(s21.promotional, false);
    assert.equal(s21.estimatedUsd, expectedBytes * 15 / 1_000_000);

    const d3Promotion = provider.estimate(text, direction, '2026-11-25T00:00:00.000Z', 'drama-3');
    assert.equal(d3Promotion.billableBytes, expectedBytes);
    assert.equal(d3Promotion.usdPerMillionBytes, 10);
    assert.equal(d3Promotion.standardUsdPerMillionBytes, 50);
    assert.equal(d3Promotion.promotional, true);

    const d3Standard = provider.estimate(text, direction, '2026-12-01T08:00:00.000Z', 'drama-3');
    assert.equal(d3Standard.usdPerMillionBytes, 50);
    assert.equal(d3Standard.standardUsdPerMillionBytes, 50);
    assert.equal(d3Standard.promotional, false);
    assert.equal(d3Standard.estimatedUsd, expectedBytes * 50 / 1_000_000);
});
