import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../module/api-service.js', import.meta.url), 'utf8');
const primary = { type: 'openai', endpoint: 'https://main.example/v1', apiKey: 'main-key', model: 'main-model', corsProxyEnabled: false, temperature: 0.7 };
const secondary = { enabled: true, type: 'openai', endpoint: 'https://side.example/v1', apiKey: 'side-key', model: 'side-model', corsProxyEnabled: false, temperature: 0.2, maxOutputTokens: 123 };

function setup(store = new Map()) {
    const calls = [];
    const logs = [];
    const context = {
        AbortController, TextDecoder, URL,
        console: { log(...a) { logs.push(a.join(' ')); }, warn() {} },
        window: { location: { protocol: 'https:' } },
        localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
        fetch: async (url, options) => {
            const body = JSON.parse(options.body);
            calls.push({ url, body, auth: options.headers.Authorization });
            return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
        }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return { api: context.apiService, calls, store, context, logs };
}

test('without a secondary API every request uses the primary API', async () => {
    const { api, calls } = setup();
    api.updateConfig(primary);
    api.updateSecondaryConfig({ backgroundTasks: ['summary'] });
    assert.equal(api.isSecondaryConfigured(), false);
    await api.sendMessages([{ role: 'user', content: 'x' }], { task: 'summary', maxOutputTokens: null });
    assert.match(calls[0].url, /main\.example/);
    assert.equal(calls[0].body.model, 'main-model');
});

test('checked background tasks use the secondary API; unchecked tasks and runturn use the primary', async () => {
    const { api, calls, store } = setup();
    api.updateConfig(primary);
    api.updateSecondaryConfig({ ...secondary, backgroundTasks: ['summary', 'sideQuestJudge'] });
    assert.ok(store.get('jxz_apiConfigSecondary'));
    for (const task of ['summary', 'sideQuestJudge', 'location', undefined, 'runturn']) {
        await api.sendMessages([{ role: 'user', content: 'x' }], task ? { task } : undefined);
    }
    assert.deepEqual(calls.map(call => call.body.model), ['side-model', 'side-model', 'main-model', 'main-model', 'main-model']);
    assert.equal(calls[0].auth, 'Bearer side-key');
    assert.equal(calls[0].body.temperature, 0.2);
    assert.equal(calls[0].body.max_tokens, 123);
    assert.equal(calls[2].auth, 'Bearer main-key');
    assert.equal(api.getConfigFor('summary').model, 'side-model');
    assert.equal(api.getConfigFor('bounty').model, 'main-model');
});

test('streaming requests follow the same routing', async () => {
    const { api, calls, context } = setup();
    api.updateConfig(primary);
    api.updateSecondaryConfig({ ...secondary, backgroundTasks: ['event'] });
    context.fetch = async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n');
    };
    const text = await new Promise((resolve, reject) => api.sendMessagesStream([{ role: 'user', content: 'x' }],
        { onToken() {}, onComplete: resolve, onError: reject }, { task: 'event', maxOutputTokens: null }));
    assert.equal(text, 'hi');
    assert.equal(calls[0].body.model, 'side-model');
});

test('secondary config and prompt presets persist across reload', () => {
    const store = new Map();
    const first = setup(store);
    first.api.updateConfig({ ...primary, promptPreset: 'xiajin' });
    first.api.updateSecondaryConfig({ ...secondary, promptPreset: 'ny', backgroundTasks: ['bounty'] });
    const second = setup(store);
    second.api.loadConfig();
    assert.equal(second.api.getConfig().promptPreset, 'xiajin');
    assert.equal(second.api.getSecondaryConfig().model, 'side-model');
    assert.deepEqual([...second.api.getSecondaryConfig().backgroundTasks], ['bounty']);
});

test('legacy gameData.promptPreset migrates to the primary API config once', () => {
    const store = new Map([['jxz_apiConfig', JSON.stringify(primary)]]);
    const { api } = setup(store);
    api.loadConfig();
    const gameData = { promptPreset: 'xiajin', other: 1 };
    api.migrateLegacyPromptPreset(gameData);
    assert.equal('promptPreset' in gameData, false);
    assert.equal(api.getConfig().promptPreset, 'xiajin');
    assert.equal(JSON.parse(store.get('jxz_apiConfig')).promptPreset, 'xiajin');
    // An explicit AI-config choice is never overwritten by an older save.
    api.migrateLegacyPromptPreset({ promptPreset: 'ny' });
    assert.equal(JSON.parse(store.get('jxz_apiConfig')).promptPreset, 'xiajin');
});

test('switch off or invalid secondary fields keep every request on the primary API', async () => {
    const { api, calls } = setup();
    api.updateConfig(primary);
    api.updateSecondaryConfig({ ...secondary, enabled: false, backgroundTasks: ['summary'] });
    assert.equal(api.isSecondaryConfigured(), false);
    await api.sendMessages([{ role: 'user', content: 'x' }], { task: 'summary' });
    api.updateSecondaryConfig({ enabled: true, endpoint: 'not-a-url' });
    assert.equal(api.isSecondaryConfigured(), false);
    await api.sendMessages([{ role: 'user', content: 'x' }], { task: 'summary' });
    api.updateSecondaryConfig({ endpoint: secondary.endpoint, model: '   ' });
    assert.equal(api.isSecondaryConfigured(), false);
    api.updateSecondaryConfig({ model: secondary.model });
    assert.equal(api.isSecondaryConfigured(), true);
    await api.sendMessages([{ role: 'user', content: 'x' }], { task: 'summary' });
    assert.deepEqual(calls.map(call => call.body.model), ['main-model', 'main-model', 'side-model']);
});

test('every request logs its route with the reason', async () => {
    const { api, logs } = setup();
    api.updateConfig(primary);
    api.updateSecondaryConfig({ ...secondary, backgroundTasks: ['summary'] });
    await api.sendMessages([{ role: 'user', content: 'x' }], { task: 'summary' });
    await api.sendMessages([{ role: 'user', content: 'x' }], { task: 'location' });
    await api.sendMessages([{ role: 'user', content: 'x' }]);
    const routes = logs.filter(line => line.startsWith('[API][路由]'));
    assert.equal(routes.length, 3);
    assert.match(routes[0], /周总结\(summary\) → 副API \| model=side-model \| host=side\.example/);
    assert.match(routes[1], /地点信息更新\(location\) → 主API .*未勾选/);
    assert.match(routes[2], /正文\(runturn\) → 主API .*正文请求固定走主API/);
});

test('legacy secondary config without a switch stays on when it was complete', () => {
    const store = new Map([['jxz_apiConfigSecondary', JSON.stringify({ ...secondary, enabled: undefined, backgroundTasks: ['bounty'] })]]);
    const { api } = setup(store);
    api.loadConfig();
    assert.equal(api.getSecondaryConfig().enabled, true);
    assert.equal(api.getConfigFor('bounty').model, 'side-model');
});