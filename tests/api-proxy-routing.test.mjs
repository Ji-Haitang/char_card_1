import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const endpoint = 'http://124.221.135.100:3000/v1';
const proxy = 'https://trusted-relay.example/';

function setup() {
    const calls = [];
    let writes = 0;
    const nodes = {};
    for (const [id, value] of Object.entries({
        'api-endpoint-input': endpoint, 'api-key-input': 'fake-key',
        'api-type-select': 'openai', 'api-model-input': 'model-a',
        'api-temp-input': '0.9', 'api-cors-proxy-input': proxy,
        'api-cors-proxy-enabled': '', 'api-connect-btn': '',
        'api-connect-status': '', 'api-model-select': '',
        'api-test-btn': '', 'api-test-result': ''
    })) nodes[id] = { value, style: {}, options: [], appendChild(opt) { this.options.push(opt); } };
    nodes['api-cors-proxy-enabled'].checked = true;
    const context = {
        console, URL,
        window: { location: { protocol: 'https:' } },
        document: {
            currentScript: { src: 'https://game.example/ui/config-modal.js' },
            head: { appendChild() {} },
            createElement() { return {}; },
            getElementById(id) { return nodes[id]; }
        },
        localStorage: { getItem() { return null; }, setItem() { writes++; } },
        fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: true, json: async () => ({
                data: [{ id: 'model-z' }, { id: 'model-a' }],
                models: [{ name: 'models/gemini-test' }],
                choices: [{ message: { content: 'OK' } }],
                candidates: [{ content: { parts: [{ text: 'OK' }] } }]
            }) };
        }
    };
    vm.createContext(context);
    vm.runInContext(read('module/api-service.js'), context);
    vm.runInContext(read('ui/config-modal.js'), context);
    return { context, api: context.apiService, calls, nodes, writes: () => writes };
}

for (const type of ['openai', 'gemini']) {
    test(`${type}: model tests use draft proxy options without saving`, async () => {
        const { api, calls, writes } = setup();
        const saved = JSON.stringify(api.getConfig());
        const models = await api.fetchModels(endpoint, 'fake-key', type, { corsProxyEnabled: true, corsProxyUrl: proxy });
        assert.equal(new URL(calls[0].url).origin, 'https://trusted-relay.example');
        assert.match(new URL(calls[0].url).searchParams.get('target'), /\/v1\/models/);
        assert.equal(models[0].id, type === 'openai' ? 'model-a' : 'gemini-test');
        // 密钥只能在请求头里，绝不能出现在代理 target / URL 中
        assert.ok(!calls[0].url.includes('fake-key'));
        if (type === 'gemini') assert.equal(calls[0].options.headers['x-goog-api-key'], 'fake-key');
        await api.fetchModels(endpoint, 'fake-key', type, { corsProxyEnabled: false });
        assert.ok(calls[1].url.startsWith(endpoint + '/models'));
        assert.equal(JSON.stringify(api.getConfig()), saved);
        assert.equal(writes(), 0);
    });

    test(`${type}: message test respects enabled and disabled proxy`, async () => {
        const { api, calls } = setup();
        const cfg = { endpoint, apiKey: 'fake-key', model: 'model-a', type, corsProxyEnabled: true, corsProxyUrl: proxy };
        assert.equal((await api.sendTestMessage(cfg)).success, true);
        assert.equal(new URL(calls[0].url).origin, 'https://trusted-relay.example');
        assert.ok(!calls[0].url.includes('fake-key'));
        if (type === 'gemini') assert.equal(calls[0].options.headers['x-goog-api-key'], 'fake-key');
        assert.equal((await api.sendTestMessage({ ...cfg, corsProxyEnabled: false })).success, true);
        assert.ok(calls[1].url.startsWith(endpoint));
    });
}

test('legacy model-list callers still use saved routing', async () => {
    const { api, calls } = setup();
    api.updateConfig({ corsProxyEnabled: true, corsProxyUrl: proxy });
    await api.fetchModels(endpoint, 'fake-key', 'openai');
    assert.equal(new URL(calls[0].url).origin, 'https://trusted-relay.example');
});

test('both dialog buttons use current unsaved proxy checkbox and URL', async () => {
    const { context, calls, nodes, writes } = setup();
    await context._doConnectTest();
    await context._doSendTest();
    assert.equal(calls.length, 2);
    for (const call of calls) assert.equal(new URL(call.url).origin, 'https://trusted-relay.example');
    nodes['api-cors-proxy-enabled'].checked = false;
    await context._doConnectTest();
    await context._doSendTest();
    for (const call of calls.slice(2)) assert.ok(call.url.startsWith(endpoint));
    assert.equal(writes(), 0);
});

test('empty list and rejected relay yield useful status and restore controls', async () => {
    const { context, nodes } = setup();
    context.fetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
    await context._doConnectTest();
    assert.match(nodes['api-connect-status'].textContent, /未返回可选模型/);
    context.fetch = async () => ({ ok: false, status: 403, text: async () => 'Only HTTPS targets are allowed' });
    await context._doConnectTest();
    assert.match(nodes['api-connect-status'].textContent, /向服务商索取 HTTPS/);
    assert.equal(nodes['api-connect-btn'].disabled, false);
    assert.equal(nodes['api-model-select'].disabled, true);
    await context._doSendTest();
    assert.match(nodes['api-test-result'].textContent, /向服务商索取 HTTPS/);
    assert.equal(nodes['api-test-btn'].disabled, false);
});

test('transport diagnostics distinguish mixed content, CORS, and auth', () => {
    const { context } = setup();
    assert.match(context._apiConnectionError('Failed to fetch', endpoint, false, ''), /不能直连 HTTP/);
    assert.match(context._apiConnectionError('Failed to fetch', endpoint, true, proxy), /Authorization/);
    assert.equal(context._apiConnectionError('401 invalid key', endpoint, true, proxy), '401 invalid key');
});
