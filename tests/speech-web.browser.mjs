// Real Chromium CORS + SDK/transport + existing Worker + original Audio; only network endpoints are fulfilled locally.
// Public fixtures, no actual proxy/Fish traffic, deployment, account credentials or voice-quality claim.
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser } from '../scene3d/scripts/test-support.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, '.scene3d-work', 'speech-web-' + new Date().toISOString().replace(/[:.]/g, '-')));
await mkdir(path.dirname(out), { recursive: true }); await mkdir(out);
const WEB = 'https://game.example', PROXY = 'https://proxy.example', FISH = 'https://api.fish.audio/v1/tts';
const TARGET = PROXY + '/?target=' + encodeURIComponent(FISH);
const FISH_KEY = 'web-fish-public-fixture-not-real', MAIN_KEY = 'web-main-public-fixture-not-real';
const VOICE = 'web-public-fixture-voice', TEXT = '网页语音测试。', DIRECTION = '轻声、稍慢', TRANSCRIPT = '独立公开参考转录。';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mp3 = await readFile(path.join(root, 'tests/scene3d/fixtures/audio/silence.mp3'));
const mp3Hash = hash(mp3);
assert.equal(mp3.length, 1224); assert.equal(mp3Hash, '8833357c87a7ae5a38eb49572f112e89efdd5629cf494fbadf4032f0eb02125d');
const names = ['speech/msgpack.js', 'speech/provider.js'];
const sources = await Promise.all(names.map(async name => ({ name, source: await readFile(path.join(root, 'module', name), 'utf8') })));
const workerSource = await readFile(path.join(root, 'worker/cors-proxy.js'), 'utf8');
const sourceHashes = Object.fromEntries(sources.map(({ name, source }) => ['module/' + name, hash(source)]));
sourceHashes['worker/cors-proxy.js'] = hash(workerSource);
const msgpackScope = { Uint8Array, TextEncoder }; vm.createContext(msgpackScope);
vm.runInContext(sources.find(item => item.name === 'speech/msgpack.js').source, msgpackScope);
const baseBody = { text: '[' + DIRECTION + '] ' + TEXT, format: 'mp3', sample_rate: 44100, latency: 'normal', prosody: { speed: 1 } };
const jsonBytes = Buffer.from(JSON.stringify({ ...baseBody, reference_id: VOICE }));
const msgpackBytes = Buffer.from(msgpackScope.speechMsgpack.encode({ ...baseBody, references: [{ audio: new Uint8Array(mp3), text: TRANSCRIPT }] }));
const clean = text => String(text).replaceAll(FISH_KEY, '[fish-fixture-redacted]').replaceAll(MAIN_KEY, '[main-fixture-redacted]');
const checks = []; let browser;

async function runCase(mode) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    const wire = [], upstream = [], violations = [], pageErrors = [], corsErrors = [];
    const binary = mode === 'msgpack', enabled = mode !== 'disabled', expected = binary ? msgpackBytes : jsonBytes;
    const expectedType = binary ? 'application/msgpack' : 'application/json';
    let activeHandlers = 0;
    try {
        page.setDefaultTimeout(15000); await page.setBypassServiceWorker(true);
        page.on('pageerror', error => pageErrors.push(clean(error.message)));
        const workerScope = { URL, Headers, Request, Response, fetch: async (url, init) => {
            // This is the only upstream boundary. Assertions also surface in violations if the Worker sanitizes an error.
            try {
                assert.equal(url, FISH); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual');
                assert.equal(init.headers.get('authorization'), 'Bearer ' + FISH_KEY);
                assert.equal(init.headers.get('model'), 'drama-3'); assert.equal(init.headers.get('content-type'), expectedType);
                assert.deepEqual([...init.headers.keys()].sort(), ['authorization', 'content-type', 'model']);
                const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
                assert.deepEqual(bytes, expected, 'Worker must forward the exact original browser JSON/MessagePack bytes');
                if (!binary) assert.deepEqual(JSON.parse(bytes), { ...baseBody, reference_id: VOICE });
                upstream.push({ url, method: init.method, redirect: init.redirect, model: init.headers.get('model'), contentType: expectedType,
                    fishAuthorizationMatches: true, mainCredentialUsed: false, bytes: bytes.length, sha256: hash(bytes) });
                if (mode === 'http-error') return new Response(JSON.stringify({ detail: 'untrusted upstream echo ' + FISH_KEY + ' ' + MAIN_KEY }), {
                    status: 401, statusText: 'untrusted ' + FISH_KEY, headers: { 'Content-Type': 'application/json', 'X-Echo': FISH_KEY }
                });
                return new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(mp3.length) } });
            } catch (error) { violations.push({ kind: 'upstream-contract', error: clean(error.stack) }); throw error; }
        } };
        vm.createContext(workerScope);
        assert.equal((workerSource.match(/export default /g) || []).length, 1);
        vm.runInContext(workerSource.replace('export default ', 'globalThis.worker = '), workerScope, { filename: 'cors-proxy.js' });
        const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
        cdp.on('Network.loadingFailed', event => { if (event.corsErrorStatus) corsErrors.push(event.corsErrorStatus); });
        // A real cookie in the proxy jar makes credentials:omit observable on the browser POST.
        const cookie = await cdp.send('Network.setCookie', { url: PROXY, name: 'proxy-fixture', value: 'must-not-send', secure: true, sameSite: 'None' });
        assert.equal(cookie.success, true);
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
        cdp.on('Fetch.requestPaused', event => {
            activeHandlers++;
            (async () => {
                const req = event.request, url = new URL(req.url), headers = new Headers(req.headers);
                const record = { url: url.href, method: req.method, type: event.resourceType, origin: headers.get('origin'),
                    authorizationPresent: headers.has('authorization'), cookiePresent: headers.has('cookie') };
                wire.push(record);
                const fulfill = (status, headers, body = Buffer.alloc(0)) => cdp.send('Fetch.fulfillRequest', {
                    requestId: event.requestId, responseCode: status, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(body).toString('base64')
                });
                if (url.protocol === 'blob:' || url.protocol === 'data:') { await cdp.send('Fetch.continueRequest', { requestId: event.requestId }); return; }
                if (url.href === WEB + '/') {
                    assert.equal(record.authorizationPresent, false);
                    await fulfill(200, { 'Content-Type': 'text/html; charset=utf-8' }, '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Web speech fixture</title><button id="speak">Play public fixture</button><pre id="result"></pre>'); return;
                }
                if (url.href === TARGET) {
                    assert.equal(headers.get('origin'), WEB, 'Preserve the browser-supplied Origin');
                    assert.equal(record.cookiePresent, false);
                    let body;
                    if (req.method === 'POST') {
                        assert.equal(headers.get('authorization'), 'Bearer ' + FISH_KEY);
                        record.fishAuthorizationMatches = true; record.mainCredentialUsed = false;
                        record.contentType = headers.get('content-type'); record.model = headers.get('model');
                        // CDP base64 entries preserve arbitrary MessagePack bytes; UTF-8 postData would corrupt binary.
                        assert.ok(req.postDataEntries?.length, 'Chromium must expose raw request byte entries');
                        body = Buffer.concat(req.postDataEntries.map(entry => Buffer.from(entry.bytes, 'base64')));
                        assert.deepEqual(body, expected); record.bytes = body.length; record.sha256 = hash(body);
                    } else {
                        assert.equal(req.method, 'OPTIONS'); assert.equal(record.authorizationPresent, false);
                        record.requestedMethod = headers.get('access-control-request-method');
                        record.requestedHeaders = headers.get('access-control-request-headers');
                    }
                    const incoming = new Request(req.url, { method: req.method, headers, body, duplex: 'half' });
                    const response = await workerScope.worker.fetch(incoming);
                    record.workerStatus = response.status; record.allowOrigin = response.headers.get('access-control-allow-origin');
                    record.allowedHeaders = response.headers.get('access-control-allow-headers');
                    const bytes = Buffer.from(await response.arrayBuffer());
                    if (mode === 'http-error' && req.method === 'POST') {
                        assert.equal(response.status, 401); assert.equal(response.headers.has('x-echo'), false);
                        assert.ok(!bytes.toString().includes(FISH_KEY)); assert.ok(!bytes.toString().includes(MAIN_KEY));
                        assert.equal(JSON.parse(bytes).error, 'Speech upstream returned an error'); record.sanitizedError = true;
                    }
                    await fulfill(response.status, Object.fromEntries(response.headers), bytes); return;
                }
                violations.push({ kind: 'forbidden-network', url: url.origin + url.pathname, method: req.method });
                await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
            })().catch(async error => {
                violations.push({ kind: 'interception', error: clean(error.stack) });
                await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' }).catch(() => {});
            }).finally(() => { activeHandlers--; });
        });
        await page.goto(WEB + '/', { waitUntil: 'load' });
        await page.evaluate(({ enabled, proxy, mainKey }) => {
            window.__mainFixture = { apiKey: mainKey, corsProxyEnabled: enabled, corsProxyUrl: proxy };
            window.apiService = { getConfig: () => ({ ...__mainFixture }) };
            window.__originalAudio = Audio;
        }, { enabled, proxy: PROXY, mainKey: MAIN_KEY });
        for (const { source } of sources) await page.addScriptTag({ content: source });
        await page.evaluate(({ mode, key, voiceId, text, direction, transcript, audioBytes, fixtureHash }) => {
            window.__web = { done: false };
            document.getElementById('speak').onclick = async () => {
                let audio, blobURL;
                try {
                    const route = speechTransport.capture();
                    const frozen = Object.isFrozen(route), capturedEndpoint = route.endpoint;
                    // Changing API settings after confirmation must not reroute this paid request or substitute the main API key.
                    __mainFixture.corsProxyUrl = 'https://changed.example'; __mainFixture.corsProxyEnabled = false;
                    const voice = mode === 'msgpack' ? { kind: 'fish-drama3', reference: {
                        audio: new Uint8Array(audioBytes), text: transcript, sha256: fixtureHash
                    } } : { kind: 'fish-drama3', referenceId: voiceId };
                    route.checkVoice(voice);
                    const result = await speechDrama3.synthesize({ kind: 'fish-drama3', apiKey: key }, { text, direction, voice }, { fetch: route.fetch });
                    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await result.blob.arrayBuffer()))).map(n => n.toString(16).padStart(2, '0')).join('');
                    if (Audio !== __originalAudio) throw Error('Audio was replaced');
                    blobURL = URL.createObjectURL(result.blob); audio = new Audio(blobURL);
                    const ended = new Promise((resolve, reject) => { audio.onended = resolve; audio.onerror = () => reject(Error('Original Audio decode failed')); });
                    ended.catch(() => {});
                    await audio.play(); const duration = audio.duration, started = !audio.paused; await ended;
                    __web = { done: true, ok: true, capturedEndpoint, frozen, mode: route.mode, bytes: result.blob.size, mime: result.blob.type,
                        sha256: digest, duration, started, ended: audio.ended, originalAudio: Audio === __originalAudio,
                        model: result.model, billableBytes: result.billableBytes };
                } catch (error) { __web = { done: true, ok: false, error: { code: error.code || '', status: error.status || null, message: error.message } }; }
                finally { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } if (blobURL) URL.revokeObjectURL(blobURL); }
                document.getElementById('result').textContent = JSON.stringify(__web);
            };
        }, { mode, key: FISH_KEY, voiceId: VOICE, text: TEXT, direction: DIRECTION, transcript: TRANSCRIPT, audioBytes: [...mp3], fixtureHash: mp3Hash });
        await page.click('#speak'); await page.waitForFunction(() => __web.done);
        const result = await page.evaluate(() => __web);
        assert.equal(activeHandlers, 0); assert.deepEqual(violations, []); assert.deepEqual(pageErrors, []); assert.deepEqual(corsErrors, []);
        const proxyWire = wire.filter(item => item.url === TARGET), preflight = proxyWire.filter(item => item.method === 'OPTIONS'), posts = proxyWire.filter(item => item.method === 'POST');
        assert.equal(upstream.length, enabled ? 1 : 0); assert.equal(preflight.length, enabled ? 1 : 0); assert.equal(posts.length, enabled ? 1 : 0);
        if (enabled) {
            assert.equal(preflight[0].requestedMethod, 'POST');
            assert.deepEqual(preflight[0].requestedHeaders.split(',').map(s => s.trim()).sort(), ['authorization', 'content-type', 'model']);
            assert.equal(preflight[0].workerStatus, 204); assert.equal(preflight[0].allowOrigin, '*');
            assert.ok(preflight[0].allowedHeaders.split(',').map(s => s.trim()).includes('model'));
            assert.equal(posts[0].fishAuthorizationMatches, true); assert.equal(posts[0].mainCredentialUsed, false);
            assert.equal(posts[0].model, 'drama-3'); assert.equal(posts[0].contentType, expectedType);
            assert.equal(posts[0].sha256, upstream[0].sha256); assert.equal(posts[0].allowOrigin, '*');
        }
        if (mode === 'json' || mode === 'msgpack') {
            assert.equal(result.ok, true); assert.equal(result.capturedEndpoint, PROXY + '?target=' + encodeURIComponent(FISH));
            assert.equal(result.frozen, true); assert.equal(result.mode, 'web-proxy'); assert.equal(result.model, 'drama-3');
            assert.equal(result.bytes, mp3.length); assert.equal(result.sha256, mp3Hash); assert.equal(result.mime, 'audio/mpeg');
            assert.ok(result.duration >= 1.2 && result.duration <= 1.3); assert.equal(result.started, true); assert.equal(result.ended, true); assert.equal(result.originalAudio, true);
            assert.equal(result.billableBytes, new TextEncoder().encode(baseBody.text).length);
        } else {
            assert.equal(result.ok, false); assert.equal(result.error.code, enabled ? 'http' : 'web-route');
            assert.ok(!result.error.message.includes(FISH_KEY)); assert.ok(!result.error.message.includes(MAIN_KEY));
            if (enabled) { assert.equal(result.error.status, 401); assert.equal(posts[0].sanitizedError, true); }
        }
        return { name: mode, status: 'PASS', result, requests: wire, upstream, corsErrors, externalNetworkAccess: false };
    } catch (error) {
        return { name: mode, status: 'FAIL', error: clean(error.stack), requests: wire, upstream, violations, pageErrors, corsErrors };
    } finally { await context.close(); }
}

try {
    browser = await launchBrowser();
    for (const mode of ['json', 'msgpack', 'http-error', 'disabled']) {
        const result = await runCase(mode); checks.push(result); console.log(result.status + ' Web speech: ' + mode);
    }
} finally {
    if (browser) await browser.close();
    const failed = checks.filter(check => check.status !== 'PASS').length;
    const report = { status: failed || checks.length !== 4 ? 'FAIL' : 'PASS', passed: checks.length - failed, failed, checks, sourceHashes,
        fixture: { bytes: mp3.length, sha256: mp3Hash },
        boundary: 'Virtual HTTPS Chromium document and existing CORS Worker fulfilled by CDP. Actual browser Origin, OPTIONS/POST, CORS policy, original Audio playback, real SDK/MessagePack/transport capture and Worker handler. Only config fixtures and network endpoints simulated; binary requests obtained as raw CDP base64 entries. No actual proxy/Fish request, deployed CF verification, credential access, account fees, voice quality or APK/device claims. CDP response fulfillment buffers bodies and does not prove edge streaming/backpressure.' };
    const serialized = JSON.stringify(report, null, 2); assert.ok(!serialized.includes(FISH_KEY)); assert.ok(!serialized.includes(MAIN_KEY));
    await writeFile(path.join(out, 'report.json'), serialized + '\n');
    console.log(JSON.stringify({ output: out, status: report.status, passed: report.passed, failed }, null, 2));
    if (report.status !== 'PASS') process.exitCode = 1;
}
