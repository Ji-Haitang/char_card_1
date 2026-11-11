import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from '../../scene3d/scripts/test-support.mjs';
import { startTestServer } from '../../scene3d/scripts/test-server.mjs';

// Real Chromium IndexedDB + real localStorage quota, isolated browser contexts,
// synthetic data only. Loads only the storage modules (no game UI, no network).
const output = path.resolve(process.argv[2] || '.scene3d-work/storage-legacy-cleanup');
await mkdir(output, { recursive: true });
const server = await startTestServer({ gameRoot: process.cwd() });
const browser = await launchBrowser();
const results = [];
const V = '?v=test-' + Date.now();

async function freshPage() {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.dismiss());
    await page.goto(server.origin + '/module/idb-storage.js', { waitUntil: 'load' });
    return { context, page, errors };
}
async function loadModules(page, { noIdb = false } = {}) {
    if (noIdb) await page.evaluate(() => {
        Object.defineProperty(window, 'indexedDB', { value: { open() { throw Object.assign(new Error('blocked'), { name: 'SecurityError' }); } } });
    });
    for (const f of ['idb-storage.js', 'idb-snapshot.js', 'storage-service.js'])
        await page.addScriptTag({ url: server.origin + '/module/' + f + V });
}
// Old-version mirrors are big strings; reuse the same text so payloads stay deterministic.
const seedLegacy = ({ withIdb, divergent }) => {
    const big = n => 'turn-text-'.repeat(n);
    const conv = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: big(300) + i }));
    const appState = { gameData: { currentWeek: 12, mapLocation: 'shanmen', playerName: 'synthetic' } };
    const save = { id: 'save_1700000000000', saveName: 'legacy-slot', gameData: appState.gameData, uiConversation: conv, previewWeek: 12, createdAt: 1700000000000 };
    const index = [{ id: save.id, saveName: save.saveName, previewWeek: 12, createdAt: save.createdAt }];
    const ls = {
        jxz_appState: appState, jxz_uiConversation: conv, jxz_summaryHistory: [{ id: 's1', summaryText: big(50) }],
        jxz_weekHistory: [{ id: 'w1', summaryText: big(40) }], jxz_eventHistory: [{ id: 'evt-1', description: big(40) }],
        jxz_eventMeta: { arcs: {}, facts: {} }, jxz_locationMemory: { shanmen: { note: big(20) } },
        jxz_promptOverrides: { a: 'custom prompt' }, jxz_saves: [save], jxz_saves_index: index,
        jxz_snapshot: appState, jxz_snapshot_lastMsg: 'last message'
    };
    const idb = withIdb ? {
        appState, uiConversation: conv, summaryHistory: ls.jxz_summaryHistory, weekHistory: ls.jxz_weekHistory,
        eventHistory: ls.jxz_eventHistory, eventMeta: ls.jxz_eventMeta, locationMemory: ls.jxz_locationMemory,
        promptOverrides: ls.jxz_promptOverrides, saveIndex: index,
        // Mirrors the pre-fix migration: payload under 'save_' + id while the index uses id.
        ['save_' + save.id]: save
    } : {};
    if (withIdb && divergent) idb.uiConversation = conv.concat([{ role: 'user', content: 'newer-in-idb' }]);
    return { ls, idb, snapshot: withIdb ? { appState, lastUserMessage: 'last message' } : {} };
};
async function seed(page, data) {
    await page.evaluate(async ({ ls, idb, snapshot }) => {
        for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, JSON.stringify(v));
        localStorage.setItem('jxz_apiConfigSecondary', JSON.stringify({ model: 'old-secondary' }));
        localStorage.setItem('unrelated_other_project', 'keep-me');
        const put = (name, entries) => new Promise((resolve, reject) => {
            const req = indexedDB.open(name, 1);
            req.onupgradeneeded = () => req.result.createObjectStore('keyval');
            req.onsuccess = () => {
                const tx = req.result.transaction('keyval', 'readwrite');
                for (const [k, v] of Object.entries(entries)) tx.objectStore('keyval').put(v, k);
                tx.oncomplete = () => { req.result.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
        await put('jxz_db', idb);
        await put('jxz_snapshot_db', snapshot);
    }, data);
}
// Fill the remaining real quota with test-only keys.
const fillQuota = page => page.evaluate(() => {
    let error;
    for (const size of [262144, 65536, 4096, 256]) {
        for (let i = 0; i < 400; i++) {
            try { localStorage.setItem('__quota_' + size + '_' + i, 'q'.repeat(size)); }
            catch (e) { error = e.name; break; }
        }
    }
    return error;
});
const trySaveSecondary = page => page.evaluate(() => {
    try { localStorage.setItem('jxz_apiConfigSecondary', JSON.stringify({ model: 'new-secondary-' + 'x'.repeat(2048) })); return 'ok'; }
    catch (e) { return e.name; }
});
const snapshotState = page => page.evaluate(() => ({
    appState: storageService.loadAppState(),
    conv: storageService.loadUIConversation().length,
    lastConv: storageService.loadUIConversation().slice(-1)[0]?.content,
    saves: storageService.listSaves().map(s => s.id),
    saveLoaded: storageService.listSaves().map(s => !!storageService.loadSave(s.id) && storageService.loadSave(s.id).uiConversation.length),
    summary: storageService.loadSummaryHistory().length,
    week: storageService.loadWeekHistory().length,
    events: storageService.loadEventHistory().length,
    prompts: storageService.loadPromptOverrides(),
    snapshot: storageService.hasSnapshot(),
    jxzKeys: Object.keys(localStorage).filter(k => k.startsWith('jxz_')).sort(),
    unrelated: localStorage.getItem('unrelated_other_project'),
    diag: storageService.getStorageDiagnostics()
}));
const idbKeys = page => page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('jxz_db', 1);
    req.onsuccess = () => {
        const r = req.result.transaction('keyval').objectStore('keyval').getAllKeys();
        r.onsuccess = () => { req.result.close(); resolve(r.result); };
    };
}));

async function runCase(name, fn) {
    const record = { name, checks: [] };
    const s = await freshPage();
    try {
        await fn(s, record);
        assert.deepEqual(s.errors, []);
        record.pass = true;
    } catch (e) { record.pass = false; record.error = e.stack; }
    finally { await s.context.close(); }
    results.push(record);
    console.log(JSON.stringify({ name, pass: record.pass, checks: record.checks, error: record.error }));
}

try {
    for (const divergent of [false, true]) {
        await runCase('full-legacy-user' + (divergent ? '-divergent' : ''), async ({ page }, record) => {
            await seed(page, seedLegacy({ withIdb: true, divergent }));
            assert.equal(await fillQuota(page), 'QuotaExceededError');
            assert.equal(await trySaveSecondary(page), 'QuotaExceededError');
            record.checks.push('reproduced: quota full, secondary API config cannot be saved');
            await loadModules(page);
            await page.evaluate(() => storageService.init());
            const after = await snapshotState(page);
            assert.equal(after.diag.indexedDB, true);
            assert.deepEqual(after.jxzKeys, ['jxz_apiConfigSecondary']);
            assert.equal(after.unrelated, 'keep-me');
            assert.equal(after.conv, divergent ? 61 : 60);
            assert.equal(after.lastConv, divergent ? 'newer-in-idb' : 'turn-text-'.repeat(300) + 59);
            assert.deepEqual(after.saves, ['save_1700000000000']);
            assert.deepEqual(after.saveLoaded, [60]);
            assert.equal(after.snapshot, true);
            assert.equal(after.diag.legacyCleanup.errors.length, 0);
            assert.equal(after.diag.legacyCleanup.restoredSaves, 1);
            record.checks.push('only listed jxz_ game copies removed; IDB data unchanged; save loads from IDB');
            const keys = await idbKeys(page);
            assert.ok(keys.includes('save_1700000000000'));
            if (divergent) assert.ok(keys.includes('lsBackup:jxz_uiConversation'));
            else assert.ok(!keys.some(k => k.startsWith('lsBackup:jxz_uiConversation')));
            record.checks.push(divergent ? 'divergent copy backed up in IDB before removal' : 'identical copies removed without backup');
            assert.equal(await trySaveSecondary(page), 'ok');
            record.checks.push('secondary API config saves after cleanup (quota still filled by test keys)');
            // Gameplay after the fix must not grow localStorage.
            const before = after.diag.localStorageChars.total;
            await page.evaluate(async () => {
                for (let i = 0; i < 30; i++) storageService.appendUIConversation({ role: 'assistant', content: 'n'.repeat(5000) });
                storageService.saveAppState({ gameData: { currentWeek: 13 } });
                storageService.createSave('after-fix');
                await new Promise(r => setTimeout(r, 300));
            });
            const grown = await snapshotState(page);
            assert.ok(grown.diag.localStorageChars.total - before < 8000, 'localStorage must not grow with gameplay');
            assert.equal(grown.diag.lastWriteError?.target === 'indexedDB', false);
            record.checks.push('new turns and saves do not grow localStorage');
            // Remove only test filler, then reload: everything still there from IDB.
            await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('__quota_')).forEach(k => localStorage.removeItem(k)));
            await page.reload({ waitUntil: 'load' });
            await loadModules(page);
            await page.evaluate(() => storageService.init());
            const reloaded = await snapshotState(page);
            assert.equal(reloaded.conv, (divergent ? 61 : 60) + 30);
            assert.equal(reloaded.appState.gameData.currentWeek, 13);
            assert.equal(reloaded.saves.length, 2);
            assert.ok(reloaded.saveLoaded.every(Boolean));
            assert.deepEqual(reloaded.jxzKeys, ['jxz_apiConfigSecondary']);
            assert.match(JSON.parse(await page.evaluate(() => localStorage.getItem('jxz_apiConfigSecondary'))).model, /^new-secondary-/);
            record.checks.push('after reload: progress, both saves and API config intact');
        });
    }

    await runCase('very-old-user-localStorage-only', async ({ page }, record) => {
        const data = seedLegacy({ withIdb: false });
        await seed(page, data);
        await loadModules(page);
        await page.evaluate(() => storageService.init());
        const after = await snapshotState(page);
        assert.equal(after.conv, 60);
        assert.equal(after.week, 1);
        assert.equal(after.events, 1);
        assert.deepEqual(after.prompts, { a: 'custom prompt' });
        assert.deepEqual(after.saveLoaded, [60]);
        assert.deepEqual(after.jxzKeys, ['jxz_apiConfigSecondary']);
        record.checks.push('first migration covers all mirrored categories, then removes copies');
        await page.reload({ waitUntil: 'load' });
        await loadModules(page);
        await page.evaluate(() => storageService.init());
        const reloaded = await snapshotState(page);
        assert.equal(reloaded.conv, 60);
        assert.deepEqual(reloaded.saveLoaded, [60]);
        assert.deepEqual(reloaded.prompts, { a: 'custom prompt' });
        record.checks.push('data survives reload from IDB alone');
    });

    await runCase('idb-write-failure-keeps-localStorage', async ({ page }, record) => {
        await seed(page, seedLegacy({ withIdb: true, divergent: true }));
        await loadModules(page);
        await page.evaluate(() => {
            const real = idbStorage.put;
            idbStorage.put = (k, v) => (String(k).startsWith('lsBackup:') || k === 'save_1700000000000')
                ? Promise.reject(Object.assign(new Error('synthetic'), { name: 'QuotaExceededError' })) : real(k, v);
        });
        await page.evaluate(() => storageService.init());
        const after = await snapshotState(page);
        assert.ok(after.jxzKeys.includes('jxz_uiConversation'), 'divergent copy kept when backup fails');
        assert.ok(after.jxzKeys.includes('jxz_saves'), 'legacy saves kept when IDB copy fails');
        assert.ok(after.diag.legacyCleanup.errors.length >= 2);
        assert.deepEqual(after.saveLoaded, [60]);
        record.checks.push('failed backup/save copy: localStorage originals kept, save still loadable');
        // Next start with IDB healthy: cleanup completes (idempotent/resumable).
        await page.reload({ waitUntil: 'load' });
        await loadModules(page);
        await page.evaluate(() => storageService.init());
        const retry = await snapshotState(page);
        assert.deepEqual(retry.jxzKeys, ['jxz_apiConfigSecondary']);
        assert.deepEqual(retry.saveLoaded, [60]);
        record.checks.push('next start resumes and completes cleanup');
    });

    await runCase('indexeddb-unavailable-fallback', async ({ page }, record) => {
        await loadModules(page, { noIdb: true });
        await page.evaluate(() => storageService.init());
        await page.evaluate(() => {
            storageService.saveAppState({ gameData: { currentWeek: 3 } });
            storageService.appendUIConversation({ role: 'user', content: 'fallback' });
        });
        const state = await snapshotState(page);
        assert.equal(state.diag.indexedDB, false);
        assert.ok(state.jxzKeys.includes('jxz_appState') && state.jxzKeys.includes('jxz_uiConversation'));
        record.checks.push('without IndexedDB the localStorage fallback still persists progress');
        await page.reload({ waitUntil: 'load' });
        await loadModules(page, { noIdb: true });
        await page.evaluate(() => storageService.init());
        const reloaded = await snapshotState(page);
        assert.equal(reloaded.appState.gameData.currentWeek, 3);
        assert.equal(reloaded.conv, 1);
        record.checks.push('fallback data survives reload');
    });
} finally {
    await browser.close(); await server.close();
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
}
if (results.some(r => !r.pass)) process.exitCode = 1;
