// 从发送到回听：动作留在画面，Fish 只收到引语；旧包可用相同夹具做红绿对照。
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { startTestServer } from '../scene3d/scripts/test-server.mjs';
import { launchBrowser, newGameContext, startGame, json, fixturesRoot, workspace } from '../scene3d/scripts/test-support.mjs';

const mp3 = [...await readFile(path.join(fixturesRoot, 'audio/silence.mp3'))];
const reply = process.argv[2] ? await readFile(process.argv[2], 'utf8') : '';
const lines = reply ? [89, 120].map(n => reply.split(/\r?\n/)[n - 1]) : [
    '师兄放下书，抬起头来：「回来啦？吃饭了吗！」【A；自然】|议事厅|17:40|破阵子:平静|none',
    '师兄侧过身，向门口说道：「客人到了。快去开门！」【A；自然】|议事厅|18:10|破阵子:平静|none',
];
const expected = lines.map(line => {
    const m = /^(.*?：)(「[^「」]+」)【A；([^】]+)】\|/u.exec(line);
    assert.ok(m, '样本须含动作引入、说话人和完整引语');
    return { body: m[1] + m[2], wire: '[' + m[3] + '] ' + m[2] };
});
const server = await startTestServer({ gameRoot: process.env.JXZ_TEST_GAME_ROOT || workspace });
const browser = await launchBrowser();
let session;
try {
    session = await newGameContext(browser, server, {
        payload: await json(path.join(fixturesRoot, 'saves/map.json')),
        channel: 'quoted-turn', viewport: { width: 844, height: 390, isMobile: true, hasTouch: true },
        scene3dPreferences: { schema: 2, enabled: false },
    });
    const p = session.page;
    await startGame(session, server);
    // 可用已交付旧包中的编排脚本做对照；其余页面、输入和回听动作保持相同。
    if (process.env.JXZ_COMPARE_SPEECH_PLAN) {
        await p.addScriptTag({ path: process.env.JXZ_COMPARE_SPEECH_PLAN });
    }
    await p.evaluate(async ({ lines, mp3 }) => {
        closeModal(); mediaContext.invalidate(); GameMode = gameData.GameMode = 0;
        inputEnable = 1; newWeek = gameData.newWeek = 0; randomEvent = battleEvent = 0;
        currentRandomEvent = currentBattleEvent = currentSpecialEvent = null;
        isStoryExpanded = false; currentPage = 0; actionPoints = 3;
        const initial = '公开开场。|山门|09:00|破阵子:平静|none';
        renderMainText(initial);
        storageService.replaceUIConversation([{ id: 'initial', role: 'assistant', content: initial }]);
        applyLayoutMode(1);
        apiService.updateConfig({ endpoint: 'https://model.example/v1', apiKey: 'fixture', model: 'fixture', streamMode: 'non-stream', corsProxyEnabled: true, corsProxyUrl: 'https://proxy.example/' });
        await speechService.saveConfig({ provider: { kind: 'fish-drama3', apiKey: 'fixture', speed: 1 }, voices: { A: { kind: 'fish-drama3', speakerId: 'voice-A', version: '1' } } });
        await speechRound.savePreferences({ enabled: true });
        const probe = window.__quoteTest = { wire: [], plays: [], replies: 0 };
        speechPlayer.subscribe(s => { if (s.phase === 'playing') probe.plays.push(s.unitId); });
        const fetchOriginal = window.fetch;
        window.fetch = async (url, opts) => {
            const u = new URL(String(url), location.href);
            if (u.origin !== 'https://proxy.example') return fetchOriginal(url, opts);
            const target = u.searchParams.get('target');
            if (target === 'https://api.fish.audio/v1/tts') {
                probe.wire.push(JSON.parse(opts.body).text);
                return new Response(new Uint8Array(mp3), { headers: { 'content-type': 'audio/mpeg' } });
            }
            if (target !== 'https://model.example/v1/chat/completions') throw Error('夹具外的请求');
            probe.replies++;
            const content = '<MAIN_TEXT>' + lines.join('\n') + '</MAIN_TEXT><SUMMARY>验收摘要。</SUMMARY><SIDE_NOTE>{"时间":"18:10","用户":{"位置变动":"none"}}</SIDE_NOTE>';
            return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
        };
        document.getElementById('free-action-input').value = '继续交谈';
    }, { lines, mp3 });
    await p.click('#stage-input');
    await p.click('#free-action-send-btn');
    await p.waitForFunction(() => __quoteTest.replies && !pipeline.isBusy() && storageService.loadUIConversation().at(-1)?.roundSpeech?.status === 'ready');
    const wires = await p.evaluate(() => __quoteTest.wire);
    assert.equal(wires.length, 2);
    for (const [i, e] of expected.entries()) {
        assert.ok(wires[i] === e.wire, `第${i + 1}句合成范围不符`);
        assert.ok(await p.$eval('.stage-line p', (el, body) => el.textContent === body, e.body), '画面须保留旁白');
        await p.click('#stage-voice');
        await p.waitForFunction(n => __quoteTest.plays.length === n, {}, i + 1);
        if (!i) await p.click('.stage-line button:last-child');
    }
    const final = await p.evaluate(() => [__quoteTest.replies, __quoteTest.wire.length, new Set(__quoteTest.plays).size, storageService.loadUIConversation().length]);
    assert.deepEqual(final, [1, 2, 2, 3]);
    console.log('PASS: 1 reply; both requests contain only dialogue; both full frames retained; 2 distinct cached clips played; no synthesis on replay.');
} finally {
    if (session) await session.close();
    await browser.close();
    await server.close();
}
