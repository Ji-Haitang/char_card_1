import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';

function scope(extra = {}) {
    const env = vm.createContext({ Blob, Uint8Array, DataView, TextEncoder, TextDecoder,
        crypto: webcrypto, ...extra });
    for (const file of ['speech/msgpack.js', 'speech/provider.js'])
        vm.runInContext(readFileSync(new URL('../module/' + file, import.meta.url), 'utf8'), env);
    return env;
}
const api = scope().speechDrama3;
const secret = 'fixture-not-a-real-key';
const config = { kind: 'fish-drama3', apiKey: secret };
const voice = { kind: 'fish-drama3', referenceId: 'bf322df2096a46f18c579d0baa36f41d' };
const request = { text: '你好😀。', direction: '轻声、稍慢', voice };
const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 1, 2, 3, 4, 5, 6, 7]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const dynamic = () => ({ kind: 'fish-drama3', reference: {
    audio: new Uint8Array([99, 0, 127, 128, 255, 99]).subarray(1, 5),
    text: '  准确转录😀。\n不修剪。 ', sha256: hash(new Uint8Array([0, 127, 128, 255]))
} });
const response = (bytes = audio, headers = {}) => new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg', ...headers } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function safe(error, code) {
    if (code) assert.equal(error.code, code);
    assert.ok(!String(error.stack).includes(secret));
    assert.ok(!JSON.stringify(error).includes(secret));
    assert.equal(error.cause, undefined); return true;
}
// Independent minimal test decoder: binary becomes Uint8Array, not numeric arrays.
function unpack(bytes) {
    let at = 0; const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const take = n => { const out = bytes.slice(at, at + n); at += n; return out; };
    const uint = n => { const value = n === 1 ? view.getUint8(at) : n === 2 ? view.getUint16(at) : view.getUint32(at); at += n; return value; };
    const str = n => new TextDecoder().decode(take(n));
    const arr = n => Array.from({ length: n }, read);
    const map = n => { const out = {}; for (let i = 0; i < n; i++) out[read()] = read(); return out; };
    function read() {
        const tag = uint(1);
        if (tag <= 0x7f) return tag;
        if ((tag & 0xe0) === 0xa0) return str(tag & 31);
        if ((tag & 0xf0) === 0x90) return arr(tag & 15);
        if ((tag & 0xf0) === 0x80) return map(tag & 15);
        if (tag === 0xc0) return null; if (tag === 0xc2) return false; if (tag === 0xc3) return true;
        if (tag >= 0xc4 && tag <= 0xc6) return take(uint([1, 2, 4][tag - 0xc4]));
        if (tag >= 0xcc && tag <= 0xce) return uint([1, 2, 4][tag - 0xcc]);
        if (tag >= 0xd9 && tag <= 0xdb) return str(uint([1, 2, 4][tag - 0xd9]));
        if (tag === 0xcb) { const n = view.getFloat64(at); at += 8; return n; }
        throw new Error('Unexpected fixture MessagePack tag: ' + tag);
    }
    const value = read(); assert.equal(at, bytes.length); return value;
}

test('fixed public constants and explicit config; never reinterpret old provider or credentials', () => {
    assert.equal(api.provider, 'fish-drama3'); assert.equal(api.model, 'drama-3');
    assert.equal(api.endpoint, 'https://api.fish.audio/v1/tts'); assert.equal(api.format, 'mp3'); assert.equal(api.sampleRate, 44100);
    assert.equal(api.normalizeConfig(config).speed, 1);
    for (const speed of [0.5, 1, 2]) assert.equal(api.normalizeConfig({ ...config, speed }).speed, speed);
    for (const bad of [{ apiKey: secret }, { provider: 'fish-drama3', apiKey: secret },
        { kind: 'other-tts', apiKey: secret }, { kind: 'fish-drama3', token: secret },
        { ...config, provider: 'other-tts' }, { ...config, apiKey: '' }, { ...config, apiKey: '\n' },
        { ...config, apiKey: secret + '\r\nheader' }, { ...config, apiKey: 42 },
        ...[0.49, 2.01, NaN, Infinity, null, '1'].map(speed => ({ ...config, speed })),
        { ...config, endpoint: 'https://evil.invalid' }, { ...config, model: 's2.1-pro-free' },
        { ...config, proxyUrl: 'https://evil.invalid' }, { ...config, sampleRate: 24000 }, { ...config, format: 'wav' }]) {
        assert.throws(() => api.normalizeConfig(bad), e => safe(e, 'configuration'));
    }
});
test('composeText preserves dialogue/direction exactly and enforces code-point limits', () => {
    assert.equal(api.composeText('  原文😀。 ', '轻声、稍慢'), '[轻声、稍慢]   原文😀。 ');
    for (const d of [undefined, null, '']) assert.equal(api.composeText(' 原文 ', d), ' 原文 ');
    assert.equal(api.composeText('😀'.repeat(240), '😀'.repeat(24)), '[' + '😀'.repeat(24) + '] ' + '😀'.repeat(240));
});
test('reject invalid text and executable Fish instructions without rewriting', () => {
    for (const text of ['', '   ', null, 12, '中'.repeat(241), '😀'.repeat(241), '\ud800',
        '原文[轻声]台词', '[pause]', '<whisper>原文</whisper>', '<chinese>字</chinese>',
        '<|speaker:0|>字', '<|phoneme_start|>a<|phoneme_end|>', '一 < 二，三 > 二']) {
        assert.throws(() => api.composeText(text), e => safe(e, 'input'));
    }
    assert.equal(api.composeText('一 < 二。'), '一 < 二。');
    for (const direction of [' ', '中'.repeat(25), '[轻声]', '【轻声】', '<soft>', '轻|慢', '轻；慢', '轻;慢',
        '轻\n慢', '轻\u0000慢', '轻\u007f慢', '轻\u0085慢', '轻\u200b慢', '\ud800', 1, {}, []]) {
        assert.throws(() => api.composeText('正文', direction), e => safe(e, 'input'));
    }
});
test('ID request is exactly one official POST with exact model/auth/JSON and minimal prosody', async () => {
    let calls = 0;
    const output = await api.synthesize({ ...config, speed: 1.25 }, request, { fetch: async (url, init) => {
        calls++; assert.equal(url, api.endpoint); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
        assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
        assert.deepEqual({ ...init.headers }, { Authorization: 'Bearer ' + secret, model: 'drama-3',
            'Content-Type': 'application/json', Accept: 'audio/mpeg, audio/mp3' });
        assert.deepEqual(JSON.parse(init.body), { text: '[轻声、稍慢] 你好😀。', format: 'mp3', sample_rate: 44100,
            latency: 'normal', prosody: { speed: 1.25 }, reference_id: voice.referenceId });
        return response();
    } });
    assert.equal(calls, 1); assert.equal(output.blob.type, 'audio/mpeg');
    assert.deepEqual(new Uint8Array(await output.blob.arrayBuffer()), audio);
    assert.deepEqual(Object.keys(output).sort(), ['billableBytes', 'blob', 'format', 'model', 'provider', 'sampleRate']);
    assert.equal(output.billableBytes, new TextEncoder().encode('[轻声、稍慢] 你好😀。').length);
    assert.equal(output.provider, api.provider); assert.equal(output.model, api.model); assert.equal(output.sampleRate, 44100);
});
test('dynamic reference uses MessagePack raw bytes and exact transcript; SHA is local-only', async () => {
    const v = dynamic(), before = structuredClone(v); let calls = 0;
    const out = await api.synthesize(config, { ...request, voice: v }, { fetch: async (_, init) => {
        calls++; assert.equal(init.headers['Content-Type'], 'application/msgpack');
        assert.equal(init.headers.model, 'drama-3'); assert.equal(init.headers.Authorization, 'Bearer ' + secret);
        assert.ok(init.body instanceof Uint8Array);
        const decoded = unpack(init.body);
        assert.deepEqual(decoded, { text: '[轻声、稍慢] 你好😀。', format: 'mp3', sample_rate: 44100, latency: 'normal',
            prosody: { speed: 1 }, references: [{ audio: before.reference.audio, text: before.reference.text }] });
        assert.ok(decoded.references[0].audio instanceof Uint8Array); assert.equal(decoded.reference_id, undefined);
        assert.equal(decoded.references[0].sha256, undefined); return response();
    } });
    assert.equal(calls, 1); assert.equal(out.blob.size, audio.length); assert.deepEqual(v, before);
});
test('voiceIdentity is stable, binds audio SHA and exact transcript, never contains credentials', async () => {
    const v = dynamic(), original = structuredClone(v);
    const identity = await api.voiceIdentity(v);
    assert.equal(identity, await api.voiceIdentity(structuredClone(v)));
    assert.equal(identity, await api.voiceIdentity({ ...v, reference: { ...v.reference, sha256: v.reference.sha256.toUpperCase() } }));
    assert.notEqual(identity, await api.voiceIdentity({ ...v, reference: { ...v.reference, text: v.reference.text.trim() } }));
    assert.notEqual(identity, await api.voiceIdentity(voice));
    assert.deepEqual(JSON.parse(identity), ['fish-drama3', 'reference-sha256-v1', original.reference.sha256, original.reference.text]);
    assert.deepEqual(v, original); assert.ok(!identity.includes(secret));
});
test('voice rejects invalid identifiers, ambiguous binding, corrupt hashes and oversized references before network', async () => {
    const v = dynamic(); let calls = 0;
    const bad = [{ referenceId: voice.referenceId }, { kind: 'other-tts', referenceId: voice.referenceId },
        { kind: 'fish-drama3', speakerId: 'wrong-property' }, { kind: 'fish-drama3' },
        ...['', '?invalid', '#invalid', ' has-space', 'a/b', '../x', 'https://fish.audio/a', 'a'.repeat(129), '音色'].map(referenceId => ({ ...voice, referenceId })),
        { ...voice, reference: v.reference }, { ...voice, referenceId: [] },
        ...[
            { audio: [0, 127, 128, 255] }, { audio: new Uint8Array() }, { audio: new Uint8Array(10 * 1024 * 1024 + 1) },
            { text: '' }, { text: '  ' }, { text: '\ud800' }, { text: '中'.repeat(65536) },
            { sha256: 'x'.repeat(64) }, { sha256: '0'.repeat(64) }, { sha256: '' }
        ].map(change => ({ ...v, reference: { ...v.reference, ...change } }))];
    for (const value of bad) {
        await assert.rejects(api.voiceIdentity(value), e => safe(e, 'voice'));
        await assert.rejects(api.synthesize(config, { ...request, voice: value }, { fetch: async () => { calls++; return response(); } }), e => safe(e, 'voice'));
    }
    assert.equal(calls, 0);
});
test('config/text failure happens before fetch; old key is never sent as a default', async () => {
    let calls = 0; const fetch = async () => { calls++; return response(); };
    await assert.rejects(api.synthesize({ apiKey: secret }, request, { fetch }), e => safe(e, 'configuration'));
    await assert.rejects(api.synthesize({ ...config, endpoint: 'https://evil.invalid' }, request, { fetch }), e => safe(e, 'configuration'));
    await assert.rejects(api.synthesize(config, { ...request, text: '[pause]' }, { fetch }), e => safe(e, 'input'));
    assert.equal(calls, 0);
});
test('copy-before-await prevents caller mutation from changing hashed/sent audio and transcription', async () => {
    const gate = deferred(), started = deferred();
    const local = scope({ crypto: { subtle: { digest: async (algorithm, bytes) => {
        started.resolve(); await gate.promise; return webcrypto.subtle.digest(algorithm, bytes);
    } } } }).speechDrama3;
    const v = dynamic(), before = structuredClone(v);
    const running = local.synthesize(config, { ...request, voice: v }, { fetch: async (_, init) => {
        const decoded = unpack(init.body); assert.deepEqual(decoded.references[0], { audio: before.reference.audio, text: before.reference.text }); return response();
    } });
    await started.promise; v.reference.audio.fill(9); v.reference.text = 'changed'; v.reference.sha256 = '0'.repeat(64); gate.resolve();
    await running;
});
test('reference size limit accepts exactly 10MiB and missing WebCrypto fails safely', async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024);
    const v = { kind: 'fish-drama3', reference: { audio: bytes, text: 'fixture', sha256: hash(bytes) } };
    let calls = 0;
    await api.synthesize(config, { ...request, voice: v }, { fetch: async (_, init) => {
        calls++; assert.equal(unpack(init.body).references[0].audio.length, bytes.length); return response();
    } });
    assert.equal(calls, 1);
    await assert.rejects(scope({ crypto: undefined }).speechDrama3.voiceIdentity(v), e => safe(e, 'environment'));
});
test('accept official MP3 MIME aliases and split binary headers; normalize Blob MIME', async () => {
    for (const mime of ['audio/mpeg', 'audio/mp3', 'Audio/MP3; charset=binary']) {
        const stream = new ReadableStream({ start(c) { for (const byte of audio) c.enqueue(new Uint8Array([byte])); c.close(); } });
        const result = await api.synthesize(config, request, { fetch: async () => new Response(stream, { headers: { 'Content-Type': mime } }) });
        assert.equal(result.blob.type, 'audio/mpeg'); assert.equal(result.blob.size, audio.length);
    }
    const id3 = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, ...audio]);
    const result = await api.synthesize(config, request, { fetch: async () => response(id3) });
    assert.equal(result.blob.size, id3.length);
});
for (const status of [301, 400, 401, 402, 403, 429, 500, 503]) {
    test('HTTP ' + status + ' cancels body, never retries or echoes server secrets', async () => {
        let calls = 0, cancelled = 0;
        const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(secret)); }, cancel() { cancelled++; } });
        await assert.rejects(api.synthesize(config, request, { fetch: async () => {
            calls++; return new Response(stream, { status, statusText: secret, headers: { 'Content-Type': 'application/json', 'X-Error': secret } });
        } }), e => { safe(e, 'http'); assert.equal(e.status, status); return true; });
        assert.equal(calls, 1); assert.equal(cancelled, 1);
    });
}
test('network/redirect failures and stream rejection do not copy thrown messages or retry', async () => {
    let calls = 0;
    await assert.rejects(api.synthesize(config, request, { fetch: async () => { calls++; throw new Error(secret); } }), e => safe(e, 'network'));
    await assert.rejects(api.synthesize(config, request, { fetch: () => { calls++; throw new Error(secret); } }), e => safe(e, 'network'));
    const stream = new ReadableStream({ start(c) { c.enqueue(audio); }, pull(c) { c.error(new Error(secret)); } });
    await assert.rejects(api.synthesize(config, request, { fetch: async () => { calls++; return response(stream); } }), e => safe(e, 'stream'));
    assert.equal(calls, 3);
});
test('reject JSON/HTML/unknown MIME without consuming server body; cancel open stream', async () => {
    for (const mime of ['application/json', 'text/html', 'text/plain', 'application/octet-stream', '']) {
        let cancelled = 0;
        const stream = new ReadableStream({ start(c) { c.enqueue(audio); }, cancel() { cancelled++; } });
        await assert.rejects(api.synthesize(config, request, { fetch: async () => response(stream, { 'Content-Type': mime }) }), e => safe(e, 'content_type'));
        assert.equal(cancelled, 1);
    }
});
test('reject empty, falsely labelled JSON/HTML, corrupt MPEG header and truncated declared length', async () => {
    for (const [bytes, code] of [[new Uint8Array(), 'empty'], [new TextEncoder().encode('{"key":"' + secret + '"}'), 'content_type'],
        [new TextEncoder().encode('<html>' + secret + '</html>'), 'content_type'], [new Uint8Array([255, 255, 255, 255]), 'content_type']]) {
        await assert.rejects(api.synthesize(config, request, { fetch: async () => response(bytes) }), e => safe(e, code));
    }
    await assert.rejects(api.synthesize(config, request, { fetch: async () => response(audio, { 'Content-Length': '999' }) }), e => safe(e, 'stream'));
    await assert.rejects(api.synthesize(config, request, { fetch: async () => response(null) }), e => safe(e, 'empty'));
});
test('16MiB response limit: accept equality, cancel declared and streamed overflow', async () => {
    const max = 16 * 1024 * 1024, bytes = new Uint8Array(max); bytes.set(audio);
    const result = await api.synthesize(config, request, { fetch: async () => response(bytes, { 'Content-Length': String(max) }) });
    assert.equal(result.blob.size, max);
    for (const declared of [false, true]) {
        let cancelled = 0, calls = 0;
        const stream = new ReadableStream({ start(c) { c.enqueue(bytes); c.enqueue(new Uint8Array([1])); }, cancel() { cancelled++; } });
        await assert.rejects(api.synthesize(config, request, { fetch: async () => {
            calls++; return response(stream, declared ? { 'Content-Length': String(max + 1) } : {});
        } }), e => safe(e, 'too_large'));
        assert.equal(calls, 1); assert.equal(cancelled, 1);
    }
});
test('abort before dispatch and during hashing makes zero network calls', async () => {
    let calls = 0; const controller = new AbortController(); controller.abort(secret);
    await assert.rejects(api.synthesize(config, request, { signal: controller.signal, fetch: async () => { calls++; } }), e => safe(e, 'aborted'));
    const gate = deferred(), started = deferred(), later = new AbortController();
    const local = scope({ crypto: { subtle: { digest: async (...args) => { started.resolve(); await gate.promise; return webcrypto.subtle.digest(...args); } } } }).speechDrama3;
    const running = local.synthesize(config, { ...request, voice: dynamic() }, { signal: later.signal, fetch: async () => { calls++; } });
    await started.promise; later.abort(new Error(secret));
    await assert.rejects(running, e => safe(e, 'aborted')); gate.resolve(); assert.equal(calls, 0);
});
test('abort while fetch is pending rejects promptly and cancels a late response reader', async () => {
    const waiting = deferred(), entered = deferred(), cleaned = deferred(), controller = new AbortController(); let calls = 0;
    const running = api.synthesize(config, request, { signal: controller.signal, fetch: (_, init) => {
        calls++; assert.equal(init.signal, controller.signal); entered.resolve(); return waiting.promise;
    } });
    await entered.promise; controller.abort(secret);
    await assert.rejects(running, e => { safe(e, 'aborted'); assert.equal(e.name, 'AbortError'); return true; });
    waiting.resolve(response(new ReadableStream({ start(c) { c.enqueue(audio); }, cancel() { cleaned.resolve(); } })));
    await cleaned.promise; assert.equal(calls, 1);
});
test('abort a stalled reader; cleanup cancels stream and never returns partial audio', async () => {
    const started = deferred(), cleaned = deferred(), controller = new AbortController(); let calls = 0;
    const stream = new ReadableStream({ start(c) { c.enqueue(audio); }, pull() { started.resolve(); }, cancel() { cleaned.resolve(); } });
    const running = api.synthesize(config, request, { signal: controller.signal, fetch: async () => { calls++; return response(stream); } });
    await started.promise; controller.abort(new Error(secret));
    await assert.rejects(running, e => safe(e, 'aborted')); await cleaned.promise; assert.equal(calls, 1);
});
test('synchronous fetch abort and late rejection never leak secret or retry', async () => {
    const controller = new AbortController(); let calls = 0, cancelled = 0;
    await assert.rejects(api.synthesize(config, request, { signal: controller.signal, fetch: () => {
        calls++; controller.abort(secret);
        return response(new ReadableStream({ start(c) { c.enqueue(audio); }, cancel() { cancelled++; } }));
    } }), e => safe(e, 'aborted'));
    assert.equal(calls, 1); assert.equal(cancelled, 1);
    const next = new AbortController(), waiting = deferred(), entered = deferred();
    const running = api.synthesize(config, request, { signal: next.signal, fetch: () => { entered.resolve(); return waiting.promise; } });
    await entered.promise; next.abort(); await assert.rejects(running, e => safe(e, 'aborted'));
    waiting.reject(new Error(secret)); await Promise.resolve();
});
test('ID3 metadata alone or bogus size cannot masquerade as audio', async () => {
    for (const bytes of [new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]),
        new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 99, ...audio]),
        new Uint8Array([73, 68, 51, 4, 0, 0, 128, 0, 0, 0, ...audio])]) {
        await assert.rejects(api.synthesize(config, request, { fetch: async () => response(bytes) }), e => safe(e, 'content_type'));
    }
});
test('coalesce many tiny chunks without changing bytes; encoded wire length is not decoded length', async () => {
    const bytes = new Uint8Array(70000); bytes.set(audio); bytes[69999] = 42;
    let at = 0;
    const stream = new ReadableStream({ pull(c) {
        if (at === bytes.length) { c.close(); return; }
        c.enqueue(bytes.subarray(at, at + 7)); at += Math.min(7, bytes.length - at);
    } });
    const result = await api.synthesize(config, request, { fetch: async () => response(stream,
        { 'Content-Length': '100', 'Content-Encoding': 'gzip' }) });
    assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), bytes);
});
test('redirected response and cleanup failures remain safe; no retry', async () => {
    let cancelled = 0, calls = 0;
    const stream = new ReadableStream({ start(c) { c.enqueue(audio); }, cancel() { cancelled++; throw new Error(secret); } });
    const redirected = response(stream); Object.defineProperty(redirected, 'redirected', { value: true });
    await assert.rejects(api.synthesize(config, request, { fetch: async () => { calls++; return redirected; } }), e => safe(e, 'network'));
    assert.equal(calls, 1); assert.equal(cancelled, 1);
});
test('abort listeners removed after success and failure', async () => {
    for (const fail of [false, true]) {
        const controller = new AbortController(), signal = controller.signal;
        let adds = 0, removes = 0;
        const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
        signal.addEventListener = (...args) => { adds++; return add(...args); };
        signal.removeEventListener = (...args) => { removes++; return remove(...args); };
        const running = api.synthesize(config, request, { signal, fetch: async () => {
            if (fail) throw new Error(secret); return response();
        } });
        if (fail) await assert.rejects(running, e => safe(e, 'network')); else await running;
        assert.equal(adds, 1); assert.equal(removes, 1);
    }
});
test('estimate uses sent UTF-8 bytes and exact exclusive promotion boundary; always an estimate', () => {
    const before = api.estimate('中😀', '轻声', '2026-12-01T07:59:59.999Z');
    const at = api.estimate('中😀', '轻声', '2026-12-01T08:00:00.000Z');
    const after = api.estimate('中😀', '轻声', new Date('2027-01-01T00:00Z'));
    const bytes = new TextEncoder().encode('[轻声] 中😀').length;
    assert.equal(before.billableBytes, bytes); assert.equal(before.promotional, true);
    assert.equal(before.usdPerMillionBytes, 10); assert.equal(before.estimatedUsd, bytes * 10 / 1e6);
    for (const out of [at, after]) { assert.equal(out.promotional, false); assert.equal(out.usdPerMillionBytes, 50); assert.equal(out.estimatedUsd, bytes * 50 / 1e6); }
    for (const out of [before, at, after]) { assert.equal(out.estimateOnly, true); assert.equal(out.currency, 'USD'); assert.equal(out.standardUsdPerMillionBytes, 50); }
    assert.equal(api.estimate('中😀', '', Date.parse('2026-12-01T08:00Z')).billableBytes, 7);
    assert.throws(() => api.estimate('字', '', 'not-a-date'), e => safe(e, 'estimate'));
});
