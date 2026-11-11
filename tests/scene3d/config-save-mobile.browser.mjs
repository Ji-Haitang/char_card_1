import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser, newGameContext, startGame, json, fixturesRoot } from '../../scene3d/scripts/test-support.mjs';
import { startTestServer } from '../../scene3d/scripts/test-server.mjs';

// Only disposable contexts, synthetic saves/credentials and a local static server.
// Mobile saves use real touch events, not evaluate(() => button.click()).
const output = path.resolve(process.argv[2] || '.scene3d-work/config-save-mobile');
await mkdir(output, { recursive: true });
const server = await startTestServer({ gameRoot: process.cwd() });
const browser = await launchBrowser();
const results = [];
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const cases = [
    ['game', 390, 844, 0], ['game', 390, 844, 1],
    ['game', 844, 390, 0], ['game', 844, 390, 1],
    ['game', 1440, 900, 1],
    ['start', 390, 844, 0], ['start', 844, 390, 0]
];
try {
    for (const [entry, width, height, style] of cases) {
        const mobile = width < 1000;
        const label = `${entry}-${width}x${height}-${style}`;
        const session = await newGameContext(browser, server, {
            payload: await json(path.join(fixturesRoot, 'saves/map.json')), channel: label, style,
            viewport: { width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile },
            scene3dPreferences: { schema: 2, enabled: false, quality: 'low' }
        });
        const p = session.page;
        const record = { label, checks: [] };
        try {
            if (mobile) await p.setUserAgent(android);
            await startGame(session, server);
            if (entry === 'start') await p.goto(server.origin + '/start-screen-noST.html', { waitUntil: 'load' });
            await p.evaluate(() => {
                if (typeof closeModal === 'function') closeModal();
                apiService.updateSecondaryConfig({ enabled: true, endpoint: 'https://synthetic.invalid/v1', apiKey: 'synthetic-only', model: 'old-secondary', backgroundTasks: ['summary'] });
                showConfigModal();
                window.__saveClicks = [];
                document.addEventListener('click', e => {
                    const id = e.target.closest('button')?.id;
                    if (id?.includes('-save-btn')) __saveClicks.push(id);
                }, true);
            });
            async function save(section, model) {
                const prefix = section === 'primary' ? 'api' : 'api2';
                await p.evaluate(({ prefix, model, section }) => {
                    __saveClicks.length = 0;
                    const input = document.getElementById(prefix + '-model-input');
                    input.value = model;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    document.getElementById('cfg-' + section + '-save-btn').scrollIntoView({ block: 'center' });
                }, { prefix, model, section });
                // Modal placement animates briefly in the ancient theme.
                await p.waitForFunction(section => {
                    const b = document.getElementById('cfg-' + section + '-save-btn');
                    const r = b.getBoundingClientRect();
                    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === b;
                }, {}, section);
                if (mobile) await p.tap('#cfg-' + section + '-save-btn');
                else await p.click('#cfg-' + section + '-save-btn');
                return p.evaluate(section => {
                    const cfg = section === 'primary' ? apiService.getConfig() : apiService.getSecondaryConfig();
                    const key = section === 'primary' ? 'jxz_apiConfig' : 'jxz_apiConfigSecondary';
                    const status = document.getElementById('cfg-' + section + '-save-status');
                    return { text: status.textContent, className: status.className, dirty: _cfgDirty[section],
                        runtime: cfg.model, stored: JSON.parse(localStorage.getItem(key)).model,
                        clicked: __saveClicks.includes('cfg-' + section + '-save-btn') };
                }, section);
            }
            for (const section of ['primary', 'secondary']) {
                const model = section + '-saved';
                const state = await save(section, model);
                assert.equal(state.clicked, true);
                assert.match(state.text, /✔ 已保存 \d\d:\d\d:\d\d/);
                assert.equal(state.dirty, false);
                assert.equal(state.runtime, model);
                assert.equal(state.stored, model);
                record.checks.push(section + ': touch/click saves');
            }
            // Force a REAL Chromium quota exception without stubbing Storage.setItem.
            const quota = await p.evaluate(() => {
                let error;
                for (let i = 0; i < 200; i++) {
                    try { localStorage.setItem('__quota_big_' + i, 'q'.repeat(65536)); }
                    catch (e) { error = e.name; break; }
                }
                for (let i = 0; i < 256; i++) {
                    try { localStorage.setItem('__quota_small_' + i, 'q'.repeat(256)); }
                    catch (e) { error = e.name; break; }
                }
                return error;
            });
            assert.equal(quota, 'QuotaExceededError');
            for (const section of ['primary', 'secondary']) {
                const state = await save(section, section + '-unsaved-' + 'x'.repeat(4096));
                assert.equal(state.clicked, true);
                assert.match(state.text, /QuotaExceededError/);
                assert.match(state.className, /is-error/);
                assert.equal(state.dirty, true);
                assert.equal(state.runtime, section + '-saved');
                assert.equal(state.stored, section + '-saved');
                record.checks.push(section + ': real quota visible, live and persisted values unchanged');
            }
            assert.equal(await p.$eval('#api-config-modal .cfg-panel', el => el.scrollWidth > el.clientWidth + 2), false);
            if (label === 'game-390x844-0') await p.screenshot({ path: path.join(output, 'mobile-quota-feedback.png') });
            // Remove only this test's filler; no game keys, configuration or saves are deleted.
            await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('__quota_')).forEach(k => localStorage.removeItem(k)));
            for (const section of ['primary', 'secondary']) {
                await p.evaluate(() => localStorage.setItem('jxz_apiConfigHistory', 'null'));
                const state = await save(section, section + '-history-recovered');
                assert.equal(state.clicked, true);
                assert.match(state.text, /✔ 已保存/);
                assert.equal(state.dirty, false);
                assert.equal(state.runtime, section + '-history-recovered');
                assert.equal(state.stored, section + '-history-recovered');
                record.checks.push(section + ': malformed history cannot suppress successful save');
            }
            await p.reload({ waitUntil: 'load' });
            if (entry === 'game') {
                await p.waitForFunction(() => window.__scene3dTest?.initDone || window.__scene3dTest?.initError);
                assert.equal(await p.evaluate(() => window.__scene3dTest.initError), null);
            }
            assert.deepEqual(await p.evaluate(() => [apiService.getConfig().model, apiService.getSecondaryConfig().model]), ['primary-history-recovered', 'secondary-history-recovered']);
            record.checks.push('both configurations survive reload');
            assert.deepEqual(session.logs.filter(x => x.type === 'pageerror'), []);
            assert.equal(session.network.filter(x => x.method === 'POST').length, 0, 'Saving must not send model/API requests');
            record.pass = true;
        } catch (e) {
            record.pass = false; record.error = e.stack;
        } finally { await session.close(); }
        results.push(record);
        console.log(JSON.stringify(record));
    }
} finally {
    await browser.close(); await server.close();
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
}
if (results.some(r => !r.pass)) process.exitCode = 1;
