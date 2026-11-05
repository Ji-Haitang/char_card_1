// Real page + real prompts/parser/snapshots, mocked model transport, isolated profile.
// node tests/side-quest-return-smoke.browser.mjs <NEW absolute evidence directory>
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { findBrowser, newGameContext, startGame, json, fixturesRoot, workspace, assertSessionSafe } from '../scene3d/scripts/test-support.mjs';
import { startTestServer } from '../scene3d/scripts/test-server.mjs';

const directory = process.argv[2];
assert.ok(directory && path.isAbsolute(directory), 'Provide a new absolute evidence directory');
await mkdir(directory);
const profile = path.join(directory, 'browser-profile');
await mkdir(profile);
const require = createRequire(new URL('../scene3d/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
let server, child, browser;
const results = [];

async function run(preset, stage, truncated) {
    const label = `${preset}-${stage}-${truncated ? 'retry' : 'success'}`;
    const session = await newGameContext(browser, server, {
        payload: await json(path.join(fixturesRoot, 'saves/gal.json')),
        channel: label, scene3dPreferences: { enabled: false },
        viewport: { width: preset === 'ny' ? 1280 : 390, height: 900, deviceScaleFactor: 1 }
    });
    const page = session.page;
    page.setDefaultTimeout(15000);
    try {
        await startGame(session, server);
        await page.evaluate(({ preset, stage, truncated }) => {
            closeModal();
            currentSpecialEvent = '';
            inputEnable = 1;
            currentRandomEvent = currentBattleEvent = currentBattleType = currentBattleReward = null;
            randomEvent = battleEvent = 0;
            GameMode = 1; mapLocation = '伊州'; companionNPC = ['施延年'];
            playerStats.声望 = 20;
            gameData.promptPreset = preset;
            gameData.locationVisit = null;
            gameData.sideQuestConfig = { enabled: true, confidenceThreshold: 0.7, deadlineWeeks: 0 };
            gameData.sideQuest = { active: null, history: [], lastRefreshWeek: 0, pendingReturnFailure: null };
            const active = gameData.sideQuest.active = {
                questId: 'sq-return-browser', title: '未竟之事', background: '同行者追查失落的信物。', playerGoal: '找回信物',
                started: true, status: stage === 'ending' ? 'completed' : 'active', currentNodeId: stage,
                relatedLocations: ['伊州'], relatedNpcs: ['H'], log: [], acceptedWeek: currentWeek,
                pendingEpilogue: stage === 'ending', endingId: stage === 'ending' ? 'ending' : null,
                nodes: {
                    free: { title: '追查信物', type: 'stage', interaction: 'free' },
                    choice: { title: '去留之择', type: 'stage', interaction: 'choice', options: [
                        { id: 'a', label: '继续寻找', next: 'ending' }, { id: 'b', label: '转向别处', next: 'ending' }
                    ] },
                    battle: { title: '拦路人', type: 'stage', interaction: 'battle', battle: {
                        enemyName: '拦路客', enemyCategory: '游侠', level: 1, introText: '有人挡住了路。', rewardGold: 100
                    } },
                    ending: { title: '信物归还', type: 'ending', endingType: 'success', epilogue: '归还信物后还有告别。',
                        rewards: { 'playerStats.声望': { add: 5 } } }
                },
                pendingInteraction: stage === 'battle' || stage === 'choice' ? { kind: stage, state: 'awaiting', nodeId: stage } : null
            };
            if (stage === 'ending') gameData.sideQuest.history.push({ questId: active.questId, title: active.title, outcome: 'completed', endingId: 'ending' });
            if (stage === 'battle') presentSideQuestBattle(active.nodes.battle);
            if (stage === 'choice') displaySideQuestChoice(active.nodes.choice);
            apiService.updateConfig({ streamMode: 'non-stream' });
            embeddingService.updateConfig({ enabled: false });
            eventRunner.maybeSchedule = () => {};
            locationRunner.scheduleLocationUpdate = () => {};
            window.__returnTest = { calls: [], truncated };
            apiService.sendMessages = async messages => {
                const prompt = messages.map(message => message.content).join('\n');
                if (prompt.includes('<SIDE_QUEST_CHECK>')) throw Error('Unexpected judge after deterministic failure');
                const guide = sideQuestService.buildGuideText();
                __returnTest.calls.push({
                    preset: gameData.promptPreset,
                    reputation: playerStats.声望, active: !!sideQuestService.getActive(), mode: GameMode,
                    location: mapLocation, companions: [...companionNPC], battleType: currentBattleType,
                    hasGuide: prompt.includes('【支线中途放弃·失败返程】'), guide,
                    conflictingGuide: prompt.includes('通过回山动机与返程见闻'),
                    locationConstraint: prompt.includes('本轮从【伊州】中途放弃任务返回【天山派】'),
                    input: lastUserMessage
                });
                if (__returnTest.truncated && __returnTest.calls.length === 1) return { content: '<MAIN_TEXT>你告别了未竟的追查，回到门派。|山门|09:00|none|none</MAIN_TEXT>' };
                return { content: '<MAIN_TEXT>你与施延年放弃未竟的追查，离开伊州返回天山派。|山门|09:00|none|none</MAIN_TEXT><SUMMARY>你中途放弃任务，与施延年回到天山派，支线失败。</SUMMARY><SIDE_NOTE>{"用户":{"位置变动":"none"},"剧情基调":"平淡"}</SIDE_NOTE>' };
            };
            syncGameDataFromVariables();
            updateSLGReturnButton();
            updateFreeActionInputState();
        }, { preset, stage, truncated });
        assert.equal(await page.$eval('#slg-return-btn', el => el.disabled), false);
        await page.$eval('#slg-return-btn', el => el.click());
        await page.waitForFunction(() => document.getElementById('modal').style.display === 'block');
        assert.match(await page.$eval('#modal-text', el => el.textContent), /任务失败/);
        await page.screenshot({ path: path.join(directory, label + '-confirmation.png') });
        await page.$eval('#modal-buttons .cancel', el => el.click());
        assert.deepEqual(await page.evaluate(() => [GameMode, mapLocation, playerStats.声望, !!sideQuestService.getActive(), __returnTest.calls.length]), [1, '伊州', 20, true, 0]);
        await page.$eval('#slg-return-btn', el => el.click());
        await page.$eval('#modal-buttons .modal-btn:not(.cancel)', el => el.click());
        await page.waitForFunction(() => __returnTest.calls.length === 1 && !pipeline.isBusy());
        const pending = await page.evaluate(() => !!gameData.sideQuest.pendingReturnFailure);
        assert.equal(pending, truncated);
        if (truncated) {
            await page.evaluate(() => handleRegenerate());
            await page.waitForSelector('#regen-msg-input');
            await page.$eval('#modal-buttons .modal-btn:not(.cancel)', el => el.click());
            await page.waitForFunction(() => __returnTest.calls.length === 2 && !pipeline.isBusy());
        }
        const final = await page.evaluate(() => ({
            calls: __returnTest.calls,
            reputation: playerStats.声望, active: gameData.sideQuest.active, history: gameData.sideQuest.history,
            pending: gameData.sideQuest.pendingReturnFailure, mode: GameMode, location: mapLocation,
            inputEnable, battleType: currentBattleType, battle: currentBattleEvent, reward: currentBattleReward,
            choiceVisible: document.getElementById('sidequest-interaction-container').classList.contains('show'),
            battleVisible: document.getElementById('battle-event-container').classList.contains('show')
        }));
        assert.equal(final.reputation, 17);
        assert.equal(final.active, null);
        assert.equal(final.history.length, 1);
        assert.equal(final.history[0].outcome, 'failed');
        assert.equal(final.history[0].endingId, null);
        assert.equal(final.pending, null);
        assert.equal(final.mode, 0);
        assert.equal(final.location, '天山派');
        assert.equal(final.inputEnable, 1);
        assert.equal(final.battleType, null);
        assert.equal(final.battle, null);
        assert.equal(final.reward, null);
        assert.equal(final.choiceVisible, false);
        assert.equal(final.battleVisible, false);
        for (const call of final.calls) {
            assert.equal(call.hasGuide, true);
            assert.equal(call.conflictingGuide, false);
            assert.equal(call.reputation, 17);
            assert.equal(call.active, false);
            assert.equal(call.mode, 0);
            assert.deepEqual(call.companions, []);
            assert.match(call.input, /伊州/);
            assert.match(call.input, /施延年/);
            assert.match(call.input, /支线因主动放弃而失败/);
            if (preset === 'xiajin') assert.equal(call.locationConstraint, true);
        }
        await page.screenshot({ path: path.join(directory, label + '-settled.png') });
        await writeFile(path.join(directory, label + '.json'), JSON.stringify(final, null, 2));
        assertSessionSafe(session, server, label);
        results.push({ label, status: 'PASS', calls: final.calls.length });
        console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
        await page.screenshot({ path: path.join(directory, label + '-failure.png') }).catch(() => {});
        await writeFile(path.join(directory, label + '-errors.json'), JSON.stringify(session.logs.filter(log => ['warn', 'error', 'pageerror'].includes(log.type)), null, 2));
        throw error;
    } finally { await session.close(); }
}

try {
    server = await startTestServer({ gameRoot: workspace });
    child = spawn(await findBrowser(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-sync', '--disable-extensions', '--disable-features=MediaRouter', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
    let endpoint;
    for (let attempt = 0; attempt < 200; attempt++) {
        if (child.exitCode !== null) throw Error('Browser exited early');
        try {
            const [port, route] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
            endpoint = `ws://127.0.0.1:${port}${route}`; break;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await delay(50);
    }
    assert.ok(endpoint, 'Browser must publish its endpoint');
    browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
    for (const preset of ['ny', 'xiajin']) {
        for (const stage of ['free', 'choice', 'battle', 'ending']) await run(preset, stage, stage === 'free');
    }
    assert.equal(server.requests.length, 0, 'No live API or test server model requests');
    await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
} finally {
    if (browser) await browser.close().catch(() => {});
    if (child && child.exitCode === null) child.kill();
    if (server) await server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
