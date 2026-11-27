// Public fixtures only: real send button, cached MP3s, single original commit; no paid traffic.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
    launchBrowser,
    newGameContext,
    startGame,
    json,
    fixturesRoot,
    workspace,
} from '../scene3d/scripts/test-support.mjs';
import { startTestServer } from '../scene3d/scripts/test-server.mjs';
const server = await startTestServer({ gameRoot: workspace }),
    browser = await launchBrowser();
const bytes = [...(await readFile(path.join(fixturesRoot, 'audio/silence.mp3')))];
try {
    for (const [name, ids, expected] of [
        ['mixed', ['D', 'OUTSIDER', 'UNKNOWN', 'M'], 2],
        ['silent', ['UNKNOWN', 'OUTSIDER'], 0],
        ['many', Array(25).fill('D'), 25],
        ['large-silent', Array(65).fill('D'), 0],
        ['off', ['D'], 0],
        ['missing', ['D', 'M', 'M', 'D'], 3],
        ['balance', ['D', 'M', 'D'], 2],
    ]) {
        const session = await newGameContext(browser, server, {
            payload: await json(path.join(fixturesRoot, 'saves/map.json')),
            channel: 'candidate-' + name,
            scene3dPreferences: { schema: 2, enabled: false },
        });
        try {
            const p = session.page;
            await startGame(session, server);
            await p.evaluate(
                async ({ name, ids, bytes }) => {
                    closeModal();
                    mediaContext.invalidate();
                    GameMode = 0;
                    gameData.GameMode = 0;
                    inputEnable = 1;
                    newWeek = 0;
                    gameData.newWeek = 0;
                    randomEvent = battleEvent = 0;
                    currentRandomEvent = currentBattleEvent = currentSpecialEvent = null;
                    actionPoints = 3;
                    isStoryExpanded = false;
                    currentPage = 0;
                    const source = '公开开场。|山门|09:00|萧白瑚:平静|none';
                    renderMainText(source);
                    storageService.replaceUIConversation([
                        { id: 'before', role: 'assistant', content: source, createdAt: 1 },
                    ]);
                    applyLayoutMode(1);
                    apiService.updateConfig({
                        endpoint: 'https://model.example/v1',
                        apiKey: 'fixture',
                        model: 'fixture',
                        streamMode: 'non-stream',
                        toolOutputEnabled: false,
                        corsProxyEnabled: true,
                        corsProxyUrl: 'https://proxy.example/',
                    });
                    await speechService.saveConfig({
                        provider: {
                            kind: 'fish-drama3', apiKey: 'fixture', speed: 1,
                            model: name === 'balance' ? 'drama-3' : 's2.1-pro',
                        },
                        voices: {
                            D: { kind: 'fish-drama3', speakerId: 'voice-D', version: '1' },
                            M: { kind: 'fish-drama3', speakerId: 'voice-M', version: '1' },
                        },
                    });
                    await speechRound.savePreferences({ enabled: name !== 'off' });
                    const rows = ids.map(
                        (id, i) =>
                            `「公开第${i + 1}句。」【${id}；自然】|山门|12:30|萧白瑚:平静;玄天青:平静|none`,
                    );
                    window.__counts = { main: 0, voice: 0, side: 0, cue: false };
                    const real = window.fetch;
                    window.fetch = async (url, opts) => {
                        const u = new URL(String(url), location.href);
                        if (u.origin !== 'https://proxy.example') return real(url, opts);
                        if (u.searchParams.get('target')?.startsWith('https://model.example/')) {
                            __counts.main++;
                            const reqMessages = JSON.parse(opts.body).messages;
                            __counts.cue = reqMessages.some((m) =>
                                m.content.includes('本轮准备配音：'),
                            );
                            __counts.formatCue = reqMessages.some((m) =>
                                m.content.includes('说话语气取值: 1-24字中文短句') && m.content.includes('以"性爱中，"开头'),
                            );
                            return Response.json({
                                choices: [
                                    {
                                        message: {
                                            content:
                                                '<MAIN_TEXT>' +
                                                rows.join('\n') +
                                                '</MAIN_TEXT><SUMMARY>公开摘要。</SUMMARY><SIDE_NOTE>{"时间":"12:30","用户":{"位置变动":"none"}}</SIDE_NOTE>',
                                        },
                                        finish_reason: 'stop',
                                    },
                                ],
                            });
                        }
                        if (u.searchParams.get('target') !== 'https://api.fish.audio/v1/tts')
                            throw Error('unexpected target');
                        const expectedModel = name === 'balance' ? 'drama-3' : 's2.1-pro';
                        if (new Headers(opts.headers).get('model') !== expectedModel) {
                            throw Error('合成请求未使用已选模型');
                        }
                        __counts.voice++;
                        if (name === 'missing' && JSON.parse(opts.body).reference_id === 'voice-M')
                            return Response.json({ message: 'Reference not found' }, { status: 400 });
                        if (name === 'balance' && __counts.voice === 2)
                            return Response.json({ message: 'insufficient balance' }, { status: 402 });
                        return new Response(new Uint8Array(bytes), {
                            headers: { 'content-type': 'audio/mpeg' },
                        });
                    };
                    const after = sideQuestRunner.afterCommit;
                    sideQuestRunner.afterCommit = function (...args) {
                        __counts.side++;
                        return after.apply(this, args);
                    };
                    document.getElementById('free-action-input').value = '公开行动';
                },
                { ids, name, bytes },
            );
            await p.click('#stage-input');
            await p.click('#free-action-send-btn');
            if (name === 'large-silent') {
                // 大批量询价时不应已产生合成；选择无声继续后，仍须走正文原提交。
                await p.waitForSelector('#srd-silent', { visible: true });
                assert.equal(await p.evaluate(() => __counts.voice), 0);
                await p.waitForFunction(() => {
                    const button = document.querySelector('#srd-silent');
                    const rect = button.getBoundingClientRect();
                    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
                    return button.contains(hit) && !document.getAnimations().some(animation =>
                        animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)
                    );
                });
                await p.click('#srd-silent');
            }
            await p.waitForFunction(() => __counts.side > 0 && !pipeline.isBusy(), { timeout: 25000 });
            const got = await p.evaluate(() => {
                const h = storageService.loadUIConversation(),
                    last = h.at(-1);
                return {
                    ...__counts,
                    history: h.length,
                    allText: last.content,
                    stamp: last.roundSpeech?.status,
                };
            });
            assert.equal(got.main, 1);
            assert.equal(got.side, 1);
            assert.equal(got.history, 3);
            assert.equal(got.voice, expected);
            if (name === 'missing' || name === 'balance') {
                const playable = await p.evaluate(async () => {
                    const m = storageService.loadUIConversation().at(-1),
                        plan = presentationPlan.validate(m.content, m.presentationPlan),
                        binding = await speechRound.replay(m, plan, null);
                    const rows = [];
                    for (const u of binding.units) {
                        const blob = await speechRound.clip(binding, u);
                        if (blob.size > 0) rows.push(u.sourceLine);
                    }
                    return {
                        rows,
                        why: m.roundSpeech.voiceFailures[0].reason,
                        guard: speechService.guardProgress(),
                    };
                });
                assert.deepEqual(playable, {
                    rows: name === 'missing' ? [0, 3] : [0],
                    why: name === 'missing' ? 'missing-reference' : 'provider-unavailable',
                    guard: true,
                });
            }
            assert.equal(got.cue, false);
            assert.equal(got.formatCue, true);
            for (let i = 1; i <= ids.length; i++) assert.ok(got.allText.includes(`公开第${i}句。`));
            assert.ok(!got.allText.includes('【'));
            if (name !== 'off') assert.equal(got.stamp, expected ? 'ready' : 'silent');
            console.log(name, expected, 'clips, one publication');
        } finally {
            await session.close();
        }
    }
} finally {
    await browser.close();
    await server.close();
}
