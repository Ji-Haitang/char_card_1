/**
 * tests/api/gemini-auth.unit.mjs
 * Gemini 密钥传递方式回归测试：
 *   1. 官方 googleapis.com 端点改用 x-goog-api-key 请求头，URL 里不得出现密钥
 *   2. 第三方中转仍保留 ?key=（兼容），但日志必须脱敏
 *   3. 走 CORS 代理时 ?target= 里不得出现密钥
 *
 * 运行：node --test "tests/api/*.unit.mjs"
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SOURCE = readFileSync(path.join(ROOT, 'module', 'api-service.js'), 'utf8');

const KEY = 'AIzaTEST-secret-should-not-leak';
const OFFICIAL = 'https://generativelanguage.googleapis.com/v1beta';
const MIRROR = 'https://gemini-mirror.example.com/v1beta';
// 注意：不带结尾斜杠，_resolveUrl() 会用 replace(/\/+$/, '') 去掉尾部斜杠后再拼 ?target=
const PROXY = 'https://proxy.example.workers.dev';

/** 构造一个最小 SSE 响应，供流式分支读取 */
function sseResponse(texts) {
    const chunks = texts.map(function (text) {
        return 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: text }] } }] }) + '\n\n';
    });
    return {
        ok: true,
        status: 200,
        body: {
            getReader: function () {
                let i = 0;
                return {
                    read: async function () {
                        if (i >= chunks.length) return { value: undefined, done: true };
                        return { value: new TextEncoder().encode(chunks[i++]), done: false };
                    }
                };
            }
        }
    };
}

/** 在 vm 沙箱里加载 api-service.js，返回服务实例与抓到的请求/日志 */
function loadApi(config) {
    const calls = [];
    const logs = [];
    const store = new Map();

    const sandbox = {
        console: {
            log: function () { logs.push(Array.from(arguments).map(String).join(' ')); },
            warn: function () { logs.push(Array.from(arguments).map(String).join(' ')); },
            error: function () { logs.push(Array.from(arguments).map(String).join(' ')); }
        },
        localStorage: {
            getItem: function (k) { return store.has(k) ? store.get(k) : null; },
            setItem: function (k, v) { store.set(k, String(v)); }
        },
        fetch: async function (url, options) {
            const target = String(url);
            calls.push({ url: target, options: options || {} });
            if (target.indexOf(':streamGenerateContent') !== -1) return sseResponse(['你好', '。']);
            if (/\/models(\?|$)/.test(target)) {
                return {
                    ok: true, status: 200,
                    json: async function () { return { models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }] }; },
                    text: async function () { return ''; }
                };
            }
            return {
                ok: true, status: 200,
                json: async function () { return { candidates: [{ content: { parts: [{ text: 'hi' }] } }], usageMetadata: {} }; },
                text: async function () { return ''; }
            };
        },
        AbortController: AbortController,
        TextDecoder: TextDecoder,
        URL: URL,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        window: { location: { protocol: 'https:' } }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(SOURCE + '\n;globalThis.__apiService = apiService;', sandbox, { filename: 'module/api-service.js' });

    const api = sandbox.__apiService;
    api.loadConfig();
    api.updateConfig(Object.assign({
        endpoint: OFFICIAL,
        apiKey: KEY,
        model: 'gemini-2.5-pro',
        type: 'gemini',
        corsProxyEnabled: false,
        corsProxyUrl: ''
    }, config || {}));
    return { api: api, calls: calls, logs: logs };
}

function headerOf(call, name) {
    const headers = call.options.headers || {};
    const wanted = String(name).toLowerCase();
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === wanted) return String(headers[key]);
    }
    return undefined;
}

function stopStream(api) {
    return new Promise(function (resolve) {
        api.sendMessagesStream(
            [{ role: 'user', content: '你好' }],
            { onToken: function () {}, onComplete: function () { resolve(); }, onError: function () { resolve(); } },
            {}
        );
        setTimeout(resolve, 1500);
    });
}

test('官方端点：密钥进请求头，不进 URL，日志脱敏', async function () {
    const ctx = loadApi({ endpoint: OFFICIAL });
    await ctx.api.sendMessages([{ role: 'user', content: '你好' }]);

    assert.equal(ctx.calls.length, 1);
    const call = ctx.calls[0];
    assert.equal(call.url, OFFICIAL + '/models/gemini-2.5-pro:generateContent');
    assert.equal(call.url.includes('key='), false, 'URL 中不应出现 key 参数');
    assert.equal(headerOf(call, 'x-goog-api-key'), KEY);
    for (const line of ctx.logs) {
        assert.equal(line.includes(KEY), false, '日志不应包含密钥：' + line);
    }
});

test('官方端点流式：密钥进请求头，保留 alt=sse', async function () {
    const ctx = loadApi({ endpoint: OFFICIAL });
    await stopStream(ctx.api);

    assert.equal(ctx.calls.length, 1);
    const call = ctx.calls[0];
    assert.equal(call.url, OFFICIAL + '/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
    assert.equal(call.url.includes('key='), false);
    assert.equal(headerOf(call, 'x-goog-api-key'), KEY);
});

test('走 CORS 代理时 target 中不含密钥', async function () {
    const ctx = loadApi({ endpoint: OFFICIAL, corsProxyEnabled: true, corsProxyUrl: PROXY });
    await ctx.api.sendMessages([{ role: 'user', content: '你好' }]);

    const call = ctx.calls[0];
    assert.ok(call.url.startsWith(PROXY), '请求应经代理发出');
    const target = new URL(call.url).searchParams.get('target');
    assert.ok(target, 'target 参数应存在');
    assert.equal(target.includes(KEY), false, '代理 target 中不应出现密钥');
    assert.equal(target, OFFICIAL + '/models/gemini-2.5-pro:generateContent');
    assert.equal(headerOf(call, 'x-goog-api-key'), KEY);
});

test('第三方中转保持 ?key= 兼容，但日志已脱敏', async function () {
    const ctx = loadApi({ endpoint: MIRROR });
    await ctx.api.sendMessages([{ role: 'user', content: '你好' }]);

    const call = ctx.calls[0];
    assert.ok(call.url.includes('?key=' + encodeURIComponent(KEY)), '中转站应继续拿到 ?key=');
    assert.equal(headerOf(call, 'x-goog-api-key'), undefined, '非官方端点不额外发请求头');
    for (const line of ctx.logs) {
        assert.equal(line.includes(KEY), false, '日志不应包含密钥：' + line);
    }
    assert.ok(ctx.logs.some(function (line) { return line.indexOf('key=***') !== -1; }), '日志里密钥应被替换为 ***');
});

test('模型列表接口同样不把密钥放进 URL', async function () {
    const ctx = loadApi({ endpoint: OFFICIAL });
    const models = await ctx.api.fetchModels(OFFICIAL, KEY, 'gemini');

    const call = ctx.calls[0];
    assert.equal(call.options.method, 'GET');
    assert.equal(call.url, OFFICIAL + '/models');
    assert.equal(headerOf(call, 'x-goog-api-key'), KEY);
    assert.equal(models.length, 1);
    assert.equal(models[0].id, 'gemini-2.5-pro');
});

test('「测试消息」走的直连分支同样不带密钥', async function () {
    const ctx = loadApi({ endpoint: OFFICIAL });
    const result = await ctx.api.sendTestMessage({
        endpoint: OFFICIAL, apiKey: KEY, model: 'gemini-2.5-pro', type: 'gemini', temperature: 0.85
    });

    assert.equal(result.success, true);
    const call = ctx.calls[0];
    assert.equal(call.url.includes('key='), false);
    assert.equal(headerOf(call, 'x-goog-api-key'), KEY);
});
