import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../ui/config-modal.js', import.meta.url), 'utf8');
const defaults = {
    type: 'openai', endpoint: 'https://api.example/v1', apiKey: 'fake-key',
    model: 'model-a', temperature: 0.85, maxOutputTokens: 8192,
    maxContextTokens: 128000, streamMode: 'stream', topP: 1, topK: 200,
    frequencyPenalty: 0, presencePenalty: 0, corsProxyEnabled: false,
    corsProxyUrl: ''
};
const decode = value => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (text, name) => decode(new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(text)?.[1] || '');
const flag = (text, name) => new RegExp('(?:^|\\s)' + name + '(?:\\s|$)').test(text);

function setup(overrides = {}, history = []) {
    const nodes = new Map();
    const storage = new Map([['jxz_apiConfigHistory', JSON.stringify(history)]]);
    const writes = [];
    const updates = [];
    const calls = [];
    let saved = { ...defaults, ...overrides };
    let html = '';
    const context = {
        console, URL,
        window: { location: { protocol: 'https:' } },
        alert(message) { assert.fail('Unexpected alert: ' + message); },
        document: {
            currentScript: { src: 'https://game.example/ui/config-modal.js' },
            head: { appendChild() {} },
            createElement() { return {}; },
            getElementById(id) { return nodes.get(id) || null; },
            body: {
                // Parse the actual rendered controls rather than pre-creating expected IDs.
                insertAdjacentHTML(position, markup) {
                    assert.equal(position, 'beforeend');
                    html = markup;
                    for (const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
                        const [, tagName, attributes, id] = match;
                        nodes.set(id, {
                            tagName, type: attr(attributes, 'type'), value: attr(attributes, 'value'),
                            checked: flag(attributes, 'checked'), disabled: flag(attributes, 'disabled'),
                            style: {}, textContent: '', className: '',
                            setAttribute(name, value) { this[name] = value; },
                            remove() { if (id === 'api-config-modal') nodes.clear(); }
                        });
                    }
                    for (const match of markup.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
                        const node = nodes.get(attr(match[1], 'id'));
                        if (!node) continue;
                        const options = [...match[2].matchAll(/<option\b([^>]*)>/g)].map(option => ({
                            value: attr(option[1], 'value'), selected: flag(option[1], 'selected')
                        }));
                        node.value = (options.find(option => option.selected) || options[0])?.value || '';
                    }
                }
            }
        },
        localStorage: {
            getItem(key) { return storage.get(key) ?? null; },
            setItem(key, value) { writes.push({ key, value }); storage.set(key, value); }
        },
        // UI contract only: request conversion belongs to api-service's own tests.
        apiService: {
            getConfig() { return { ...saved }; },
            updateConfig(next) { updates.push({ ...next }); saved = { ...saved, ...next }; },
            async sendTestMessage(draft) {
                calls.push({ ...draft });
                return { success: true, content: 'OK' };
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'ui/config-modal.js' });
    return { context, nodes, storage, writes, updates, calls, html: () => html };
}

for (const [name, overrides, expected] of [
    ['legacy config defaults off', {}, false],
    ['explicit false stays off', { toolOutputEnabled: false }, false],
    ['saved true is checked', { toolOutputEnabled: true }, true]
]) {
    test('tool-output checkbox renders: ' + name, () => {
        const { context, nodes, html } = setup(overrides);
        context.showConfigModal();
        const checkbox = nodes.get('api-tool-output-enabled');
        assert.ok(checkbox);
        assert.equal(checkbox.tagName, 'input');
        assert.equal(checkbox.type, 'checkbox');
        assert.equal(checkbox.checked, expected);
        assert.match(html(), /for="api-tool-output-enabled"[^>]*>[\s\S]*?>预设穿甲强化<\/label>/);
        assert.ok(html().indexOf('id="api-stream-mode-select"') < html().indexOf('id="api-tool-output-enabled"'));
        assert.ok(html().indexOf('id="api-tool-output-enabled"') < html().indexOf('id="cors-proxy-field"'));
        assert.doesNotMatch(html(), /display_stream 返回/);
        assert.doesNotMatch(html(), /测试立即使用当前代理设置/);
    });
}

test('saving and reopening preserves both enabled and disabled tool-output settings', () => {
    const { context, nodes, storage, updates } = setup();
    context.showConfigModal();
    for (const enabled of [true, false]) {
        nodes.get('api-tool-output-enabled').checked = enabled;
        nodes.get('api-stream-mode-select').value = enabled ? 'non-stream' : 'stream';
        context.saveConfigAndClose();
        assert.equal(nodes.has('api-config-modal'), false);
        assert.equal(updates.at(-1).toolOutputEnabled, enabled);
        assert.equal(context.apiService.getConfig().toolOutputEnabled, enabled);
        const history = JSON.parse(storage.get('jxz_apiConfigHistory'));
        assert.equal(history.length, 1);
        assert.equal(history[0].toolOutputEnabled, enabled);
        assert.equal(history[0].streamMode, enabled ? 'non-stream' : 'stream');
        context.showConfigModal();
        assert.equal(nodes.get('api-tool-output-enabled').checked, enabled);
        assert.equal(nodes.get('api-stream-mode-select').value, enabled ? 'non-stream' : 'stream');
    }
    assert.equal(updates.length, 2);
});

for (const type of ['openai', 'gemini']) {
    for (const streamMode of ['stream', 'non-stream']) {
        for (const toolOutputEnabled of [false, true]) {
            test(`${type}: draft test passes ${streamMode}, tool output ${toolOutputEnabled}, without saving`, async () => {
                const savedStreamMode = streamMode === 'stream' ? 'non-stream' : 'stream';
                const { context, nodes, storage, calls, writes, updates } = setup({
                    type, streamMode: savedStreamMode, toolOutputEnabled: !toolOutputEnabled
                });
                const saved = context.apiService.getConfig();
                const historyBefore = storage.get('jxz_apiConfigHistory');
                context.showConfigModal();
                nodes.get('api-stream-mode-select').value = streamMode;
                nodes.get('api-tool-output-enabled').checked = toolOutputEnabled;
                await context._doSendTest();
                assert.equal(calls.length, 1);
                assert.equal(calls[0].type, type);
                assert.equal(calls[0].streamMode, streamMode);
                assert.equal(calls[0].toolOutputEnabled, toolOutputEnabled);
                assert.deepEqual(context.apiService.getConfig(), saved);
                assert.equal(storage.get('jxz_apiConfigHistory'), historyBefore);
                assert.equal(writes.length, 0);
                assert.equal(updates.length, 0);
                assert.equal(nodes.get('api-test-btn').disabled, false);
                assert.match(nodes.get('api-test-result').textContent, /测试通过/);
                assert.equal(nodes.has('api-config-modal'), true);
                context.closeConfigModal();
                context.showConfigModal();
                assert.equal(nodes.get('api-tool-output-enabled').checked, !toolOutputEnabled);
                assert.equal(nodes.get('api-stream-mode-select').value, savedStreamMode);
            });
        }
    }
}

test('history restores both switches and resets missing legacy fields without saving', () => {
    const legacy = { ...defaults, model: 'legacy' };
    delete legacy.streamMode;
    const history = [
        { ...defaults, model: 'enabled', streamMode: 'non-stream', toolOutputEnabled: true },
        { ...defaults, model: 'disabled', streamMode: 'stream', toolOutputEnabled: false },
        legacy
    ];
    const { context, nodes, storage, writes, updates } = setup({}, history);
    const saved = context.apiService.getConfig();
    const historyBefore = storage.get('jxz_apiConfigHistory');
    context.showConfigModal();
    for (const [index, expectedEnabled, expectedMode] of [
        [0, true, 'non-stream'], [1, false, 'stream'],
        [0, true, 'non-stream'], [2, false, 'stream']
    ]) {
        nodes.get('api-preset-container').style.display = 'block';
        context._applyPreset(String(index));
        assert.equal(nodes.get('api-model-input').value, history[index].model);
        assert.equal(nodes.get('api-tool-output-enabled').checked, expectedEnabled);
        assert.equal(nodes.get('api-stream-mode-select').value, expectedMode);
        assert.equal(nodes.get('api-preset-container').style.display, 'none');
    }
    assert.deepEqual(context.apiService.getConfig(), saved);
    assert.equal(storage.get('jxz_apiConfigHistory'), historyBefore);
    assert.equal(writes.length, 0);
    assert.equal(updates.length, 0);
});
