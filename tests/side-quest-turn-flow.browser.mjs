// Real-page regression: no live API, dedicated Chromium profile and loopback server.
// node tests/side-quest-turn-flow.browser.mjs <NEW absolute evidence directory>
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  findBrowser, newGameContext, startGame, json, fixturesRoot, workspace,
  hashFile, assertSessionSafe,
} from '../scene3d/scripts/test-support.mjs';
import { startTestServer } from '../scene3d/scripts/test-server.mjs';

const directory = process.argv[2];
assert.ok(directory && path.isAbsolute(directory), 'Supply a NEW absolute evidence directory');
await mkdir(directory); // EEXIST deliberately prevents evidence replacement.
const profile = path.join(directory, 'browser-profile');
await mkdir(profile);
const require = createRequire(new URL('../scene3d/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const productionFiles = [
  'index.html', 'module/pipeline.js', 'module/side-quest-runner.js',
  'module/side-quest-service.js', 'module/api-service.js', 'module/game-ui.js',
  'module/game-events.js', 'module/game-helpers.js', 'module/game-styles.css',
];
const manifest = async () => Object.fromEntries(await Promise.all(
  productionFiles.map(async file => [file, await hashFile(path.join(workspace, file))]),
));
const before = await manifest();
const environment = {
  startedAt: new Date().toISOString(), gameRoot: workspace, node: process.version,
  network: 'Only isolated loopback server and known local asset substitutions; APIs mocked in page',
  timers: 'Real browser timers; retry delay observed without shortening or replacing it',
  sourceBefore: before,
};
let child, browser, server;
const results = [];

// Leave production parser, runner, quest service, UI, and autosave intact. Only API transport
// and prompt construction are replaced. This fixture never renders the core prompt.
async function installFixture(page, streamMode) {
  return page.evaluate(mode => {
    closeModal();
    inputEnable = 1;
    currentSpecialEvent = '';
    currentRandomEvent = null;
    currentBattleEvent = null;
    randomEvent = battleEvent = 0;
    gameData.sideQuestConfig = { enabled: true, confidenceThreshold: 0.7, deadlineWeeks: 0 };
    gameData.sideQuest = { active: null, history: [], lastRefreshWeek: 0, judgeDisabled: false };
    const tree = {
      rootNodeId: 'n1',
      nodes: {
        n1: { type: 'stage', title: '整理书摊', hiddenGoal: '清点书册', interaction: 'free', maxTurns: 0, onSuccess: 'n2' },
        n2: { type: 'stage', title: '归还书册', hiddenGoal: '选择归还方式', interaction: 'choice', options: [
          { id: 'return', label: '交给摊主', next: 'e1' },
          { id: 'leave', label: '留在书架', next: 'e2' },
        ] },
        e1: { type: 'ending', title: '书归原主', endingType: 'success', epilogue: '书册交还摊主。', rewards: {} },
        e2: { type: 'ending', title: '留待来人', endingType: 'success', epilogue: '书册放回书架。', rewards: {} },
      },
    };
    const validation = sideQuestService.validateTree(tree, '简单');
    if (!validation.ok) throw Error(`Invalid synthetic tree: ${validation.errors.join('; ')}`);
    const active = sideQuestService.acceptQuest({
      title: '书摊回归夹具', background: '核对几本旧书。', playerGoal: '整理书册',
      difficulty: '简单', relatedLocations: ['伊州'], relatedNpcs: [],
    }, tree);
    if (!active || !sideQuestService.checkStageGates(active)) throw Error('Synthetic active stage must pass real gates');
    apiService.updateConfig({ streamMode: mode });
    embeddingService.updateConfig({ enabled: false });
    promptBuilder.buildMessages = ({ userMessage }) => [
      { role: 'system', content: '合成浏览器回归：整理书摊。' },
      { role: 'user', content: userMessage },
    ];
    const originalPrompt = promptOverrides.get;
    promptOverrides.get = function(key, fallback) {
      return key === 'SQ_JUDGE' ? '合成进度判定，仅输出 SIDE_QUEST_CHECK JSON。' : originalPrompt.call(this, key, fallback);
    };

    const state = window.__turnFlow = {
      ids: ['skip-week-btn', 'slg-return-btn', 'free-action-send-btn', 'regenerate-btn', 'free-action-input'],
      requests: [], samples: [], violations: [], retryTimers: [], autoSaves: [], refreshes: [],
      phase: 'ready', expectLocked: false, done: false, running: true, optionClicks: 0,
      raw: '<MAIN_TEXT>合成剧情：测试弟子整理街边书摊。|街道|09:00|none|none</MAIN_TEXT>' +
        '<SUMMARY>测试弟子清点书册。</SUMMARY><SIDE_NOTE>{"用户":{"位置变动":"none"},"剧情基调":"平淡"}</SIDE_NOTE>',
      judge: '<SIDE_QUEST_CHECK>{"result":"continue","confidence":1,"reason":"继续清点","progressNote":"合成进度已核对"}</SIDE_QUEST_CHECK>',
    };
    state.autoSlots = () => storageService.listSaves().filter(save => save.saveName.startsWith('[自动]'));
    state.baselineAutoSlots = state.autoSlots().length;
    state.snapshot = function(source) {
      const mask = document.getElementById('stream-mask');
      const spinner = mask?.querySelector('.stream-spinner');
      const spans = [...document.querySelectorAll('#stream-log span')];
      const controls = document.getElementById('stream-controls');
      const edge = spinner ? getComputedStyle(spinner, '::before') : null;
      const first = spans[0] ? getComputedStyle(spans[0]) : null;
      return {
        at: performance.now(), source, phase: state.phase, busy: pipeline.isBusy(),
        maskActive: !!mask?.classList.contains('active'), maskDisplay: mask ? getComputedStyle(mask).display : null,
        disabled: state.ids.map(id => document.getElementById(id)?.disabled ?? null),
        stopVisible: !!controls && getComputedStyle(controls).display !== 'none',
        log: document.getElementById('stream-log')?.textContent,
        spanCount: spans.length, bounce: first?.animationName, bounceState: first?.animationPlayState,
        bounceTransform: first?.transform, edge: edge?.animationName, edgeState: edge?.animationPlayState,
        edgeTransform: edge?.transform, autoSlots: state.autoSlots().length, autoSaves: state.autoSaves.length,
      };
    };
    state.observe = function(source) {
      if (!state.expectLocked) return;
      const sample = state.snapshot(source);
      state.samples.push(sample);
      const problems = [];
      if (!sample.busy) problems.push('busy cleared');
      if (!sample.maskActive || sample.maskDisplay !== 'flex') problems.push('mask hidden');
      if (sample.disabled.some(value => value !== true)) problems.push('a control enabled');
      if (!sample.spanCount || sample.bounce !== 'stream-log-bounce' || sample.bounceState !== 'running') problems.push('bounce inactive');
      if (sample.edge !== 'stream-spin' || sample.edgeState !== 'running') problems.push('edge spinner inactive');
      if (sample.autoSaves || sample.autoSlots !== state.baselineAutoSlots) problems.push('saved before judgment settled');
      if (state.phase !== 'narrative' && state.phase !== 'prepare' && sample.stopVisible) problems.push('Stop visible outside narrative');
      if (problems.length) state.violations.push({ ...sample, problems });
    };
    state.observer = new MutationObserver(() => state.observe('mutation'));
    state.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'disabled'] });
    const frame = () => { state.observe('animation-frame'); if (state.running) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);

    const realTimeout = window.setTimeout;
    window.setTimeout = function(callback, milliseconds, ...args) {
      if (String(new Error().stack).includes('side-quest-runner.js')) {
        state.retryTimers.push({ milliseconds, at: performance.now() });
      }
      return realTimeout.call(this, callback, milliseconds, ...args);
    };
    const realAutoSave = autoSave;
    window.autoSave = function(...args) {
      state.autoSaves.push({
        at: performance.now(), phase: state.phase,
        lastJudgedUiIndex: sideQuestService.getActive().lastJudgedUiIndex,
        progressNotes: sideQuestService.getActive().progressNotes,
      });
      return realAutoSave.apply(this, args);
    };
    function request(messages, options) {
      const kind = options?.maxOutputTokens === null ? 'judge' : 'narrative';
      const attempt = state.requests.filter(value => value.kind === kind).length + 1;
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      const pending = { kind, attempt, at: performance.now(), resolve, reject, promise, released: false };
      state.requests.push(pending);
      state.phase = kind === 'judge' ? `judge-${attempt}` : 'narrative';
      if (kind === 'narrative' && !messages.every(message => !message.content.includes('CORE_PROMPT'))) throw Error('Unexpected core prompt');
      if (options?.signal) options.signal.addEventListener('abort', () => reject(new DOMException('Fixture aborted', 'AbortError')), { once: true });
      return pending;
    }
    apiService.sendMessages = (messages, options) => request(messages, options).promise;
    apiService.sendMessagesStream = (messages, callbacks, options) => {
      const pending = request(messages, options);
      pending.promise.then(result => {
        callbacks.onToken?.(result.content);
        callbacks.onComplete(result.content, { fixture: true });
      }, error => callbacks.onError(error));
      return { abort() { pending.reject(new DOMException('Fixture aborted', 'AbortError')); } };
    };
    state.release = function(kind, attempt, outcome, terminal = false) {
      const pending = state.requests.find(value => value.kind === kind && value.attempt === attempt);
      if (!pending || pending.released) throw Error(`Missing or released ${kind} attempt ${attempt}`);
      state.observe('before-release');
      pending.released = true;
      pending.releasedAt = performance.now();
      pending.outcome = outcome;
      if (terminal) { state.expectLocked = false; state.phase = 'terminal-release'; }
      else if (kind === 'judge') state.phase = `retry-${attempt}`;
      if (outcome === 'reject') pending.reject(Error('Synthetic judge transport failure'));
      else pending.resolve({ content: kind === 'narrative' ? state.raw : outcome === 'invalid' ? 'Synthetic malformed judge reply' : state.judge });
    };
    state.coverage = function() {
      // Use the actual event DOM and its production z-index; only provide synthetic options/visibility.
      displayRandomEvent({
        事件描述: '合成书摊选项',
        选项一: { 描述: '整理书册', 奖励: '学识+1', 成功率: '100%' },
        选项二: { 描述: '核对清单', 奖励: '学识+1', 成功率: '100%' },
      });
      const container = document.getElementById('random-event-container');
      container.classList.add('show');
      const button = container.querySelector('button');
      button.addEventListener('click', () => { state.optionClicks++; });
      const bounds = button.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      const hit = document.elementFromPoint(x, y);
      const mask = document.getElementById('stream-mask');
      const maskBounds = mask.getBoundingClientRect();
      const gif = mask.querySelector('img');
      return {
        x, y, width: bounds.width, height: bounds.height,
        inViewport: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
        maskContainsPoint: x >= maskBounds.left && x <= maskBounds.right && y >= maskBounds.top && y <= maskBounds.bottom,
        topIsMask: !!hit && (hit === mask || mask.contains(hit)), hit: hit?.id || hit?.className,
        maskZ: Number(getComputedStyle(mask).zIndex), eventZ: Number(getComputedStyle(container).zIndex),
        gif: { src: gif.currentSrc, complete: gif.complete, width: gif.naturalWidth, height: gif.naturalHeight },
      };
    };
    state.start = function() {
      state.phase = 'prepare';
      state.expectLocked = true;
      state.turn = pipeline.runTurn('合成回归：清点书摊上的旧书。', {
        prepare: async function() {
          syncGameDataFromVariables();
          await storageService.saveFullSnapshot();
          storageService.saveAppState({ gameData });
        },
      }).then(result => { state.done = true; state.result = result; state.finishedAt = performance.now(); }, error => {
        state.done = true; state.error = error.stack || error.message;
      });
    };
    state.start();
    return { treeValidation: validation, questId: active.questId, initialSnapshot: state.snapshot('start') };
  }, streamMode);
}

async function assertHeld(page, label, stopVisible) {
  const value = await page.evaluate(label => {
    const state = window.__turnFlow;
    updateAllDisplays();
    updateFreeActionInputState();
    state.observe(`refresh-${label}`);
    const snapshot = state.snapshot(label);
    state.refreshes.push(snapshot);
    return { snapshot, done: state.done, violationCount: state.violations.length };
  }, label);
  assert.equal(value.done, false, `${label}: runTurn must still await settlement`);
  assert.equal(value.snapshot.busy, true, `${label}: pipeline stays busy`);
  assert.equal(value.snapshot.maskActive, true, `${label}: mask stays active`);
  assert.equal(value.snapshot.maskDisplay, 'flex');
  assert.deepEqual(value.snapshot.disabled, [true, true, true, true, true], `${label}: all five controls stay disabled after updateAllDisplays`);
  assert.equal(value.snapshot.stopVisible, stopVisible, `${label}: Stop belongs only to narrative request`);
  assert.match(value.snapshot.log, /施延年/);
  assert.equal(value.snapshot.bounce, 'stream-log-bounce');
  assert.equal(value.snapshot.bounceState, 'running');
  assert.equal(value.snapshot.edge, 'stream-spin');
  assert.equal(value.snapshot.edgeState, 'running');
  assert.equal(value.snapshot.autoSaves, 0);
  assert.equal(value.violationCount, 0, `${label}: no earlier transient unlock`);
  return value.snapshot;
}

async function assertCovered(page) {
  const coverage = await page.evaluate(() => __turnFlow.coverage());
  assert.ok(coverage.width > 0 && coverage.height > 0 && coverage.inViewport, 'Actual event option is laid out inside viewport');
  assert.ok(coverage.maskContainsPoint && coverage.topIsMask, `Mask must win event option hit test: ${JSON.stringify(coverage)}`);
  assert.ok(coverage.maskZ >= 2600 && coverage.maskZ > coverage.eventZ);
  assert.ok(coverage.gif.complete && coverage.gif.width > 0 && coverage.gif.height > 0, 'Shi Yannian GIF is loaded, not a broken image');
  assert.match(decodeURI(coverage.gif.src), /assets\/image\/static\/等待\.gif$/);
  await page.mouse.click(coverage.x, coverage.y);
  assert.equal(await page.evaluate(() => __turnFlow.optionClicks), 0, 'Physical click cannot reach event option');
  return coverage;
}

async function assertNextTurnBlocked(page) {
  const value = await page.evaluate(async () => {
    const before = __turnFlow.requests.length;
    let prepared = false;
    const result = await pipeline.runTurn('并发回合不应发送。', { prepare() { prepared = true; } });
    closeModal();
    return { result, prepared, before, after: __turnFlow.requests.length, snapshot: __turnFlow.snapshot('concurrent-turn') };
  });
  assert.equal(value.result, false, 'Next runTurn returns false while busy');
  assert.equal(value.prepared, false, 'Rejected turn cannot execute preparation');
  assert.equal(value.after, value.before, 'Rejected turn cannot make another API request');
  assert.equal(value.snapshot.maskActive, true, 'Rejected turn cannot clear original mask');
  assert.deepEqual(value.snapshot.disabled, [true, true, true, true, true]);
}

async function runCase(width, scenario) {
  const streamMode = width === 1280 ? 'stream' : 'non-stream';
  const label = `${width}-${scenario}`;
  const payload = await json(path.join(fixturesRoot, 'saves/gal.json'));
  const session = await newGameContext(browser, server, {
    payload, channel: `sq-turn-${label}`, scene3dPreferences: { enabled: false },
    viewport: { width, height: 900, deviceScaleFactor: 1 },
  });
  const page = session.page;
  page.setDefaultTimeout(15000);
  let result = { width, scenario, streamMode, status: 'FAIL' };
  try {
    await startGame(session, server);
    result.fixture = await installFixture(page, streamMode);
    await page.waitForFunction(() => __turnFlow.requests.some(request => request.kind === 'narrative'));
    await page.waitForFunction(() => {
      const image = document.querySelector('#stream-mask img');
      return image?.complete && image.naturalWidth > 0;
    });
    const narrative = await assertHeld(page, 'narrative', true);
    result.narrativeCoverage = await assertCovered(page);
    await page.waitForFunction(transform => getComputedStyle(document.querySelector('.stream-spinner'), '::before').transform !== transform, {}, narrative.edgeTransform);
    await page.waitForFunction(transform => getComputedStyle(document.querySelector('#stream-log span')).transform !== transform, {}, narrative.bounceTransform);
    await page.screenshot({ path: path.join(directory, `${label}-narrative.png`) });
    await page.evaluate(() => __turnFlow.release('narrative', 1, 'success'));
    await page.waitForFunction(() => __turnFlow.requests.some(request => request.kind === 'judge' && request.attempt === 1));
    await assertHeld(page, 'judge-1', false);
    result.judgeCoverage = await assertCovered(page);
    await assertNextTurnBlocked(page);
    await page.screenshot({ path: path.join(directory, `${label}-judge.png`) });
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (attempt > 1) {
        await page.waitForFunction(attempt => __turnFlow.requests.some(request => request.kind === 'judge' && request.attempt === attempt), {}, attempt);
        await assertHeld(page, `judge-${attempt}`, false);
      }
      if (attempt === 4) break;
      // Exercise both malformed output and transport errors with the real retry timer.
      await page.evaluate(attempt => __turnFlow.release('judge', attempt, attempt === 2 ? 'reject' : 'invalid'), attempt);
      await page.waitForFunction(attempt => document.querySelector('#stream-log')?.textContent.includes(`重试（${attempt}/3）`), {}, attempt);
      await assertHeld(page, `retry-${attempt}`, false);
      if (attempt === 1) {
        result.retryCoverage = await assertCovered(page);
        await assertNextTurnBlocked(page);
        await page.screenshot({ path: path.join(directory, `${label}-retry.png`) });
      }
    }
    await assertHeld(page, 'judge-4-before-settlement', false);
    await page.evaluate(scenario => __turnFlow.release('judge', 4, scenario === 'success' ? 'success' : 'invalid', true), scenario);
    await page.waitForFunction(() => __turnFlow.done);
    const final = await page.evaluate(() => {
      const state = __turnFlow;
      const modal = document.getElementById('modal');
      return {
        ...state.snapshot('settled'), done: state.done, result: state.result, error: state.error,
        requests: state.requests.map(({ kind, attempt, at, releasedAt, outcome }) => ({ kind, attempt, at, releasedAt, outcome })),
        retryTimers: state.retryTimers, autoSaves: state.autoSaves,
        autoSlots: state.autoSlots().map(slot => ({ ...slot, savedQuest: structuredClone(storageService.loadSave(slot.id)?.gameData?.sideQuest?.active) })), violations: state.violations,
        samples: state.samples, refreshes: state.refreshes,
        active: structuredClone(sideQuestService.getActive()),
        modal: { visible: getComputedStyle(modal).display !== 'none', text: document.getElementById('modal-text').textContent },
      };
    });
    await writeFile(path.join(directory, `${label}-probe.json`), JSON.stringify(final, null, 2));
    assert.equal(final.error, undefined);
    assert.equal(final.result, scenario === 'success');
    assert.equal(final.busy, false);
    assert.equal(final.maskActive, false);
    assert.equal(final.maskDisplay, 'none');
    assert.equal(final.stopVisible, false);
    assert.deepEqual(final.disabled, [false, false, false, false, false], 'All five controls release after settlement');
    assert.deepEqual(final.violations, [], 'No frame or observed DOM change unlocks before settlement');
    assert.ok(final.samples.filter(sample => sample.source === 'animation-frame').length >= 30, 'Continuity has real animation-frame coverage');
    const judges = final.requests.filter(request => request.kind === 'judge');
    assert.equal(final.requests.filter(request => request.kind === 'narrative').length, 1);
    assert.equal(judges.length, 4, 'One initial judgment plus exactly three retries');
    assert.deepEqual(final.retryTimers.map(timer => timer.milliseconds), [1000, 1000, 1000], 'Each actual runner retry uses 1000ms');
    const retryGaps = judges.slice(1).map((request, index) => request.at - judges[index].releasedAt);
    for (const gap of retryGaps) assert.ok(gap >= 990, `Retry cannot start before its one-second timer (${gap}ms)`);
    if (scenario === 'success') {
      assert.equal(final.autoSaves.length, 1);
      assert.ok(final.autoSaves[0].at >= judges[3].releasedAt);
      assert.equal(final.autoSaves[0].progressNotes, '合成进度已核对');
      assert.equal(final.autoSaves[0].lastJudgedUiIndex, final.active.lastJudgedUiIndex);
      assert.equal(final.autoSlots.length, 1, 'Real autosave slot is created after judgment');
      assert.equal(final.autoSlots[0].savedQuest.progressNotes, '合成进度已核对');
      assert.equal(final.active.turnsInNode, 1);
    } else {
      assert.equal(final.autoSaves.length, 0);
      assert.equal(final.autoSlots.length, 0, 'Four failed attempts create no real autosave slot');
      assert.equal(final.active.lastJudgedUiIndex, -1);
      assert.equal(final.modal.visible, true);
      assert.match(final.modal.text, /自动存档.*跳过/);
      assert.match(final.modal.text, /重新生成/);
    }
    await page.screenshot({ path: path.join(directory, `${label}-settled.png`) });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assertSessionSafe(session, server, `sq-turn-${label}`);
    Object.assign(result, {
      status: 'PASS', judgeCalls: judges.length, retryDelays: final.retryTimers.map(timer => timer.milliseconds),
      observedRetryGapsMs: retryGaps, samples: final.samples.length, autoSaveCalls: final.autoSaves.length,
      autoSaveSlots: final.autoSlots.length, pageErrors: 0, finalModal: scenario === 'failure' ? final.modal.text : null,
    });
  } catch (error) {
    result.error = error.stack || error.message;
    if (!page.isClosed()) {
      await page.screenshot({ path: path.join(directory, `${label}-failure.png`) }).catch(() => {});
      await page.evaluate(() => ({
        phase: window.__turnFlow?.phase, violations: window.__turnFlow?.violations,
        samples: window.__turnFlow?.samples, retryTimers: window.__turnFlow?.retryTimers,
      })).then(value => writeFile(path.join(directory, `${label}-failure.json`), JSON.stringify(value, null, 2))).catch(() => {});
    }
  } finally {
    result.pageErrors = session.logs.filter(entry => entry.type === 'pageerror').length;
    await writeFile(path.join(directory, `${label}-console.json`), JSON.stringify(session.logs, null, 2));
    await writeFile(path.join(directory, `${label}-network.json`), JSON.stringify(session.network, null, 2));
    if (!page.isClosed()) await page.evaluate(() => {
      if (window.__turnFlow) { __turnFlow.running = false; __turnFlow.observer.disconnect(); }
      sideQuestRunner.cancel();
    }).catch(() => {});
    await session.close();
    results.push(result);
    console.log(JSON.stringify({ width, scenario, streamMode, status: result.status, error: result.error }));
  }
}

try {
  server = await startTestServer({ gameRoot: workspace });
  environment.serverOrigin = server.origin;
  child = spawn(await findBrowser(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--enable-logging', `--log-file=${path.join(directory, 'chromium.log')}`,
    '--disable-background-networking', '--disable-component-update', '--no-first-run',
    '--disable-sync', '--disable-extensions', '--disable-features=MediaRouter', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' }); // DevToolsActivePort avoids sandbox-incompatible piped child stdio.
  environment.browserPid = child.pid;
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
  assert.ok(endpoint, 'Dedicated browser must publish DevTools endpoint');
  browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  environment.browser = await browser.version();
  for (const width of [1280, 390]) {
    for (const scenario of ['success', 'failure']) await runCase(width, scenario);
  }
  assert.equal(server.requests.length, 0, 'All narrative and judge requests stay inside apiService mocks');
  assert.deepEqual(server.events.filter(event => event.type === 'server-error'), []);
  environment.sourceAfter = await manifest();
  assert.deepEqual(environment.sourceAfter, before, 'Production sources must stay unchanged during the regression');
  assert.ok(results.every(result => result.status === 'PASS'), 'Every viewport/scenario must pass; inspect evidence for individual failures');
} catch (error) {
  environment.error = error.stack || error.message;
  process.exitCode = 1;
  console.error(environment.error);
} finally {
  if (browser) await browser.close().catch(error => { environment.browserCloseError = error.message; });
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  environment.browserStopped = !child || child.exitCode !== null || child.signalCode !== null;
  if (server) await server.close();
  environment.serverClosed = true;
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  environment.profileRemoved = await access(profile).then(() => false, () => true);
  environment.finishedAt = new Date().toISOString();
  await writeFile(path.join(directory, 'environment.json'), JSON.stringify(environment, null, 2));
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ evidence: directory, results: results.map(({ width, scenario, streamMode, status }) => ({ width, scenario, streamMode, status })), cleanup: { browserStopped: environment.browserStopped, serverClosed: environment.serverClosed, profileRemoved: environment.profileRemoved } }, null, 2));
}
