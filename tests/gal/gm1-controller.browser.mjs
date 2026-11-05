// 真实页面冒烟：使用合成存档、独立 Chromium profile 和临时本地测试服务。
// node tests/gal/gm1-controller.browser.mjs <全新绝对证据目录>
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { findBrowser, newGameContext, startGame, json, fixturesRoot, workspace } from '../../scene3d/scripts/test-support.mjs';
import { startTestServer } from '../../scene3d/scripts/test-server.mjs';

const directory = process.argv[2];
assert.ok(directory && path.isAbsolute(directory), 'Supply a new absolute evidence directory');
await mkdir(directory);
const profile = path.join(directory, 'browser-profile');
await mkdir(profile);
const require = createRequire(new URL('../../scene3d/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const server = await startTestServer({ gameRoot: workspace });
let child, browser;
const results = [];
try {
  // 不捕获子进程管道；DevTools 端口由这个专用 profile 的文件传递。
  child = spawn(await findBrowser(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--enable-logging', `--log-file=${path.join(directory, 'chromium.log')}`,
    '--disable-background-networking', '--disable-component-update', '--no-first-run',
    '--disable-sync', '--disable-extensions', '--disable-features=MediaRouter', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' });
  let launchError;
  child.on('error', error => { launchError = error; });
  let endpoint;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw Error(`Browser exited with code ${child.exitCode}`);
    try {
      const [port, route] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
      endpoint = `ws://127.0.0.1:${port}${route}`;
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(50);
  }
  assert.ok(endpoint, 'Browser must publish its dedicated DevTools endpoint');
  browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  for (const width of [1280, 390]) {
    const payload = await json(path.join(fixturesRoot, 'saves/gal.json'));
    payload.gameData.companionNPC = ['H', 'I'];
    payload.uiConversation[0].content = '甲。|街道|09:00|雨烛:微笑|none\n乙。|街道|09:30|安慕:平静|none\n丙。|街道|10:00|安慕:微笑|none';
    const session = await newGameContext(browser, server, {
      payload, channel: `gm1-turn-${width}`, scene3dPreferences: { enabled: false },
      viewport: { width, height: 900, deviceScaleFactor: 1 },
    });
    try {
      const page = session.page;
      await startGame(session, server);
      await page.evaluate(() => closeModal());
      assert.equal(await page.evaluate(() => GameMode), 1);
      assert.equal(await page.evaluate(() => GameSceneBridge.getDiagnostics().preferences.enabled), false);
      assert.equal(await page.evaluate(() => window.__lastValidSlgIndex), 0);
      await page.evaluate(() => {
        window.__gm1TurnProbe = { frames: [], running: true };
        function record() {
          const sheet = document.querySelector('.scene3d-page-sheet');
          __gm1TurnProbe.frames.push({
            at: performance.now(), index: window.__lastValidSlgIndex,
            hidden: document.querySelector('.scene3d-page-turn')?.hidden ?? true,
            opacity: sheet ? Number(getComputedStyle(sheet).opacity) : 0,
            label: document.querySelector('.scene3d-page-title')?.textContent,
          });
          if (__gm1TurnProbe.running) requestAnimationFrame(record);
        }
        record();
      });
      await page.click('#story-next-btn');
      await page.waitForFunction(() => window.__lastValidSlgIndex === 1 && document.querySelector('.scene3d-page-turn')?.hidden === true);
      const probe = await page.evaluate(() => { __gm1TurnProbe.running = false; return __gm1TurnProbe.frames; });
      assert.ok(probe.some(frame => !frame.hidden), 'The paper must appear in GM1 with 3D disabled');
      assert.ok(probe.some(frame => frame.index === 0 && frame.opacity >= 0.99), 'The old frame remains until full cover');
      const firstNew = probe.findIndex(frame => frame.index === 1);
      assert.ok(firstNew >= 0 && probe[firstNew].opacity >= 0.99, 'The frame swap happens under full cover');
      await writeFile(path.join(directory, `${width}-frames.json`), JSON.stringify(probe, null, 2));
      await page.screenshot({ path: path.join(directory, `${width}-after-turn.png`) });
      // 表情变化不播纸：相同人物从第二段进入第三段。
      await page.click('#story-next-btn');
      await page.waitForFunction(() => window.__lastValidSlgIndex === 2);
      assert.equal(await page.$eval('.scene3d-page-turn', element => element.hidden), true);
      // 页码点与正文点击区同样走真实入口。
      await page.click('.page-dot');
      await page.waitForFunction(() => window.__lastValidSlgIndex === 0 && document.querySelector('.scene3d-page-turn')?.hidden === true);
      await page.$eval('#story-text', element => {
        const wrapper = element.parentElement, bounds = wrapper.getBoundingClientRect();
        wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.right - 2, clientY: bounds.top + 2 }));
      });
      await page.waitForFunction(() => window.__lastValidSlgIndex === 1 && document.querySelector('.scene3d-page-turn')?.hidden === true);
      await page.click('#story-prev-btn');
      await page.waitForFunction(() => window.__lastValidSlgIndex === 0 && document.querySelector('.scene3d-page-turn')?.hidden === true);
      const errors = session.logs.filter(entry => entry.type === 'pageerror');
      assert.deepEqual(errors, []);
      results.push({ width, status: 'PASS', frameSamples: probe.length, navigation: ['next', 'previous', 'dot', 'story click'], threeDEnabled: false });
    } finally { await session.close(); }
  }
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (browser) await browser.close();
  if (child && child.exitCode === null) child.kill();
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
