// 玩家在同一条消息上切模型试听，旧录音仍能独立回听。
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { startTestServer } from '../scene3d/scripts/test-server.mjs';
import { launchBrowser, newGameContext, startGame, json, fixturesRoot, workspace } from '../scene3d/scripts/test-support.mjs';

const server = await startTestServer({ gameRoot: workspace });
const browser = await launchBrowser();
let session;
try {
    session = await newGameContext(browser, server, { payload: await json(path.join(fixturesRoot, 'saves/map.json')), channel: 'single-model' });
    const page = session.page;
    await startGame(session, server);
    const mp3 = [...await readFile(path.join(fixturesRoot, 'audio/silence.mp3'))];
    await page.evaluate(async bytes => {
        closeModal();
        const raw = '「等一下。」【D；自然】|山门|12:00|萧白瑚:平静|none';
        const plan = await speechPlan.fromMainText(raw, speechRound.characters());
        storageService.replaceUIConversation([{ id: 'public-one', role: 'assistant', createdAt: 1, content: plan.source,
            singleSpeech: { ...plan, targetNpcId: 'D', finishReason: 'stop', renderVersion: 'drama3-v1' } }]);
        renderMainText(plan.source);
        apiService.updateConfig({ corsProxyEnabled: true, corsProxyUrl: 'https://proxy.example' });
        await speechService.saveConfig({ enabled: true, provider: { kind: 'fish-drama3', apiKey: 'fixture', model: 'drama-3' } });
        window.__voices = [];
        window.__played = [];
        speechPlayer.subscribe(s => { if (s.phase === 'playing') __played.push(s.turnId); });
        const original = window.fetch;
        window.fetch = (url, opts) => {
            if (new URL(url, location.href).origin !== 'https://proxy.example') return original(url, opts);
            __voices.push(new Headers(opts.headers).get('model'));
            return Promise.resolve(new Response(new Uint8Array(bytes), { headers: { 'content-type': 'audio/mpeg' } }));
        };
    }, mp3);
    page.removeAllListeners('dialog');
    page.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss());
    for (const [i, model] of ['drama-3','s2.1-pro','drama-3'].entries()) {
        await page.evaluate(async model => {
            await speechService.saveConfig({ provider: { kind: 'fish-drama3', model } });
            await speechSingleTest.open();
        }, model);
        await page.waitForFunction(() => !document.getElementById('sst-generate').disabled);
        await page.click(i < 2 ? '#sst-generate' : '#sst-play');
        await page.waitForFunction(n => __played.length === n, { timeout: 7000 }, i + 1);
        await page.click('#sst-close');
    }
    const result = await page.evaluate(() => ({ sent: __voices, played: __played }));
    assert.deepEqual(result.sent, ['drama-3','s2.1-pro']);
    assert.equal(result.played[0],result.played[2]);
    assert.notEqual(result.played[0],result.played[1]);
    console.log('PASS: 同句两模型合成两次，三次实点播放，切回 D3 复用原录音。');
} finally {
    if (session) await session.close();
    await browser.close();
    await server.close();
}
