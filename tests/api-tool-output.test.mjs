import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../module/api-service.js', import.meta.url), 'utf8');
const toolName = 'submit_game_output';
const messages = [
    { role: 'system', content: '你是游戏叙事助手。保留 XML 与 JSON 输出格式。' },
    { role: 'user', content: '世界资料：山门。\n玩家：小林。' },
    { role: 'assistant', content: '<MAIN_TEXT>昨日在藏书阁。</MAIN_TEXT>' },
    { role: 'user', content: '请描述今天的山门，并总结。' }
];
const output = '<SLG_MODE>\n<MAIN_TEXT>他说："你好"。路径 C:\\game，风景很好 🌄。\n第二行。</MAIN_TEXT>\n<SUMMARY>参观山门。</SUMMARY>\n<SIDE_NOTE>{"位置":"山门","说明":"甲\\乙"}</SIDE_NOTE></SLG_MODE>';
const baseConfig = { endpoint: 'https://api.example/v1', apiKey: 'fake-key', model: 'gemini-alias', corsProxyEnabled: false };

function setup(type = 'openai', enabled = true, store = new Map()) {
    const calls = [];
    let respond = () => jsonResponse(type === 'openai' ? openaiResponse() : geminiResponse());
    const context = {
        AbortController, TextDecoder, URL,
        console: { log() {}, warn() {} },
        window: { location: { protocol: 'https:' } },
        localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
        fetch: async (url, options) => {
            calls.push({ url, options, body: options.body && JSON.parse(options.body) });
            return respond(url, options);
        }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    const api = context.apiService;
    api.updateConfig({ ...baseConfig, type, toolOutputEnabled: enabled });
    return { api, calls, store, respond: fn => { respond = fn; } };
}
function jsonResponse(data, status = 200) { return new Response(JSON.stringify(data), { status }); }
function openaiResponse(args = { display_stream: output }, finish = 'tool_calls') {
    return { choices: [{ finish_reason: finish, message: { content: null, tool_calls: [{
        id: 'call_test', type: 'function', function: { name: toolName, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
    }] } }], usage: { completion_tokens: 20 } };
}
function geminiResponse(args = { display_stream: output }, finish = 'STOP') {
    return { candidates: [{ finishReason: finish, content: { parts: [
        { thought: true, text: '计划中' }, { functionCall: { name: toolName, args } }
    ] } }], usageMetadata: { candidatesTokenCount: 20 } };
}
function event(data, newline = '\n') { return 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + newline + newline; }
function streamResponse(text, split = 7) {
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
        controller.close();
    } }));
}
function openaiDelta(fn, extras = {}) { return { choices: [{ delta: { tool_calls: [{ index: 0, function: fn, ...extras }] } }] }; }
function openaiStream(text = output, newline = '\n', argSize = 7, rawArgs) {
    const args = rawArgs ?? JSON.stringify({ display_stream: text });
    let sse = event(openaiDelta({ name: toolName }, { id: 'call_test', type: 'function' }), newline);
    sse += event({ choices: [{ delta: { reasoning_content: '准备生成' } }] }, newline);
    for (let i = 0; i < args.length; i += argSize) sse += event(openaiDelta({ arguments: args.slice(i, i + argSize) }), newline);
    sse += event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, newline);
    sse += event({ choices: [], usage: { completion_tokens: 20 } }, newline);
    return sse + event('[DONE]', newline);
}
function collectStream(api, options, onToken) {
    const tokens = [], thinking = [], terminal = [];
    let handle;
    const promise = new Promise((resolve, reject) => {
        handle = api.sendMessagesStream(messages, {
            onToken(text) { tokens.push(text); if (onToken) onToken(text, handle); },
            onThinking(text) { thinking.push(text); },
            onComplete(content, usage) { terminal.push('complete'); resolve({ content, usage, tokens, thinking, terminal }); },
            onError(error) { terminal.push('error'); reject(error); }
        }, options);
    });
    return { promise, handle, terminal, tokens };
}

for (const type of ['openai', 'gemini']) {
    test(`${type}: wraps ALL ordered messages, preserving input and original API route`, async () => {
        const h = setup(type);
        h.api.updateConfig({ topPEnabled: true, topP: 0.8, temperature: 0.7 });
        const before = JSON.stringify(messages);
        const result = await h.api.sendMessages(messages);
        assert.equal(result.content, output);
        assert.equal(JSON.stringify(messages), before);
        const { body, url, options } = h.calls[0];
        const fn = type === 'openai' ? body.tools[0].function : body.tools[0].functionDeclarations[0];
        assert.equal(fn.name, toolName);
        assert.deepEqual(JSON.parse(fn.description.split('\n\n')[1]), messages);
        assert.deepEqual(fn.parameters.required, ['display_stream']);
        assert.equal(fn.parameters.properties.display_stream.type, 'string');
        assert.equal(body.safetySettings, undefined);
        if (type === 'openai') {
            assert.equal(url, baseConfig.endpoint + '/chat/completions');
            assert.equal(body.model, 'gemini-alias'); // model name MUST NOT switch protocol
            assert.equal(body.messages.length, 2);
            assert.equal(body.messages[0].role, 'system');
            assert.match(body.messages[0].content, /ONLY valid response/);
            assert.equal(body.messages[1].role, 'user');
            assert.match(body.messages[1].content, /submit_game_output/);
            assert.ok(!JSON.stringify(body.messages).includes('小林'));
            assert.equal(body.contents, undefined);
            assert.equal(body.toolConfig, undefined);
            assert.equal(body.temperature, 0.7);
            assert.equal(body.top_p, 0.8);
            assert.deepEqual(body.tool_choice, { type: 'function', function: { name: toolName } });
            assert.equal(options.headers.Authorization, 'Bearer fake-key');
        } else {
            assert.match(url, /\/models\/gemini-alias:generateContent\?key=fake-key$/);
            assert.match(body.systemInstruction.parts[0].text, /ONLY valid response/);
            assert.ok(!JSON.stringify(body.systemInstruction).includes('游戏叙事助手'));
            assert.equal(body.contents.length, 1);
            assert.ok(!JSON.stringify(body.contents).includes('小林'));
            assert.equal(body.messages, undefined);
            assert.equal(body.tool_choice, undefined);
            assert.equal(body.generationConfig.temperature, 0.7);
            assert.equal(body.generationConfig.topP, 0.8);
            assert.deepEqual(body.toolConfig.functionCallingConfig, { mode: 'ANY', allowedFunctionNames: [toolName] });
            assert.equal(options.headers.Authorization, undefined);
        }
    });

    test(`${type}: disabled mode keeps existing body/response, no tools or hidden flags`, async () => {
        const h = setup(type, false);
        h.respond(() => jsonResponse({ choices: [{ message: { content: output } }], candidates: [{ content: { parts: [{ text: output }] } }] }));
        assert.equal((await h.api.sendMessages(messages)).content, output);
        const body = h.calls[0].body;
        const expected = type === 'openai' ? {
            model: baseConfig.model, messages, temperature: 0.9, max_tokens: 18000
        } : {
            contents: messages.slice(1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            systemInstruction: { parts: [{ text: messages[0].content }] },
            generationConfig: { temperature: 0.9, maxOutputTokens: 18000 }
        };
        assert.deepEqual(body, expected);
    });

    test(`${type}: default/explicit/null token limits and signal survive wrapping`, async () => {
        const h = setup(type);
        for (const value of [undefined, 1234, null]) {
            const controller = new AbortController();
            const options = { signal: controller.signal };
            if (value !== undefined) options.maxOutputTokens = value;
            await h.api.sendMessages(messages, options);
            const call = h.calls.at(-1);
            const target = type === 'openai' ? call.body : call.body.generationConfig;
            const field = type === 'openai' ? 'max_tokens' : 'maxOutputTokens';
            if (value === null) assert.ok(!Object.hasOwn(target, field));
            else assert.equal(target[field], value ?? 18000);
            assert.equal(call.options.signal, controller.signal);
        }
    });

    test(`${type}: streams only extracted text, preserves usage and thinking`, async () => {
        const h = setup(type);
        h.respond(() => streamResponse(type === 'openai' ? openaiStream(output, '\r\n', 1) : event(geminiResponse()), 1));
        const result = await collectStream(h.api, { maxOutputTokens: null }).promise;
        assert.equal(result.content, output);
        assert.equal(result.tokens.join(''), output);
        assert.equal(result.thinking.join(''), type === 'openai' ? '准备生成' : '计划中');
        assert.equal(result.terminal.length, 1);
        assert.ok(result.usage);
        assert.equal(h.calls[0].body.tools.length, 1);
        if (type === 'openai') {
            assert.equal(h.calls[0].body.stream, true);
            assert.equal(h.calls[0].body.max_tokens, undefined);
            assert.ok(result.tokens.length > 5);
        } else {
            assert.match(h.calls[0].url, /:streamGenerateContent\?alt=sse&key=/);
            assert.equal(h.calls[0].body.generationConfig.maxOutputTokens, undefined);
        }
    });

    test(`${type}: plain streaming stays unchanged when disabled`, async () => {
        const h = setup(type, false);
        h.respond(() => streamResponse(type === 'openai'
            ? event({ choices: [{ delta: { content: '原样' } }] }) + event('[DONE]')
            : event({ candidates: [{ content: { parts: [{ text: '原样' }] } }] })));
        assert.equal((await collectStream(h.api).promise).content, '原样');
        assert.equal(h.calls[0].body.tools, undefined);
    });

    test(`${type}: draft message test validates tool protocol without persisting it`, async () => {
        const h = setup(type, false);
        const before = JSON.stringify(h.api.getConfig());
        const saved = h.store.get('jxz_apiConfig');
        for (const streamMode of ['non-stream', 'stream']) {
            h.respond(() => streamMode === 'stream'
                ? streamResponse(type === 'openai' ? openaiStream() : event(geminiResponse()))
                : jsonResponse(type === 'openai' ? openaiResponse() : geminiResponse()));
            const result = await h.api.sendTestMessage({ ...baseConfig, type, toolOutputEnabled: true, streamMode, corsProxyEnabled: true, corsProxyUrl: 'https://relay.example' });
            assert.equal(result.success, true, result.error);
            assert.equal(result.content, output);
            assert.equal(new URL(h.calls.at(-1).url).origin, 'https://relay.example');
            assert.ok(h.calls.at(-1).body.tools);
        }
        assert.equal(JSON.stringify(h.api.getConfig()), before);
        assert.equal(h.store.get('jxz_apiConfig'), saved);
    });

    test(`${type}: does not silently fall back or report success on unsupported tools`, async () => {
        const h = setup(type);
        h.respond(() => jsonResponse({ error: { message: 'tools unsupported' } }, 400));
        await assert.rejects(h.api.sendMessages(messages), /400.*tools unsupported/);
        assert.equal(h.calls.length, 1);
        const draft = await h.api.sendTestMessage({ ...baseConfig, type, toolOutputEnabled: true });
        assert.equal(draft.success, false);
        assert.match(draft.error, /400/);
    });

    test(`${type}: output mode is captured before an in-flight config change`, async () => {
        const h = setup(type);
        h.respond(() => {
            h.api.updateConfig({ toolOutputEnabled: false });
            return jsonResponse(type === 'openai' ? openaiResponse() : geminiResponse());
        });
        assert.equal((await h.api.sendMessages(messages)).content, output);
    });

    const invalid = type === 'openai' ? [
        ['empty', openaiResponse({ display_stream: '' })],
        ['missing field', openaiResponse({ other: 'x' })],
        ['wrong field type', openaiResponse({ display_stream: {} })],
        ['invalid JSON', openaiResponse('{"display_stream":"incomplete')],
        ['truncated', openaiResponse(undefined, 'length')],
        ['filtered', openaiResponse(undefined, 'content_filter')],
        ['plain text', { choices: [{ message: { content: '不是工具调用' } }] }],
        ['refusal', { choices: [{ message: { refusal: 'not allowed' } }] }],
        ['empty candidates', { choices: [] }],
        ['wrong tool', { choices: [{ message: { tool_calls: [{ function: { name: 'other', arguments: '{"display_stream":"x"}' } }] } }] }]
    ] : [
        ['empty', geminiResponse({ display_stream: '' })],
        ['missing field', geminiResponse({ other: 'x' })],
        ['wrong field type', geminiResponse({ display_stream: 42 })],
        ['truncated', geminiResponse(undefined, 'MAX_TOKENS')],
        ['filtered', geminiResponse(undefined, 'SAFETY')],
        ['malformed', geminiResponse(undefined, 'MALFORMED_FUNCTION_CALL')],
        ['blocked', { promptFeedback: { blockReason: 'SAFETY' } }],
        ['plain text', { candidates: [{ content: { parts: [{ text: '不是工具调用' }] } }] }],
        ['empty candidates', { candidates: [] }]
    ];
    for (const [label, data] of invalid) {
        test(`${type}: rejects ${label} response instead of committing empty/corrupt output`, async () => {
            const h = setup(type);
            h.respond(() => jsonResponse(data));
            await assert.rejects(h.api.sendMessages(messages), /预设穿甲强化/);
        });
    }
}

test('old persisted configurations default off; the new boolean persists', () => {
    const h = setup();
    h.store.set('jxz_apiConfig', JSON.stringify(baseConfig));
    const context = { console, localStorage: { getItem: key => h.store.get(key), setItem: (key, val) => h.store.set(key, val) } };
    vm.createContext(context);
    vm.runInContext(source, context);
    context.apiService.loadConfig();
    assert.equal(context.apiService.getConfig().toolOutputEnabled, false);
    context.apiService.updateConfig({ toolOutputEnabled: true });
    assert.equal(JSON.parse(h.store.get('jxz_apiConfig')).toolOutputEnabled, true);
});

test('OpenAI incremental JSON decoder handles every escape split, UTF-16 pairs and no final newline', async () => {
    const h = setup();
    const raw = '{"display_stream":"A\\n\\t\\r\\b\\f\\/\\\\\\\"\\u4e2d\\ud83d\\ude00Z"}';
    const expected = JSON.parse(raw).display_stream;
    h.respond(() => streamResponse(openaiStream('', '\n', 1, raw).trimEnd(), 1));
    const result = await collectStream(h.api).promise;
    assert.equal(result.content, expected);
    assert.equal(result.tokens.join(''), expected);
    for (const token of result.tokens) assert.ok(!/[\uD800-\uDBFF]$/.test(token));
});

test('OpenAI preview finds top-level display_stream regardless of field order, skipping nested same-name keys', async () => {
    const h = setup();
    const raw = JSON.stringify({ extra: { display_stream: 'NOT THE RESULT', arr: ['"}{', { display_stream: 'X' }] }, n: 1, display_stream: output, after: true });
    h.respond(() => streamResponse(openaiStream('', '\n', 1, raw)));
    const result = await collectStream(h.api).promise;
    assert.equal(result.content, output);
    assert.equal(result.tokens.join(''), output);
    assert.ok(result.tokens.length > 5, 'should stream incrementally even when not the first field');
    assert.ok(!result.tokens.join('').includes('NOT THE RESULT'));
});

test('OpenAI preview handles escaped quotes/keys before display_stream', async () => {
    const h = setup();
    const raw = '{ "a\\"b" : "x\\"display_stream\\":\\"no" , "display_stream" : "好\\n的" }';
    h.respond(() => streamResponse(openaiStream('', '\n', 1, raw)));
    const result = await collectStream(h.api).promise;
    assert.equal(result.content, '好\n的');
    assert.equal(result.tokens.join(''), '好\n的');
});

test('OpenAI late tool name releases buffered preview immediately on name arrival', async () => {
    const h = setup();
    const args = JSON.stringify({ display_stream: '早到的正文' });
    let sse = '';
    for (let i = 0; i < args.length; i += 3) sse += event(openaiDelta({ arguments: args.slice(i, i + 3) }));
    sse += event(openaiDelta({ name: toolName }));
    // 名称到达后还有一些事件，确认释放发生在名称事件而非结束时
    sse += event({ choices: [{ delta: { reasoning_content: '尾' } }] });
    sse += event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + event('[DONE]');
    const order = [];
    h.respond(() => streamResponse(sse, 65536));
    const tokens = [];
    const result = await new Promise((resolve, reject) => h.api.sendMessagesStream(messages, {
        onToken(t) { tokens.push(t); order.push('token'); },
        onThinking() { order.push('thinking'); },
        onComplete(content) { resolve(content); },
        onError: reject
    }));
    assert.equal(result, '早到的正文');
    assert.equal(tokens.join(''), '早到的正文');
    assert.deepEqual(order, ['token', 'thinking']);
});

test('tool protocol errors are flagged noFallback; transient ones are not', async () => {
    const cases = [
        ['no tool', event({ choices: [{ delta: { content: '好的，我明白了' }, finish_reason: 'stop' }] }) + event('[DONE]'), true],
        ['wrong name', event(openaiDelta({ name: 'other', arguments: '{}' })) + event('[DONE]'), true],
        ['length', event(openaiDelta({ name: toolName, arguments: '{"display_stream":"x"}' })) + event({ choices: [{ delta: {}, finish_reason: 'length' }] }), true],
        ['missing terminal', event(openaiDelta({ name: toolName, arguments: JSON.stringify({ display_stream: output }) })), false],
        ['server error event', event({ error: { message: 'upstream disconnected' } }), false]
    ];
    for (const [label, sse, expected] of cases) {
        const h = setup();
        h.respond(() => streamResponse(sse));
        const err = await collectStream(h.api).promise.then(() => null, e => e);
        assert.ok(err, label);
        assert.equal(Boolean(err.noFallback), expected, label);
    }
});

test('tool-mode stream HTTP 4xx is noFallback, 5xx/408 are retryable; plain mode never flagged', async () => {
    for (const [status, toolMode, expected] of [[400, true, true], [429, true, true], [408, true, false], [504, true, false], [400, false, false]]) {
        const h = setup('openai', toolMode);
        h.respond(() => new Response('bad', { status }));
        const err = await collectStream(h.api).promise.then(() => null, e => e);
        assert.equal(err.status, status);
        assert.equal(Boolean(err.noFallback), expected, `${status}/${toolMode}`);
    }
});

test('failure diagnostics summarize plain-text replies without leaking keys', async () => {
    const ctxWarn = [];
    const context = {
        AbortController, TextDecoder, URL,
        console: { log() {}, warn(msg) { ctxWarn.push(String(msg)); } },
        window: { location: { protocol: 'https:' } },
        localStorage: { getItem: () => null, setItem() {} },
        fetch: async () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '好的，我明白了，接下来我会……' } }], usage: { completion_tokens: 26 } })
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    context.apiService.updateConfig({ ...baseConfig, toolOutputEnabled: true });
    const err = await context.apiService.sendMessages(messages).then(() => null, e => e);
    assert.ok(err && err.noFallback);
    assert.equal(err.diagnostic.finishReason, 'stop');
    assert.match(err.diagnostic.content, /好的，我明白了/);
    assert.equal(err.diagnostic.toolCalls.length, 0);
    assert.equal(err.diagnostic.completionTokens, 26);
    assert.ok(ctxWarn.some(w => w.includes('非流式解包失败') && w.includes('好的')));
    assert.ok(!ctxWarn.join('').includes('fake-key'));
});

test('stream diagnostics report arg chunk count and plain content on success and failure', async () => {
    const logs = [];
    const mk = () => {
        const context = {
            AbortController, TextDecoder, URL,
            console: { log(m) { logs.push(String(m)); }, warn(m) { logs.push(String(m)); } },
            window: { location: { protocol: 'https:' } },
            localStorage: { getItem: () => null, setItem() {} },
            fetch: null
        };
        vm.createContext(context);
        vm.runInContext(source, context);
        context.apiService.updateConfig({ ...baseConfig, toolOutputEnabled: true });
        return context;
    };
    let ctx = mk();
    ctx.fetch = async () => streamResponse(event(openaiDelta({ name: toolName, arguments: JSON.stringify({ display_stream: output }) })) + event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + event('[DONE]'));
    await new Promise((resolve, reject) => ctx.apiService.sendMessagesStream(messages, { onToken() {}, onComplete: resolve, onError: reject }));
    const ok = logs.find(l => l.includes('流式诊断'));
    assert.ok(ok);
    assert.match(ok, /"参数片段数":1/);
    assert.match(ok, /一次性返回/);
    logs.length = 0;
    ctx = mk();
    ctx.fetch = async () => streamResponse(event({ choices: [{ delta: { content: '好的' }, finish_reason: 'stop' }] }) + event('[DONE]'));
    await new Promise(resolve => ctx.apiService.sendMessagesStream(messages, { onToken() {}, onComplete: resolve, onError: resolve }));
    const bad = logs.find(l => l.includes('流式解包失败'));
    assert.ok(bad);
    assert.match(bad, /"普通文本\(content\)":"好的"/);
    assert.match(bad, /"参数片段数":0/);
});

for (const [label, sse] of [
    ['truncated JSON', openaiStream('', '\n', 2, '{"display_stream":"half')],
    ['bad escape', openaiStream('', '\n', 2, '{"display_stream":"\\q"}')],
    ['length finish', event(openaiDelta({ name: toolName, arguments: JSON.stringify({ display_stream: 'partial' }) })) + event({ choices: [{ delta: {}, finish_reason: 'length' }] })],
    ['missing terminal', event(openaiDelta({ name: toolName, arguments: JSON.stringify({ display_stream: output }) }))],
    ['invalid event JSON', 'data: {NOT JSON}\n\n'],
    ['server error', event({ error: { message: 'upstream disconnected' } })],
    ['wrong name', event(openaiDelta({ name: 'other', arguments: '{}' })) + event('[DONE]')],
    ['second call index', event({ choices: [{ delta: { tool_calls: [{ index: 1, function: { name: toolName, arguments: '{}' } }] } }] })],
    ['no tool', event({ choices: [{ delta: { content: 'plain' }, finish_reason: 'stop' }] }) + event('[DONE]')]
]) {
    test(`OpenAI stream rejects ${label}, invoking only error callback`, async () => {
        const h = setup();
        h.respond(() => streamResponse(sse));
        const run = collectStream(h.api);
        await assert.rejects(run.promise, /预设穿甲强化/);
        assert.deepEqual(run.terminal, ['error']);
    });
}

test('Gemini stream accepts multi-line SSE and final finish-only event', async () => {
    const h = setup('gemini');
    const response = geminiResponse();
    delete response.candidates[0].finishReason;
    const formatted = JSON.stringify(response, null, 2).split('\n').map(line => 'data: ' + line).join('\r\n') + '\r\n\r\n';
    h.respond(() => streamResponse(': heartbeat\r\n\r\n' + formatted + 'data:' + JSON.stringify({ candidates: [{ finishReason: 'STOP' }] }), 3));
    assert.equal((await collectStream(h.api).promise).content, output);
});

for (const [label, sse] of [
    ['duplicate calls', event(geminiResponse()) + event(geminiResponse())],
    ['MAX_TOKENS', event(geminiResponse(undefined, 'MAX_TOKENS'))],
    ['SAFETY', event({ promptFeedback: { blockReason: 'SAFETY' } })],
    ['missing finish', event({ candidates: [{ content: { parts: [{ functionCall: { name: toolName, args: { display_stream: output } } }] } }] })]
]) {
    test(`Gemini stream rejects ${label}`, async () => {
        const h = setup('gemini');
        h.respond(() => streamResponse(sse));
        const run = collectStream(h.api);
        await assert.rejects(run.promise, /预设穿甲强化/);
        assert.deepEqual(run.terminal, ['error']);
    });
}

test('abort does not submit unvalidated tool preview or trigger the error-retry path', async () => {
    const h = setup();
    h.respond((url, opts) => new Response(new ReadableStream({ start(controller) {
        opts.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
        controller.enqueue(new TextEncoder().encode(event(openaiDelta({ name: toolName, arguments: '{"display_stream":"已生成' }))));
    } })));
    const result = await collectStream(h.api, undefined, (text, handle) => handle.abort()).promise;
    assert.equal(result.content, '');
    assert.equal(result.tokens.join(''), '已生成');
    assert.deepEqual(result.terminal, ['complete']);
    h.respond(() => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('network failure')); } })));
    const run = collectStream(h.api);
    await assert.rejects(run.promise, /network failure/);
    assert.deepEqual(run.terminal, ['error']);
});

for (const type of ['openai', 'gemini']) {
    test(`${type}: accepts CR-only SSE separators across byte boundaries`, async () => {
        const h = setup(type);
        h.respond(() => streamResponse(type === 'openai' ? openaiStream(output, '\r') : event(geminiResponse(), '\r'), 1));
        assert.equal((await collectStream(h.api).promise).content, output);
    });

    test(`${type}: unrequested AbortError is an error, not a successful empty result`, async () => {
        const h = setup(type);
        h.respond(() => new Response(new ReadableStream({ start(controller) {
            controller.error(new DOMException('Transport aborted', 'AbortError'));
        } })));
        const run = collectStream(h.api);
        await assert.rejects(run.promise, /Transport aborted/);
        assert.deepEqual(run.terminal, ['error']);
    });

    test(`${type}: cancellation takes priority over errors later in the same buffered packet`, async () => {
        const h = setup(type);
        const first = type === 'openai'
            ? openaiDelta({ name: toolName, arguments: '{"display_stream":"preview' })
            : geminiResponse();
        h.respond(() => streamResponse(event(first) + event({ error: { message: 'late error' } }), 65536));
        const result = await collectStream(h.api, undefined, (text, handle) => handle.abort()).promise;
        assert.equal(result.content, '');
        assert.deepEqual(result.terminal, ['complete']);
    });

    test(`${type}: cancelling on last token never publishes the decoded preview as final`, async () => {
        const h = setup(type);
        h.respond(() => streamResponse(type === 'openai' ? openaiStream() : event(geminiResponse()), 65536));
        const result = await collectStream(h.api, undefined, (text, handle) => handle.abort()).promise;
        assert.equal(result.content, '');
        assert.equal(result.tokens.join(''), output);
        assert.deepEqual(result.terminal, ['complete']);
    });
}

test('all generation callers route via the common API service (embeddings and model-list excluded)', () => {
    for (const name of ['pipeline', 'summary-runner', 'event-runner', 'location-runner', 'bounty-service', 'side-quest-runner']) {
        const src = fs.readFileSync(new URL(`../module/${name}.js`, import.meta.url), 'utf8');
        assert.match(src, /apiService\.sendMessages\(/);
        assert.match(src, /apiService\.sendMessagesStream\(/);
        assert.doesNotMatch(src, /\bfetch\(/);
    }
});
