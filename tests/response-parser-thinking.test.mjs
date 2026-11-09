import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../module/response-parser.js', import.meta.url), 'utf8');
const context = vm.createContext({ console, window: {} });
vm.runInContext(source, context);
const parser = context.responseParser;
const main = '你推门走进书阁，借了一本游记。';
const summary = '主角前往书阁借阅游记。';
const note = { 用户: { 位置变动: '书阁' }, 当前NPC: {} };
const body = `<SLG_MODE>\n<MAIN_TEXT>${main}</MAIN_TEXT>\n<SUMMARY>${summary}</SUMMARY>\n<SIDE_NOTE>${JSON.stringify(note)}</SIDE_NOTE>\n</SLG_MODE>`;
// Reproduce the reported tag structure using neutral story content only.
const thinking = '<thinking>Plan a walk from the kitchen (伙房). Follow `<tone>`, `<writing_style>`, `<FormatGuide>` and `<ANALGuidance>`.\n' +
    'Draft examples: <MAIN_TEXT>草稿正文</MAIN_TEXT><SUMMARY>草稿摘要</SUMMARY><SIDE_NOTE>{"草稿":true}</SIDE_NOTE>\n</thinking>';
const analysis = '<ANAL_for_JXZ>场景计划：前往书阁。引用 "<LatestReply>"、"<UserInfo>" 和 "<NPCInformationD>"。\n' +
    '格式声明：随后遵守 <FormatGuide>。\n</ANAL_for_JXZ>';
const reply = thinking + '\n' + analysis + '\n' + body;

function assertResult(raw) {
    const result = parser.run(raw);
    assert.equal(result.raw, raw, 'keep the raw reply for diagnostics');
    assert.equal(result.cleanedText, body);
    assert.equal(result.mainText, main);
    assert.deepEqual(Array.from(result.summaries), [summary]);
    assert.equal(JSON.stringify(result.sideNote), JSON.stringify(note));
}

test('reported thinking + quoted guidance + ANAL structure preserves the full final reply', () => assertResult(reply));

test('plain and legacy replies keep their existing parsing behavior', () => {
    assertResult(body);
    const legacy = parser.run('旧格式的正文。\n<SUMMARY>旧摘要。</SUMMARY><SIDE_NOTE>{"用户":{}}</SIDE_NOTE>');
    assert.equal(legacy.mainText, '旧格式的正文。');
    assert.deepEqual(Array.from(legacy.summaries), ['旧摘要。']);
    assert.equal(JSON.stringify(legacy.sideNote), '{"用户":{}}');
});

for (const [open, close] of [
    ['think', 'think'], ['thinking', 'thinking'], ['ANAL_for_JXZ', 'ANAL_for_JXZ'],
    ['analysis', 'analysis'], ['ANAL', 'ANAL'],
    [' THINK_ING ', ' think_ing '], [' A N A L _ f o r _ J X Z ', 'anal_for_jxz'],
    ['thinking class="reasoning"', 'thinking']
]) {
    test(`removes supported reasoning wrapper <${open}> without touching the answer`, () => {
        assertResult(`<${open}>计划与 <FormatGuide>、<UserInfo> 引用。</${close}>\n${body}`);
    });
}

test('nested thinking/analysis blocks are removed without pairing unrelated tags', () => {
    assertResult('<thinking>外层<thinking>内层</thinking><analysis>更多计划</analysis>外层结束</thinking>' + body);
    assertResult('<ANAL_for_JXZ><UserInfo>资料</UserInfo><think>计划</think></ANAL_for_JXZ>' + body);
    assertResult('<thinking>引用 <analysis> 的名字，但最终结束外层。</thinking>' + body);
});

test('inline quoted reasoning tag names do not change the nesting depth', () => {
    assertResult('<thinking>Use `<thinking>` or `<ANAL_for_JXZ>` wrappers.</thinking>' + body);
    assert.equal(parser.removeThinkingContent('说明中提到 `<thinking>` 标签。'), '说明中提到 `<thinking>` 标签。');
});

test('quoted tag references, code spans and comment delimiters cannot hide the final answer', () => {
    for (const reference of ['“<ANAL>”', '「<ANAL>」', '『<ANAL>』', '‘<ANAL>’', '` <ANAL> `', '"文字 <ANAL> 标签"', '"<!--"']) {
        assertResult(`<ANAL>引用 ${reference} 的名字，不是嵌套块。</ANAL>${body}`);
    }
    assertResult('<thinking>Use a comment opener <!-- in the draft.</thinking>' + body);
    assertResult('<thinking>引用 <!-- <thinking> </ANAL> --> 的例子。</thinking>' + body);
    assertResult('<thinking>Let\'s check the plan. It\'s ready.</thinking>' + body);
});

test('background JSON strings preserve literal thinking tags and escaped quotation marks', () => {
    for (const description of ['阅读 <thinking> 标签说明', '<thinking>需要保留的内容</thinking>', '引用“<ANAL>”与 "<thinking>" 的说明', '字符串中的 \\" 与 <thinking>']) {
        const json = JSON.stringify({ 行动建议: [description], 子场景: {} });
        const raw = `<LOCATION>${json}</LOCATION>`;
        assert.equal(parser.removeThinkingContent(raw), raw);
        assert.equal(parser.extractXmlBlock(thinking + raw, 'LOCATION').content, json);
        assert.equal(JSON.parse(parser.extractXmlBlock(raw, 'LOCATION').content).行动建议[0], description);
    }
});

test('quoted references remain hidden at every streaming prefix of the reasoning block', () => {
    for (const reference of ['“<ANAL>”', '「<ANAL>」', '` <ANAL> `', '"<!--"', '`<!--`']) {
        const prefix = `<ANAL>只是在引用 ${reference} 的名字。</ANAL>`;
        for (let end = 0; end <= prefix.length; end++) {
            assert.equal(parser.extractMainText(prefix.slice(0, end)), '');
        }
        assertResult(prefix + body);
    }
});

test('final prose keeps literal markup inside an inline code span', () => {
    const content = '示例 `<thinking>需要保留的内容</thinking>`，不是实际思考块。';
    const raw = `<MAIN_TEXT>${content}</MAIN_TEXT>`;
    assert.equal(parser.removeThinkingContent(raw), raw);
    assert.equal(parser.extractMainText(raw), content);
});

test('the actual location parser preserves literal tag text inside final JSON', () => {
    const locationSource = fs.readFileSync(new URL('../module/location-runner.js', import.meta.url), 'utf8');
    const fn = /    function parseLocationJson\(raw\) \{[^]*?\n    \}/.exec(locationSource)?.[0];
    assert.ok(fn);
    const c = vm.createContext({ responseParser: parser, console, window: {} });
    vm.runInContext(fn, c);
    for (const description of ['阅读 <thinking> 标签说明', '示例 <thinking>需要保留的内容</thinking> 说明']) {
        const json = JSON.stringify({ 行动建议: [description], 子场景: {} });
        const parsed = c.parseLocationJson(thinking + `<LOCATION>${json}</LOCATION>`);
        assert.equal(JSON.stringify(parsed), json);
    }
});

test('unknown tags containing ANAL or think are not treated as reasoning boundaries', () => {
    const text = '<channel>频道</channel><ANALGuidance>格式说明</ANALGuidance><ThinkGuidance>说明</ThinkGuidance>' + body;
    assert.equal(parser.removeThinkingContent(text), text);
    assert.equal(parser.extractMainText(text), main);
    assert.equal(parser.removeThinkingContent('<MAIN_TEXT>引用 <ANALGuidance> 不应截断后文。</MAIN_TEXT>'), '<MAIN_TEXT>引用 <ANALGuidance> 不应截断后文。</MAIN_TEXT>');
});

test('unclosed reasoning hides its tail, including complete-looking answer examples', () => {
    assert.equal(parser.removeThinkingContent('<thinking>尚未结束 ' + body), '');
    assert.equal(parser.extractMainText('<think>尚未结束 ' + body), '');
    assert.equal(parser.extractXmlBlock('<ANAL_for_JXZ>尚未结束 <SUMMARY>样例</SUMMARY>', 'SUMMARY').found, false);
    assert.equal(parser.removeThinkingContent(body + '<thinking>尚未结束'), body);
});

test('every streaming prefix before the real answer hides thoughts and fake structured output', () => {
    const start = reply.indexOf(body);
    for (let end = 0; end <= start; end++) {
        const prefix = reply.slice(0, end);
        assert.equal(parser.extractMainText(prefix), '', `unexpected preview at prefix ${end}`);
        assert.equal(parser.extractXmlBlock(prefix, 'SUMMARY').found, false, `draft summary at prefix ${end}`);
        assert.equal(parser.extractSideNoteJson(prefix), null, `draft JSON at prefix ${end}`);
    }
    const mainStart = reply.lastIndexOf('<MAIN_TEXT>') + '<MAIN_TEXT>'.length;
    for (let end = 1; end <= main.length; end++) {
        assert.equal(parser.extractMainText(reply.slice(0, mainStart + end)), main.slice(0, end));
    }
});

test('each public extractor ignores complete reasoning even when called with raw output', () => {
    assert.equal(parser.extractMainText(reply), main);
    assert.deepEqual(Array.from(parser.extractSummaries(reply)), [summary]);
    assert.equal(JSON.stringify(parser.extractSideNoteJson(reply)), JSON.stringify(note));
    const block = parser.extractXmlBlock(reply, 'MAIN_TEXT');
    assert.equal(block.closed, true);
    assert.equal(block.content, main);
});

for (const tag of ['SUMMARY', 'LOCATION', 'EVENT', 'BOUNTY', 'SIDE_QUEST_RUMORS', 'SIDE_QUEST_TREE', 'SIDE_QUEST_CHECK']) {
    test(`background ${tag} ignores sample tags inside reasoning`, () => {
        const raw = `<thinking>Example: <${tag}>草稿</${tag}>. Check <ANALGuidance>.</thinking>` +
            `<ANAL_for_JXZ>计划：<${tag}>另一份草稿</${tag}></ANAL_for_JXZ>` + `<${tag}>最终结果</${tag}>`;
        const result = parser.extractXmlBlock(raw, tag);
        assert.equal(result.found, true);
        assert.equal(result.closed, true);
        assert.equal(result.content, '最终结果');
    });
}

test('truncated final blocks remain invalid; thinking removal does not invent missing data', () => {
    const partial = thinking + analysis + '<SLG_MODE><MAIN_TEXT>部分正文';
    assert.equal(parser.run(partial).mainText, '部分正文');
    assert.equal(parser.run(partial).sideNote, null);
    const block = parser.extractXmlBlock(thinking + analysis + '<LOCATION>{"位置":"书阁"}', 'LOCATION');
    assert.equal(block.found, true);
    assert.equal(block.closed, false);
    assert.equal(block.content, '');
});

test('cleaning is idempotent and handles empty, self-closing and stray closing tags', () => {
    assert.equal(parser.removeThinkingContent(null), '');
    assert.equal(parser.removeThinkingContent(''), '');
    assert.equal(parser.removeThinkingContent(parser.removeThinkingContent(reply)), body);
    assertResult('<thinking/><ANAL_for_JXZ />' + body + '</thinking>');
});

test('index inline parser entry delegates to the shared cleaner', () => {
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const fn = /        function removeThinkingContent\(content\) \{[^]*?\n        \}/.exec(html)?.[0];
    assert.ok(fn);
    const page = vm.createContext({ responseParser: parser, console });
    vm.runInContext(fn, page);
    assert.equal(page.removeThinkingContent(reply), body);
});

for (const type of ['openai', 'gemini']) for (const stream of [false, true]) for (const enabled of [false, true]) {
    test(`${type} ${stream ? 'stream' : 'non-stream'} ${enabled ? 'tool' : 'plain'} response reaches real parser intact`, async () => {
        const apiSource = fs.readFileSync(new URL('../module/api-service.js', import.meta.url), 'utf8');
        const observed = [];
        const c = vm.createContext({
            console: { log() {}, warn() {} }, window: {}, AbortController, TextDecoder,
            localStorage: { getItem() { return null; }, setItem() {} },
            fetch: async (_url, opts) => {
                const request = JSON.parse(opts.body);
                assert.equal(Boolean(request.tools), enabled);
                const name = 'submit_game_output';
                const fn = { name, arguments: JSON.stringify({ display_stream: reply }) };
                const data = type === 'gemini'
                    ? { candidates: [{ finishReason: 'STOP', content: { parts: [enabled
                        ? { functionCall: { name, args: { display_stream: reply } } } : { text: reply }] } }] }
                    : { choices: [{ finish_reason: enabled ? 'tool_calls' : 'stop', message: enabled
                        ? { tool_calls: [{ function: fn }] } : { content: reply } }] };
                if (!stream) return new Response(JSON.stringify(data));
                const events = [];
                if (type === 'openai') {
                    if (enabled) events.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name } }] } }] });
                    const payload = enabled ? fn.arguments : reply;
                    for (let i = 0; i < payload.length; i += 7) {
                        const part = payload.slice(i, i + 7);
                        events.push({ choices: [{ delta: enabled
                            ? { tool_calls: [{ index: 0, function: { arguments: part } }] } : { content: part } }] });
                    }
                    events.push({ choices: [{ delta: {}, finish_reason: enabled ? 'tool_calls' : 'stop' }] });
                } else {
                    events.push(data); // Gemini's standard SSE delivers complete function args.
                }
                const wire = events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') +
                    (type === 'openai' ? 'data: [DONE]\n\n' : '');
                const bytes = new TextEncoder().encode(wire);
                return new Response(new ReadableStream({ start(controller) {
                    for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
                    controller.close();
                } }));
            }
        });
        vm.runInContext(source + '\n' + apiSource, c);
        c.apiService.updateConfig({ type, endpoint: 'https://fixture.invalid', apiKey: 'fake', model: 'fixture', toolOutputEnabled: enabled, corsProxyEnabled: false });
        const result = stream ? await new Promise((resolve, reject) => {
            let accumulated = '';
            c.apiService.sendMessagesStream([{ role: 'user', content: '请描写去书阁借书。' }], {
                onToken(delta) {
                    accumulated += delta;
                    observed.push(c.responseParser.extractMainText(c.responseParser.removeThinkingContent(accumulated)));
                },
                onComplete: content => resolve({ content }), onError: reject
            });
        }) : await c.apiService.sendMessages([{ role: 'user', content: '请描写去书阁借书。' }]);
        const parsed = c.responseParser.run(result.content);
        assert.equal(parsed.mainText, main);
        assert.equal(JSON.stringify(parsed.sideNote), JSON.stringify(note));
        if (stream) {
            assert.equal(observed.at(-1), main);
            for (const preview of observed) assert.doesNotMatch(preview, /草稿|Plan a walk|场景计划|FormatGuide/);
        }
    });
}
