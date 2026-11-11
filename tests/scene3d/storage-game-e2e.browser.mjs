import assert from 'node:assert/strict';
import path from 'node:path';
import { launchBrowser, newGameContext, startGame, json, fixturesRoot } from '../../scene3d/scripts/test-support.mjs';
import { startTestServer } from '../../scene3d/scripts/test-server.mjs';

// Real index.html with a synthetic fixture save seeded in the legacy localStorage format.
const server = await startTestServer({ gameRoot: process.cwd() });
const browser = await launchBrowser();
let failed = false;
try {
    const session = await newGameContext(browser, server, {
        payload: await json(path.join(fixturesRoot, 'saves/map.json')), channel: 'storage-game', style: 0,
        scene3dPreferences: { schema: 2, enabled: false, quality: 'low' }
    });
    const p = session.page;
    await startGame(session, server);
    const gameKeys = () => p.evaluate(() => Object.keys(localStorage).filter(k => /^jxz_(appState|uiConversation|summaryHistory|weekHistory|saves|eventHistory|eventMeta|locationMemory|snapshot)/.test(k)));
    const first = await p.evaluate(() => ({ week: gameData.currentWeek, saves: storageService.listSaves().map(s => s.id), diag: storageService.getStorageDiagnostics() }));
    assert.equal(first.diag.indexedDB, true);
    assert.deepEqual(await gameKeys(), [], 'legacy game copies moved out of localStorage');
    assert.ok(first.saves.includes('scene3d-fixture'));
    const id = await p.evaluate(async () => {
        storageService.appendUIConversation({ role: 'assistant', content: 'e2e-marker' });
        gameData.currentWeek = 7; storageService.saveAppState({ gameData });
        const id = storageService.createSave('e2e-slot');
        await storageService.saveFullSnapshot();
        await new Promise(r => setTimeout(r, 400));
        return id;
    });
    assert.deepEqual(await gameKeys(), [], 'gameplay writes nothing large to localStorage');
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => window.__scene3dTest?.initDone || window.__scene3dTest?.initError);
    assert.equal(await p.evaluate(() => window.__scene3dTest.initError), null);
    const after = await p.evaluate(id => ({
        week: storageService.loadAppState().gameData.currentWeek,
        last: storageService.loadUIConversation().slice(-1)[0]?.content,
        saves: storageService.listSaves().map(s => s.id),
        fixtureOk: !!storageService.loadSave('scene3d-fixture')?.gameData,
        slot: storageService.loadSave(id)?.gameData?.currentWeek,
        snap: storageService.hasSnapshot()
    }), id);
    assert.equal(after.week, 7);
    assert.equal(after.last, 'e2e-marker');
    assert.deepEqual(after.saves, ['scene3d-fixture', id]);
    assert.equal(after.fixtureOk, true);
    assert.equal(after.slot, 7);
    assert.equal(after.snap, true);
    assert.deepEqual(session.logs.filter(x => x.type === 'pageerror'), []);
    console.log(JSON.stringify({ pass: true, after }));
    await session.close();
} catch (e) { failed = true; console.error(e.stack); }
finally { await browser.close(); await server.close(); }
if (failed) process.exitCode = 1;
