/**
 * Real browser regression for the 3D corner controls and top status HUD.
 * Usage: node tests/scene3d/corner-feedback.browser.mjs <absolute evidence dir>
 * Product files are only observed; this test never injects CSS or business state.
 */
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { launchBrowser, newGameContext, startGame, json, fixturesRoot } from '../../scene3d/scripts/test-support.mjs';
import { startTestServer } from '../../scene3d/scripts/test-server.mjs';
import { waitForLatestApplied } from './p1.browser.mjs';

const gameRoot = process.cwd();
const directory = process.argv[2];
assert.ok(directory && path.isAbsolute(directory), 'Supply a NEW absolute evidence directory');
await mkdir(directory, { recursive: false });
const save = (name, value) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const closeVector = (actual, expected, tolerance = 0.75) => actual?.length === expected?.length && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
const mobileCss = await readFile(path.join(gameRoot, 'module/mobile-density-overrides.css'), 'utf8');
const dialogsCss = await readFile(path.join(gameRoot, 'module/game-styles-dialogs.css'), 'utf8');
assert.match(mobileCss, /--viewport-corner-bottom:\s*max\(12px,\s*env\(safe-area-inset-bottom,\s*0px\)\)/, 'mobile CSS must retain safe-area bottom fallback');
assert.match(mobileCss, /bottom:\s*calc\(var\(--viewport-corner-bottom\)\s*\+\s*\(var\(--viewport-corner-size\)\s*\+\s*10px\)\s*\*\s*2\)/, 'reset CSS must retain (size+10)*2+safe-bottom contract (task button sits between gear and reset)');
assert.match(dialogsCss, /padding-top:\s*0\s*!important/, 'status CSS must retain padding-top:0 contract');

const cases = [
  { label: '390x844-ancient', style: 0, viewport: { width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true } },
  { label: '360x800-flat', style: 1, viewport: { width: 360, height: 800, deviceScaleFactor: 1, hasTouch: true, isMobile: true } },
  { label: '844x390-ancient-landscape', style: 0, viewport: { width: 844, height: 390, deviceScaleFactor: 1, hasTouch: true, isMobile: true }, landscape: true }
];
const results = [];
const server = await startTestServer({ gameRoot });
const browser = await launchBrowser();
try {
  for (const testCase of cases) {
    const payload = await json(path.join(fixturesRoot, 'saves/map.json'));
    const session = await newGameContext(browser, server, {
      payload, channel: `corner-feedback-${testCase.label}`, style: testCase.style,
      viewport: testCase.viewport,
      scene3dPreferences: { schema: 2, enabled: true, quality: 'low' }
    });
    const page = session.page;
    const record = { ...testCase };
    try {
      await startGame(session, server);
      await page.waitForFunction(() => document.getElementById('main-viewport')?.dataset.scene3dReady === 'true', { timeout: 120000 });
      await waitForLatestApplied(page, 'main', 120000);
      if (testCase.landscape) {
        await page.evaluate(() => {
          const toggle = document.getElementById('gs-layout-toggle');
          if (!toggle) throw Error('Landscape layout toggle missing');
          toggle.checked = true;
          gsOnLayoutMode(toggle);
        });
        await page.waitForFunction(() => document.body.classList.contains('layout-landscape'));
      }
      await sleep(250);

      record.layout = await page.evaluate(() => {
        const viewport = document.getElementById('main-viewport');
        const status = viewport?.querySelector('.status-display');
        const reset = viewport?.querySelector('.scene3d-reset');
        const gear = document.getElementById('viewport-dock-gear');
        const controlBtn = viewport?.querySelector('#viewport-dock-menu .control-btn');
        if (!viewport || !status || !reset || !gear || !controlBtn) throw Error('Corner feedback controls/status missing');
        const vp = viewport.getBoundingClientRect();
        const contentTop = vp.top + viewport.clientTop;
        const sr = status.getBoundingClientRect(), rr = reset.getBoundingClientRect(), gr = gear.getBoundingClientRect(), cr = controlBtn.getBoundingClientRect();
        const rs = getComputedStyle(reset), gs = getComputedStyle(gear), ss = getComputedStyle(status);
        const center = node => { const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { hit: hit === node || node.contains(hit), tag: hit?.tagName, id: hit?.id, className: hit?.className }; };
        return {
          viewport: { left: vp.left, top: vp.top, clientTop: viewport.clientTop, right: vp.right, bottom: vp.bottom, width: vp.width, height: vp.height },
          status: { top: sr.top, bottom: sr.bottom, paddingTop: ss.paddingTop, height: sr.height, viewportTopGap: sr.top - contentTop },
          activeScene: (() => { const scene = viewport.querySelector('.scene.active'); const r = scene?.getBoundingClientRect(); const s = scene && getComputedStyle(scene); return { exists: !!scene, top: r?.top ?? null, viewportTopGap: r ? r.top - contentTop : null, paddingTop: s?.paddingTop ?? null, paddingRight: s?.paddingRight ?? null, paddingBottom: s?.paddingBottom ?? null, paddingLeft: s?.paddingLeft ?? null }; })(),
          reset: { left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom, width: rr.width, height: rr.height, rightGap: vp.right - rr.right, bottomGap: vp.bottom - rr.bottom, hit: center(reset) },
          gear: { left: gr.left, right: gr.right, top: gr.top, bottom: gr.bottom, width: gr.width, height: gr.height, rightGap: vp.right - gr.right, bottomGap: vp.bottom - gr.bottom, hit: center(gear) },
          resetStyle: { background: rs.backgroundColor, radius: rs.borderRadius },
          gearStyle: { background: gs.backgroundColor, radius: gs.borderRadius },
          controlBtn: { width: cr.width, height: cr.height }
        };
      });
      const { reset, gear, status, activeScene } = record.layout;
      assert.equal(status.paddingTop, '0px', `${testCase.label}: status padding-top must be 0`);
      assert.equal(activeScene.exists, true, `${testCase.label}: active inner scene missing`);
      assert.equal(activeScene.paddingTop, '0px', `${testCase.label}: active inner scene padding-top must be 0`);
      assert.ok(Math.abs(reset.width - gear.width) < 0.1 && Math.abs(reset.height - gear.height) < 0.1, `${testCase.label}: reset and gear sizes differ`);
      assert.ok(Math.abs(reset.width - 0.8 * record.layout.controlBtn.height) < 0.75, `${testCase.label}: corner size ${reset.width.toFixed(2)}px != 80% of control-btn height ${record.layout.controlBtn.height.toFixed(2)}px`);
      assert.ok(Math.abs(reset.rightGap - gear.rightGap) < 0.1, `${testCase.label}: reset and gear right edges differ`);
      const task = await page.evaluate(() => { const r = document.getElementById('viewport-task-btn').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width, right: r.right }; });
      assert.ok(Math.abs(task.width - gear.width) < 0.1, `${testCase.label}: task button and gear sizes differ`);
      assert.ok(Math.abs(task.right - gear.right) < 0.1, `${testCase.label}: task button and gear right edges differ`);
      assert.ok(Math.abs((gear.top - task.bottom) - 10) < 0.2, `${testCase.label}: gear/task gap is ${(gear.top - task.bottom).toFixed(2)}px, expected 10px`);
      assert.ok(Math.abs((task.top - reset.bottom) - 10) < 0.2, `${testCase.label}: task/reset gap is ${(task.top - reset.bottom).toFixed(2)}px, expected 10px`);
      assert.equal(reset.hit.hit, true, `${testCase.label}: reset center is not hit by reset`);
      assert.equal(gear.hit.hit, true, `${testCase.label}: gear center is not hit by gear`);

      const initial = await page.evaluate(() => {
        const d = GameSceneBridge.getDiagnostics();
        return { camera: d.renderer?.cameraView, open: document.getElementById('viewport-dock')?.classList.contains('open') };
      });
      const canvas = await page.$('canvas.scene3d-canvas');
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .7, box.y + box.height * .55, { steps: 4 });
      await page.mouse.up();
      await sleep(180);
      const perturbed = await page.evaluate(() => GameSceneBridge.getDiagnostics().renderer?.cameraView);
      record.cameraAction = { initial: initial.camera, perturbed };
      assert.equal(closeVector(perturbed?.position, initial.camera?.position, 0.75), false, `${testCase.label}: real drag did not perturb camera`);
      await page.click('.scene3d-reset');
      await sleep(350);
      record.resetAction = await page.evaluate(() => {
        const d = GameSceneBridge.getDiagnostics();
        const reset = document.querySelector('.scene3d-reset');
        const r = reset.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { camera: d.renderer?.cameraView, resetClicks: reset.matches(':focus-visible') || document.activeElement === reset, hit: hit === reset || reset.contains(hit) };
      });
      assert.ok(record.resetAction.camera, `${testCase.label}: reset did not leave a camera state`);
      assert.equal(closeVector(record.resetAction.camera.position, initial.camera?.position, 0.75), true, `${testCase.label}: reset click did not restore the initial camera within tolerance`);
      await page.click('#viewport-dock-gear');
      await page.waitForFunction(() => document.getElementById('viewport-dock')?.classList.contains('open'));
      record.gearExpanded = await page.evaluate(() => document.getElementById('viewport-dock').classList.contains('open'));
      assert.equal(record.gearExpanded, true, `${testCase.label}: gear did not expand after reset`);
      await page.screenshot({ path: path.join(directory, `${testCase.label}.png`), fullPage: true });
      assert.ok(Math.abs(status.viewportTopGap) < 1, `${testCase.label}: status must touch viewport top (${status.viewportTopGap})`);
      record.status = 'PASS';
    } catch (error) {
      record.status = 'FAIL'; record.error = error.stack;
      try { await page.screenshot({ path: path.join(directory, `${testCase.label}-FAIL.png`), fullPage: true }); } catch {}
    } finally {
      results.push(record); await save('results.json', results); await session.close();
    }
  }
} finally { await browser.close(); await server.close(); }
console.log(JSON.stringify(results.map(({ label, status, error }) => ({ label, status, error })), null, 2));
if (results.some(record => record.status === 'FAIL')) process.exitCode = 1;
