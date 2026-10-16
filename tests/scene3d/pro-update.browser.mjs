import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { artifact, hashFile, json, launchBrowser, sha256, workspace } from '../../scene3d/scripts/test-support.mjs';
import { startTestServer, isWithin } from '../../scene3d/scripts/test-server.mjs';
import { verifyRelease } from '../../scene3d/scripts/artifact-utils.mjs';

/**
 * Independent real-WebGL regression; no business-host page or old test is changed.
 * CLI: node tests/scene3d/pro-update.browser.mjs <absoluteReportDir> <buildId>
 * Report directory must be NEW, below workspace/.scene3d-work (never a release).
 * SCENE3D_NPC_SOURCE_ROOT optionally selects the successful frozen source baseline.
 * PRO_UPDATE_RUNTIME=source is an explicitly labelled source-runtime diagnostic mode;
 * the default is the actual published entry and its default bundled NPC controller.
 * Even source mode requires the requested release to exist and pass hash verification.
 * Importing this module starts no server/browser and writes nothing.
 */
export const PRO_UPDATE_CONTRACT = Object.freeze({
  version: 1, viewports: [1280, 390], qualities: ['low', 'balanced'],
  npcCount: 15, maxRenderedNpcs: 3, interiorModels: 12, businessInteriors: 11,
  hostUi: false, physicalAndroid: false, syntheticClicks: false, modifiesCurrentPointer: false,
});
const NPC_IDS = Object.freeze({ A: 'pozhenzi', B: 'dongting', C: 'qiantang', D: 'xiaobaihu', E: 'jisi', F: 'shiyannian', G: 'huyanxian', H: 'yuzhu', I: 'anmu', J: 'tangmuli', K: 'luoqianyou', L: 'shenmizayi', M: 'xuantianqing', N: 'luchunruo', O: 'lingxuefei' });
// Independent oracle, not imported from the implementation under test.
const ROOMS = Object.freeze([
  { id: 'gate', location: 'shanmen', file: 'gate.glb', hotspots: ['Gate_stairs'] },
  { id: 'fields', location: 'gongtian', file: 'fields.glb', hotspots: ['Fields_shed'] },
  { id: 'library', location: 'cangjingge', file: 'library_interior.glb', hotspots: ['desk', 'shelf_classics'] },
  { id: 'alchemy', location: 'danfang', file: 'alchemy_room.glb', hotspots: ['Alchemy_furnace'] },
  { id: 'female_quarters', location: 'nvdizi', file: 'female_quarters.glb', hotspots: ['Female_screen'] },
  { id: 'training', location: 'yanwuchang', file: 'training.glb', hotspots: ['Training_medallion'] },
  { id: 'council', location: 'yishiting', file: 'council_hall.glb', hotspots: ['sand_table', 'bounty_board'] },
  { id: 'kitchen', location: 'huofang', file: 'kitchen_room.glb', hotspots: ['Kitchen_firewood', 'Kitchen_counter'] },
  { id: 'male_quarters', location: 'nandizi', file: 'male_quarters.glb', hotspots: ['Male_bed_east'] },
  { id: 'forge', location: 'tiejiangpu', file: 'blacksmith.glb', hotspots: ['Smith_anvil', 'Smith_weapon_rack'] },
  { id: 'back_mountain', location: 'houshan', file: 'back_mountain.glb', hotspots: ['Ravine_cave', 'Ravine_stairs'] },
]);
const MODEL_ROOMS = [...ROOMS, { id: 'guest_quarters', file: 'guest_quarters.glb', hotspots: [] }];
const close = (a, b, epsilon = 1e-5, message = '') => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= epsilon, `${message}: ${a} != ${b}`);
const frames = (page, n = 2) => page.evaluate(count => new Promise(resolve => {
  const next = () => { if (--count <= 0) resolve(); else requestAnimationFrame(next); }; requestAnimationFrame(next);
}), n);
const observePause = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));

// Decode actual Chromium PNG output without adding image dependencies. No screenshot
// fixtures or generated replacement images can satisfy the pixel assertions below.
function pngPixels(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = []; let width, height, channels;
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset), kind = png.toString('ascii', offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + size);
    if (kind === 'IHDR') { width = data.readUInt32BE(); height = data.readUInt32BE(4); assert.equal(data[8], 8); assert.ok([2, 6].includes(data[9])); assert.equal(data[12], 0); channels = data[9] === 6 ? 4 : 3; }
    if (kind === 'IDAT') parts.push(data);
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(parts)), stride = width * channels, pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x, a = x >= channels ? pixels[index - channels] : 0, b = y ? pixels[index - stride] : 0, c = y && x >= channels ? pixels[index - stride - channels] : 0;
      const correction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      pixels[index] = (raw[y * (stride + 1) + x + 1] + correction) & 255;
    }
  }
  return { width, height, pixels, rgb(x, y) { const i = (Math.max(0, Math.min(height - 1, Math.floor(y))) * width + Math.max(0, Math.min(width - 1, Math.floor(x)))) * channels; return [...pixels.subarray(i, i + 3)]; } };
}

async function preflight(buildId, sourceRoot) {
  const releaseRoot = path.join(workspace, 'assets/sect3d', buildId);
  const verified = await verifyRelease(releaseRoot, buildId); // Refuse missing/unbuilt or altered releases.
  const npcPath = 'npc/generated/manifest.json', npcBytes = await readFile(path.join(releaseRoot, npcPath));
  const frozenNpcBytes = await readFile(path.join(sourceRoot, npcPath));
  assert.equal(sha256(npcBytes), sha256(frozenNpcBytes), 'Published NPC manifest must match the successful frozen baseline');
  const npcManifest = JSON.parse(npcBytes), rawCsv = await readFile(path.join(sourceRoot, 'npc/NPC身高.csv'));
  let csv; try { csv = new TextDecoder('utf-8', { fatal: true }).decode(rawCsv); } catch { csv = new TextDecoder('gbk', { fatal: true }).decode(rawCsv); }
  const heights = new Map();
  for (const line of csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/)) {
    const [name, cm, ...extra] = line.split(',').map(value => value.trim());
    assert.equal(extra.length, 0); assert.ok(name && Number.isFinite(Number(cm))); assert.equal(heights.has(name), false);
    heights.set(name, Number(cm) / 100);
  }
  assert.equal(npcManifest.version, 1); assert.equal(npcManifest.npcs.length, 15); assert.equal(heights.size, 15);
  assert.deepEqual(npcManifest.npcs.map(n => n.id).sort(), Object.values(NPC_IDS).sort());
  assert.equal(npcManifest.npcs.reduce((sum, npc) => sum + npc.frameCount, 0), 660);
  const sheets = npcManifest.npcs.flatMap(npc => npc.sheets); assert.equal(sheets.length, 17);
  for (const npc of npcManifest.npcs) assert.equal(npc.height, heights.get(npc.label), `CSV default ${npc.label}`);
  for (const sheet of sheets) {
    assert.match(sheet.file, /^npc\/generated\/[a-z0-9_-]+\.png$/);
    assert.equal((await hashFile(path.join(sourceRoot, sheet.file))).sha256, verified.manifest.files[sheet.file]?.sha256, `Frozen atlas ${sheet.file}`);
  }
  for (const room of MODEL_ROOMS) assert.ok(verified.manifest.files[`sub_scene/${room.file}`], `Published model ${room.id}`);
  assert.ok(verified.manifest.files['sect_diorama.glb']);
  return { ...verified, npcManifest, releaseRoot, sourceRoot, csvSha256: sha256(rawCsv), npcManifestSha256: sha256(npcBytes) };
}

function assertCamera(d, sceneId) {
  const c = d.cameraView; assert.ok(c, 'Camera diagnostics available'); assert.equal(c.enablePan, true);
  assert.ok(Number.isFinite(c.panRadius) && c.panRadius > 0 && c.panRadius <= 15, `Pan clamp radius: ${c.panRadius}`);
  assert.ok(Array.isArray(c.panOrigin) && c.panOrigin.length === 3, 'Pan clamp origin available');
  c.panOrigin.forEach((v, i) => close(v, c.target[i], 1e-5, 'Pan origin is the scene camera target'));
  if (sceneId === 'main') {
    close(c.panRadius, 15); close(c.zoom, 1.24); close(c.minPolarAngle, Math.PI / 4); close(c.maxPolarAngle, 5 * Math.PI / 12);
    c.position.forEach((v, i) => close(v, [10.39, 44.82, 53.63][i])); c.target.forEach((v, i) => close(v, [-.19, 10.49, -4.74][i]));
  } else {
    close(c.zoom, 1.55); close(c.minPolarAngle, Math.PI / 3); close(c.maxPolarAngle, Math.PI / 3);
    const delta = c.position.map((value, i) => value - c.target[i]); close(Math.atan2(delta[1], Math.hypot(delta[0], delta[2])), Math.PI / 6);
  }
}
function assertQuality(d, quality, interior) {
  assert.equal(d.quality, quality); assert.equal(d.qualityFallback, false, 'A silent fallback is not balanced coverage');
  assert.equal(d.postprocessing, quality === 'balanced' ? 1 : 0);
  if (quality === 'low') {
    assert.equal(d.renderTuning, null); assert.equal(d.atmosphere, 0);
    assert.equal(d.modelByteCache.entries, 0); assert.equal(d.modelByteCache.bytes, 0);
    assert.equal(d.prefetch.pending, 0); assert.equal(d.prefetch.timers, 0);
  }
  else {
    const t = d.renderTuning; assert.ok(t); assert.equal(t.samples, 2); assert.equal(t.disposed, false);
    assert.equal(t.aoWidth, Math.max(1, Math.floor(t.width / 2))); assert.equal(t.aoHeight, Math.max(1, Math.floor(t.height / 2)));
    assert.ok(t.width > 1 && t.height > 1); assert.equal(t.interior, interior);
    close(t.tuning.tiltShift, interior ? 1.5 : 2); close(t.tuning.dofSharp, 4.5); close(t.tuning.dofBlur, 1.5); close(t.tuning.vignette, .85);
  }
}
function assertResidents(d, ids, npcManifest) {
  assert.equal(d.npc.cards, ids.length); assert.ok(ids.length <= 3); assert.deepEqual(d.npc.fallbacks, []);
  assert.deepEqual(d.npc.residents.map(n => n.gameNpcId), ids); assert.ok(d.npc.cachedAssets <= 6); assert.ok(d.npc.pinnedAssets <= 3);
  assert.equal(d.npc.defaultSceneScale, 1.5); assert.equal(d.npc.npcShadows.count, ids.length);
  assert.equal(d.npc.npcShadows.shadowMapPasses, 0);
  for (const resident of d.npc.residents) {
    const meta = npcManifest.npcs.find(n => n.id === NPC_IDS[resident.gameNpcId]);
    close(resident.baseHeight, meta.height); close(resident.height, meta.height * 1.5);
    const shadow = d.npc.npcShadows.residents.find(s => s.gameNpcId === resident.gameNpcId);
    assert.ok(shadow?.supported, `Floor-supported ${resident.gameNpcId}`);
    shadow.foot.forEach((v, i) => close(v, resident.foot[i]));
    shadow.position.forEach((v, i) => close(v, shadow.foot[i] + shadow.normal[i] * .002, 2e-4, 'Contact normal lift'));
    close(shadow.depth, resident.height * .23); assert.ok(shadow.width > 0);
  }
}

async function makeSession(browser, server, directory, buildId, pre, runtimeMode, viewport) {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  const network = [], errors = [], consoleErrors = [], violations = [], harnessHashes = {};
  await page.setViewport(viewport); page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(60000);
  await page.setBypassServiceWorker(true); await page.setCacheEnabled(false);
  const releasePrefix = `/assets/sect3d/${buildId}/`, harnessPrefix = '/assets/pro-update-harness/';
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">${pre.manifest.css.map(name => `<link rel="stylesheet" href="${releasePrefix}${name}">`).join('')}<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#262626}#host{position:fixed;inset:0;font:14px sans-serif}</style><div id="host"></div><script type="importmap">{"imports":{"three":"${harnessPrefix}three/build/three.module.js","three/addons/":"${harnessPrefix}three/examples/jsm/"}}</script>`;
  await page.setRequestInterception(true);
  page.on('request', async request => {
    try {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) { await request.continue(); return; }
      if (url.origin !== server.origin || request.method() !== 'GET') { violations.push(request.url()); await request.abort('blockedbyclient'); return; }
      const pathname = decodeURIComponent(url.pathname);
      network.push({ event: 'request', url: pathname });
      if (pathname === '/pro-update-fixture.html') { await request.respond({ status: 200, contentType: 'text/html', body: html }); return; }
      let sourceRoot, relative;
      if (pathname.startsWith(`${harnessPrefix}three/`)) { sourceRoot = path.join(workspace, 'scene3d/node_modules/three'); relative = pathname.slice(`${harnessPrefix}three/`.length); }
      else if (runtimeMode === 'source' && pathname.startsWith(`${harnessPrefix}src/`)) { sourceRoot = path.join(workspace, 'scene3d/src'); relative = pathname.slice(`${harnessPrefix}src/`.length); }
      if (sourceRoot) {
        assert.ok(relative && !relative.split('/').some(part => part === '..' || part === '.') && !relative.includes('\\'));
        const filename = path.resolve(sourceRoot, relative); assert.ok(isWithin(sourceRoot, filename)); assert.match(filename, /\.js$/);
        const body = await readFile(filename); harnessHashes[path.relative(workspace, filename)] = sha256(body);
        await request.respond({ status: 200, contentType: 'text/javascript', body }); return;
      }
      if (pathname.startsWith(releasePrefix)) {
        const name = pathname.slice(releasePrefix.length);
        assert.ok(name === 'manifest.json' || Object.hasOwn(pre.manifest.files, name), `Unlisted release request ${name}`);
        await request.continue(); return;
      }
      violations.push(`Unexpected fixture request ${pathname}`); await request.abort('blockedbyclient');
    } catch (error) { violations.push(error.stack); if (!request.isInterceptResolutionHandled()) await request.abort('failed'); }
  });
  page.on('response', response => network.push({ event: 'response', url: response.url(), status: response.status() }));
  page.on('requestfailed', request => network.push({ event: 'failed', url: request.url(), reason: request.failure()?.errorText }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`${server.origin}/pro-update-fixture.html`);
  await page.evaluate(async ({ runtimeUrl, assetBaseUrl, npcManifest, rooms }) => {
    const { mount } = await import(runtimeUrl);
    const state = { mount, assetBaseUrl, npcManifest, rooms, view: null, epoch: 0, revision: 0, input: [], events: [], gl: null, last: null };
    state.start = async options => {
      if (state.view) await state.view.destroy();
      state.epoch++; state.revision = 0; state.events = []; state.input = []; state.gl = null;
      state.view = mount(document.querySelector('#host'), { assetBaseUrl, debug: true, reducedMotion: true, ...options, onEvent: event => state.events.push(event) });
    };
    state.apply = async (sceneId, ids = [], hour = 12, layoutKey) => {
      const room = rooms.find(r => r.id === sceneId), locationId = room?.location || 'tianshanpai';
      const visualIds = { A: 'pozhenzi', B: 'dongting', C: 'qiantang', D: 'xiaobaihu', E: 'jisi', F: 'shiyannian', G: 'huyanxian', H: 'yuzhu', I: 'anmu', J: 'tangmuli', K: 'luoqianyou', L: 'shenmizayi', M: 'xuantianqing', N: 'luchunruo', O: 'lingxuefei' };
      const renderedNpcs = ids.map(gameNpcId => ({ gameNpcId, displayName: npcManifest.npcs.find(n => n.id === visualIds[gameNpcId]).label, visualKind: 'animated', visualKey: visualIds[gameNpcId] }));
      state.last = { protocol: 1, sessionEpoch: state.epoch, revision: ++state.revision, mode: 0,
        logicalPage: sceneId === 'main' ? 'map' : locationId, gameLocationId: locationId, sceneId,
        residents: renderedNpcs.map(n => ({ gameNpcId: n.gameNpcId, displayName: n.displayName })), renderedNpcs,
        environment: { season: 'spring', hour }, layoutKey: layoutKey || `pro-update:${sceneId}:${ids.join(',')}`,
        visible: true, renderEnabled: true, interactive: true, blockReasons: [] };
      return state.view.applyState(state.last);
    };
    state.gpu = () => {
      const canvas = document.querySelector('#host canvas'); if (!canvas) throw Error('Missing real runtime canvas');
      const gl = canvas.getContext('webgl2'); if (!gl) throw Error('Real WebGL2 required'); state.gl = gl;
      if (!canvas.dataset.inputObserved) {
        canvas.dataset.inputObserved = 'true';
        for (const type of ['pointerdown', 'pointerup']) canvas.addEventListener(type, event => state.input.push({ type, isTrusted: event.isTrusted, pointerType: event.pointerType, x: event.clientX, y: event.clientY }));
      }
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return { webgl2: gl instanceof WebGL2RenderingContext, renderer: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL || gl.RENDERER), contextLost: gl.isContextLost() };
    };
    window.__proUpdate = state;
  }, { runtimeUrl: `${server.origin}${runtimeMode === 'source' ? `${harnessPrefix}src/runtime.js` : `${releasePrefix}${pre.manifest.entry}`}`, assetBaseUrl: `${server.origin}${releasePrefix}`, npcManifest: pre.npcManifest, rooms: ROOMS });
  return { context, page, directory, network, errors, consoleErrors, violations, harnessHashes };
}

async function snapshot(session, label, { varied = true } = {}) {
  const { page, directory } = session; await frames(page);
  const diagnostics = await page.evaluate(() => __proUpdate.view.getDiagnostics());
  const gpu = await page.evaluate(() => __proUpdate.gpu()); assert.equal(gpu.webgl2, true); assert.equal(gpu.contextLost, false);
  const filename = `${label}.png`, png = Buffer.from(await page.screenshot({ path: path.join(directory, filename) })), image = pngPixels(png);
  const colors = new Set();
  for (let y = .1; y < .95; y += .07) for (let x = .05; x < .95; x += .07) colors.add(image.rgb(x * image.width, y * image.height).join(','));
  if (varied) assert.ok(colors.size > 16, `Real scene must contain varied rendered pixels: ${label} (${colors.size})`);
  const evidence = { label, screenshot: filename, screenshotSha256: sha256(png), distinctSampleColors: colors.size, diagnostics, gpu };
  await artifact(directory, `${label}.json`, evidence);
  return { ...evidence, image };
}
async function apply(session, sceneId, ids = [], hour = 12, layoutKey) {
  const result = await session.page.evaluate((...args) => __proUpdate.apply(...args), sceneId, ids, hour, layoutKey);
  assert.equal(result.status, 'applied', `Apply ${sceneId}: ${JSON.stringify(result)}`);
  await session.page.waitForFunction(id => { const d = __proUpdate.view.getDiagnostics(); return d.ready && d.activeSceneId === id && d.frames > 0; }, {}, sceneId);
  await frames(session.page);
  // Same-route NPC replacement is intentionally asynchronous in the runtime.
  await session.page.waitForFunction(expected => {
    const n = __proUpdate.view.getDiagnostics().npc;
    return n && n.pendingLoads === 0 && (n.cards + n.fallbacks.length === expected.length) &&
      [...n.residents.map(r => r.gameNpcId), ...n.fallbacks.map(r => r.gameNpcId)].sort().join(',') === [...expected].sort().join(',');
  }, {}, ids);
  return session.page.evaluate(() => __proUpdate.view.getDiagnostics());
}

async function cameraInteraction(session, sceneId, label) {
  const { page } = session, before = await page.evaluate(() => __proUpdate.view.getDiagnostics().cameraView);
  assertCamera({ cameraView: before }, sceneId);
  const rect = await page.$eval('.scene3d-canvas', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const x = rect.x + rect.width * .5, y = rect.y + rect.height * .55;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + rect.width * .16, y - rect.height * .23, { steps: 12 }); await page.mouse.up(); await frames(page, 3);
  const dragged = await page.evaluate(() => __proUpdate.view.getDiagnostics().cameraView);
  const delta = dragged.position.map((v, i) => v - dragged.target[i]), pitch = Math.atan2(delta[1], Math.hypot(delta[0], delta[2]));
  if (sceneId === 'main') assert.ok(pitch >= Math.PI / 12 - 1e-5 && pitch <= Math.PI / 4 + 1e-5); else close(pitch, Math.PI / 6);
  dragged.target.forEach((v, i) => close(v, before.target[i], 1e-5, 'No pan'));
  assert.ok(dragged.position.some((v, i) => Math.abs(v - before.position[i]) > .01), 'Actual native drag must orbit');
  await page.mouse.wheel({ deltaY: -250 }); await frames(page, 3);
  const zoomed = await page.evaluate(() => __proUpdate.view.getDiagnostics().cameraView); assert.notEqual(zoomed.zoom, before.zoom);
  // Right-drag pans (OrbitControls default button mapping). Repeated diagonal overshoots
  // must never push the target outside the pan sphere and must end pinned on its rim,
  // vertical component included (pan delivery varies with viewport/zoom, so loop to rim).
  let panDist = 0, rim = false;
  for (let attempt = 0; attempt < 6 && !rim; attempt++) {
    await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.move(x + rect.width * .34, y + rect.height * .3, { steps: 12 }); await page.mouse.up({ button: 'right' }); await frames(page, 3);
    const panned = await page.evaluate(() => __proUpdate.view.getDiagnostics().cameraView);
    panDist = Math.hypot(...panned.target.map((v, i) => v - panned.panOrigin[i]));
    assert.ok(panDist <= panned.panRadius + 1e-4, `Pan target stays inside the sphere: ${panDist} > ${panned.panRadius}`);
    rim = panDist >= panned.panRadius - 1e-4;
  }
  assert.ok(rim, 'Pan clamp pins target to the sphere rim');
  await page.click('.scene3d-reset'); await frames(page, 3);
  const reset = await page.evaluate(() => __proUpdate.view.getDiagnostics().cameraView); assertCamera({ cameraView: reset }, sceneId);
  before.position.forEach((v, i) => close(reset.position[i], v));
  await artifact(session.directory, `${label}-native-camera.json`, { before, dragged, pitch, zoomed, reset });
}

async function modelAudit(session, rooms) {
  // Audit-only loader uses the installed real Three modules, not a fake decoder.
  // Business runtime still uses its published entry and its own default dependencies.
  const result = await session.page.evaluate(async rooms => {
    const THREE = await import('three'), { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'), { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
    const draco = new DRACOLoader().setDecoderPath(new URL('draco/', __proUpdate.assetBaseUrl).href).setWorkerLimit(1), loader = new GLTFLoader().setDRACOLoader(draco);
    const models = []; let guest;
    const disposeRoot = root => {
      const resources = new Set(), textures = new Set();
      const collectTexture = value => { if (value?.isTexture) { textures.add(value); if (value.image && typeof value.image.close === 'function') value.image.close(); } };
      const disposeMaterial = material => {
        resources.add(material);
        for (const value of Object.values(material)) collectTexture(value);
        for (const value of Object.values(material.uniforms || {})) collectTexture(value?.value);
        material.dispose?.();
      };
      root.traverse(node => {
        if (node.geometry) resources.add(node.geometry);
        if (node.skeleton) resources.add(node.skeleton);
        for (const value of Object.values(node.userData || {})) collectTexture(value);
        for (const material of [].concat(node.material || [])) disposeMaterial(material);
      });
      for (const texture of textures) texture.dispose();
      for (const resource of resources) resource.dispose?.();
      root.removeFromParent();
      return { geometries: resources.size, textures: textures.size };
    };
    try {
      for (const room of rooms) {
        const url = new URL(`sub_scene/${room.file}`, __proUpdate.assetBaseUrl).href, response = await fetch(url); if (!response.ok) throw Error(`Model HTTP ${response.status}: ${url}`);
        const gltf = await loader.parseAsync(await response.arrayBuffer(), new URL('.', url).href), root = gltf.scene;
        let meshes = 0, floor = null; root.traverse(node => { if (node.isMesh) meshes++; if (node.name === 'floor' && node.isMesh && node.userData.npcSpawn) floor = node; });
        models.push({ id: room.id, file: room.file, meshes, floor: !!floor, hotspotMeshes: room.hotspots.filter(name => root.getObjectByName(name)) });
        if (room.id === 'guest_quarters') guest = root; else disposeRoot(root);
      }
    } finally { draco.dispose(); }
    const renderer = new THREE.WebGLRenderer({ antialias: true }), scene = new THREE.Scene();
    renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1); renderer.setClearColor('#f6f0e0');
    const host = document.createElement('div'); host.id = 'guest-model-audit'; Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '100' }); host.appendChild(renderer.domElement); document.body.appendChild(host);
    scene.add(guest, new THREE.HemisphereLight('#ffffff', '#777777', 3));
    const box = new THREE.Box3().setFromObject(guest), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z) * 1.8, aspect = innerWidth / innerHeight;
    const camera = new THREE.OrthographicCamera(-span * aspect / 2, span * aspect / 2, span / 2, -span / 2, .1, 1000);
    camera.position.copy(center).add(new THREE.Vector3(span, span, span)); camera.lookAt(center); renderer.render(scene, camera);
    window.__proGuestAudit = { cleanup() { const disposed = disposeRoot(guest); renderer.dispose(); renderer.forceContextLoss(); host.remove(); return { gpu: { ...renderer.info.memory }, contextLost: renderer.getContext().isContextLost(), sceneTextures: disposed.textures, sceneGeometries: disposed.geometries }; } };
    return { models, guestWebgl2: renderer.getContext() instanceof WebGL2RenderingContext, calls: renderer.info.render.calls };
  }, rooms);
  await artifact(session.directory, 'model-audit.json', result);
  assert.equal(result.models.length, 12); assert.equal(result.guestWebgl2, true); assert.ok(result.calls > 0);
  for (const item of result.models) { const expected = rooms.find(r => r.id === item.id); assert.ok(item.meshes > 0 && item.floor, `Real parsed model ${item.id}`); assert.deepEqual(item.hotspotMeshes, expected.hotspots); }
  await session.page.screenshot({ path: path.join(session.directory, 'guest-model-audit.png') });
  const cleanup = await session.page.evaluate(() => { const value = __proGuestAudit.cleanup(); delete window.__proGuestAudit; return value; });
  assert.equal(cleanup.contextLost, true);
  assert.equal(cleanup.gpu.geometries, 0, 'All guest geometries must be disposed');
  // These models use linear vertex colours (no authored textures), so sceneTextures is
  // expected to be 0; renderer.info.memory.textures still reports 1 from a renderer-internal
  // default/empty texture bound for an unset PBR slot, which is not a scene resource leak.
  assert.equal(cleanup.sceneTextures, 0, 'Vertex-coloured models must not leave authored textures');
  await artifact(session.directory, 'model-audit-cleanup.json', cleanup);
}

async function ensureNpcsInView(session) {
  // Native zoom only, for inspection after default camera constraints were checked.
  // The authored placement/seed/feet and business subset are never overwritten.
  const { page } = session, before = await page.evaluate(() => __proUpdate.view.getDiagnostics().npc.residents.map(n => ({ id: n.gameNpcId, foot: n.foot })));
  let inside = false;
  for (let attempt = 0; attempt <= 12; attempt++) {
    inside = await page.evaluate(() => __proUpdate.view.getDiagnostics().npc.residents.every(n => {
      const a = n.anchor; return a && a.width >= 1 && a.height >= 2 && a.left > 2 && a.top > 2 && a.left + a.width < innerWidth - 2 && a.top + a.height < innerHeight - 2;
    }));
    if (inside || attempt === 12) break;
    await page.mouse.move(page.viewport().width / 2, page.viewport().height / 2); await page.mouse.wheel({ deltaY: 180 }); await frames(page);
  }
  assert.ok(inside, 'Real cards must project fully into the inspected canvas');
  assert.deepEqual(await page.evaluate(() => __proUpdate.view.getDiagnostics().npc.residents.map(n => ({ id: n.gameNpcId, foot: n.foot }))), before, 'Native inspection zoom must not relocate residents');
}

async function nativeAlphaClick(session, pre) {
  const { page } = session; await apply(session, 'training', ['B'], 12, 'pro-update:alpha:B');
  await ensureNpcsInView(session);
  const candidates = await page.evaluate(async meta => {
    const d = __proUpdate.view.getDiagnostics(), npc = d.npc.residents[0], a = npc.anchor;
    if (!a || a.left <= 2 || a.top <= 2 || a.left + a.width >= innerWidth - 2 || a.top + a.height >= innerHeight - 2) throw Error('Alpha oracle requires an unclipped real card anchor');
    if (npc.frame !== 0) throw Error('Reduced-motion fixture must keep actual first frame');
    const sheet = meta.sheets[0], image = new Image(); image.src = new URL(sheet.file, __proUpdate.assetBaseUrl).href; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = sheet.width; canvas.height = sheet.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, sheet.width, sheet.height).data;
    const points = { opaque: [], transparent: [] }, actualCanvas = document.querySelector('.scene3d-canvas');
    // The runtime picker raycasts against an area-averaged alpha mask capped at 512px
    // (npcs.js loadImage), so one picker texel spans several atlas pixels and bleeds body
    // alpha outward. Transparent candidates must clear that whole footprint, not just ±3px.
    const texel = Math.ceil(Math.max(sheet.width, sheet.height) / 512), gap = 2 * texel + 3;
    for (let row = 1; row < 24; row++) for (let col = 1; col < 24; col++) {
      const px = Math.floor(col / 24 * meta.width), py = Math.floor(row / 24 * meta.heightPixels), alphas = [];
      for (const dy of [-3, 0, 3]) for (const dx of [-3, 0, 3]) { const x = Math.max(0, Math.min(meta.width - 1, px + dx)) + meta.padding, y = Math.max(0, Math.min(meta.heightPixels - 1, py + dy)) + meta.padding; alphas.push(data[(y * sheet.width + x) * 4 + 3]); }
      let clear = true;
      for (let dy = -gap; dy <= gap && clear; dy++) for (let dx = -gap; dx <= gap; dx++) { const x = Math.max(0, Math.min(meta.width - 1, px + dx)) + meta.padding, y = Math.max(0, Math.min(meta.heightPixels - 1, py + dy)) + meta.padding; if (data[(y * sheet.width + x) * 4 + 3] !== 0) { clear = false; break; } }
      const x = a.left + (px + .5) / meta.width * a.width, y = a.top + (py + .5) / meta.heightPixels * a.height;
      if (document.elementFromPoint(x, y) !== actualCanvas) continue;
      const record = { x, y, pixel: [px, py], alphas, score: Math.hypot(col / 24 - .5, row / 24 - .55) };
      if (alphas.every(alpha => alpha >= 220)) points.opaque.push(record);
      if (clear) points.transparent.push(record);
    }
    canvas.width = canvas.height = 0;
    points.opaque.sort((a, b) => a.score - b.score); points.transparent.sort((a, b) => a.score - b.score);
    return { ...points, diagnostics: d };
  }, pre.npcManifest.npcs.find(n => n.id === 'dongting'));
  assert.ok(candidates.opaque.length && candidates.transparent.length, 'Independent actual PNG alpha candidates');
  const attempts = []; let hit = false;
  // Transparent clicks run first: a successful opaque hit drives the NPC focus camera
  // (emitNpcIntent reframes the card), which would invalidate these anchor-derived
  // coordinates. Misses never move the camera, so both loops share one candidate set.
  for (const point of candidates.transparent.slice(0, 3)) {
    const start = await page.evaluate(() => __proUpdate.events.length); await page.mouse.click(point.x, point.y); await frames(page);
    const events = await page.evaluate(start => __proUpdate.events.slice(start).filter(e => e.type === 'npcIntent'), start);
    attempts.push({ kind: 'transparent', point, events }); assert.deepEqual(events, [], 'Transparent actual sprite gap must not capture NPC click');
  }
  for (const point of candidates.opaque.slice(0, 60)) {
    const start = await page.evaluate(() => ({ events: __proUpdate.events.length, input: __proUpdate.input.length }));
    await page.mouse.click(point.x, point.y); await frames(page);
    const after = await page.evaluate(start => ({ events: __proUpdate.events.slice(start.events).filter(e => e.type === 'npcIntent'), input: __proUpdate.input.slice(start.input) }), start);
    attempts.push({ kind: 'opaque', point, ...after });
    assert.ok(after.input.some(e => e.type === 'pointerdown') && after.input.some(e => e.type === 'pointerup'), 'Native pointer pair reaches the real canvas');
    assert.ok(after.input.every(e => e.isTrusted && e.pointerType === 'mouse'));
    assert.ok(after.events.every(e => e.gameNpcId === 'B'));
    if (after.events.length) { assert.equal(after.events.length, 1); hit = true; break; }
  }
  assert.ok(hit, 'At least one actual opaque sprite pixel must deliver a native mouse NPC intent');
  await artifact(session.directory, 'native-alpha-click.json', { source: 'published PNG alpha, independent of runtime picker/mask', candidates: { opaque: candidates.opaque.length, transparent: candidates.transparent.length }, attempts });
  await snapshot(session, 'native-alpha-click');
}

async function dayNight(session, quality) {
  await apply(session, 'library', [], 12); const day = await snapshot(session, `${quality}-library-day`);
  assertQuality(day.diagnostics, quality, true); assert.equal(day.diagnostics.environmentState.paperColor, '#f6f0e0');
  await apply(session, 'library', [], 0); const night = await snapshot(session, `${quality}-library-night`);
  assert.equal(night.diagnostics.environmentState.paperColor, '#101c32');
  if (quality === 'balanced') { assert.equal(day.diagnostics.renderTuning.paperColor, '#f6f0e0'); assert.equal(night.diagnostics.renderTuning.paperColor, '#101c32'); }
  const samples = [[.02, .98], [.98, .98], [.01, .5], [.99, .5]].map(([x, y]) => {
    const a = day.image.rgb(day.image.width * x, day.image.height * y), b = night.image.rgb(night.image.width * x, night.image.height * y);
    return { uv: [x, y], day: a, night: b, brightnessDrop: a.reduce((s, n) => s + n, 0) / 3 - b.reduce((s, n) => s + n, 0) / 3 };
  });
  assert.ok(samples.filter(sample => sample.brightnessDrop > 20).length >= 2, 'Actual canvas backdrop must become darker, not just diagnostics');
  await artifact(session.directory, `${quality}-day-night-pixels.json`, samples);
}

async function hideAndDestroy(session, label) {
  const { page } = session;
  const hidden = await page.evaluate(() => { __proUpdate.view.setVisible(false); return __proUpdate.view.getDiagnostics(); });
  await observePause(page);
  const paused = await page.evaluate(() => __proUpdate.view.getDiagnostics());
  assert.equal(paused.frames, hidden.frames); assert.equal(paused.raf, 0); assert.equal(paused.interactionEnabled, false);
  assert.equal(paused.hotspots.visible, false); assert.equal(paused.npc.npcShadows.count, 0);
  assert.equal(paused.prefetch.pending, 0); assert.equal(paused.prefetch.timers, 0);
  if (paused.quality === 'balanced') { assert.equal(paused.prefetch.paused, true); assert.ok(paused.modelByteCache.entries <= 3); assert.ok(paused.modelByteCache.bytes <= 32 * 1024 * 1024); }
  const resumed = await page.evaluate(() => __proUpdate.view.applyState({ ...__proUpdate.last, revision: ++__proUpdate.revision }));
  assert.equal(resumed.status, 'applied'); await frames(page, 3);
  assert.ok((await page.evaluate(() => __proUpdate.view.getDiagnostics().frames)) > paused.frames);
  const cleanup = await page.evaluate(async () => {
    __proUpdate.gpu(); const gl = __proUpdate.gl;
    await __proUpdate.view.destroy(); await __proUpdate.view.destroy();
    return { d: __proUpdate.view.getDiagnostics(), canvases: document.querySelectorAll('#host canvas').length, hotspotNodes: document.querySelectorAll('#host .scene3d-hotspot').length, contextLost: gl.isContextLost() };
  });
  await observePause(page); const settled = await page.evaluate(() => __proUpdate.view.getDiagnostics());
  await artifact(session.directory, `${label}-lifecycle.json`, { hidden, paused, cleanup, settled });
  for (const key of ['raf', 'listeners', 'controls', 'observers', 'renderers', 'canvases', 'decoders', 'fetches', 'pendingLoads', 'resources', 'roots', 'geometries', 'materials', 'textures', 'pending', 'cachedMain', 'cachedRooms', 'postprocessing', 'atmosphere']) assert.equal(cleanup.d[key], 0, `Disposed runtime ${key}`);
  assert.equal(cleanup.d.destroyed, true); assert.equal(cleanup.d.rendererCreated, cleanup.d.rendererDisposed); assert.equal(cleanup.d.registered, cleanup.d.disposed);
  assert.equal(cleanup.d.errors, 0); assert.equal(cleanup.d.npcErrors, 0); assert.equal(cleanup.contextLost, true); assert.equal(cleanup.canvases, 0); assert.equal(cleanup.hotspotNodes, 0);
  for (const key of ['cards', 'cachedAssets', 'pinnedAssets', 'pendingLoads', 'alphaBytes', 'fallbackListeners']) assert.equal(cleanup.d.npc[key], 0, `Disposed NPC ${key}`);
  assert.equal(cleanup.d.npc.npcShadows.count, 0); assert.equal(cleanup.d.npc.shadowGroupsCreated, cleanup.d.npc.shadowGroupsDisposed);
  assert.equal(cleanup.d.npc.texturesCreated, cleanup.d.npc.texturesDisposed); assert.equal(cleanup.d.hotspots.count, 0);
  for (const key of ['pending', 'timers', 'materialListeners']) assert.equal(cleanup.d.compilation[key], 0);
  assert.equal(cleanup.d.compilation.disposed, true); assert.equal(settled.frames, cleanup.d.frames);
  assert.equal(settled.modelByteCache.entries, 0); assert.equal(settled.modelByteCache.bytes, 0);
  assert.equal(settled.prefetch.pending, 0); assert.equal(settled.prefetch.timers, 0);
  if (settled.quality === 'balanced') assert.equal(settled.prefetch.disposed, true);
  session.expectedPrefetchAborts = (session.expectedPrefetchAborts || 0) + (settled.prefetch.aborted || 0);
  return cleanup;
}

async function naturalJisiAnimation(session) {
  const { page } = session;
  await page.evaluate(() => __proUpdate.start({ quality: 'low', reducedMotion: false }));
  await apply(session, 'training', ['E'], 12, 'pro-update:natural-jisi');
  await ensureNpcsInView(session);
  await page.evaluate(() => { __proUpdate.frameHistory = []; });
  const waitAndFreeze = async stage => {
    await page.waitForFunction(stage => {
      const d = __proUpdate.view.getDiagnostics(), npc = d.npc.residents[0]; if (!npc) return false;
      const history = __proUpdate.frameHistory;
      if (!history.length || history.at(-1).frame !== npc.frame) history.push({ frame: npc.frame, elapsedMs: d.npc.elapsedMs, runtimeFrames: d.frames });
      const match = stage === 'before' ? npc.frame >= 52 && npc.frame < 56 : stage === 'after' ? npc.frame >= 56 : npc.frame < 10;
      if (match) { __proUpdate.view.setRenderEnabled(false); return true; } return false;
    }, { polling: 'raf', timeout: 120000 }, stage);
    const d = await page.evaluate(() => __proUpdate.view.getDiagnostics());
    const a = d.npc.residents[0].anchor; assert.ok(a && a.width >= 2 && a.height >= 2, 'Real animated card must project on screen');
    const clip = { x: Math.max(0, a.left), y: Math.max(0, a.top), width: Math.max(1, Math.min(a.width, session.page.viewport().width - a.left)), height: Math.max(1, Math.min(a.height, session.page.viewport().height - a.top)) };
    const png = Buffer.from(await page.screenshot({ path: path.join(session.directory, `jisi-${stage}-card.png`), clip }));
    await snapshot(session, `jisi-${stage}`);
    return { frame: d.npc.residents[0].frame, elapsedMs: d.npc.elapsedMs, clip, pixels: pngPixels(png).pixels, screenshotSha256: sha256(png) };
  };
  const before = await waitAndFreeze('before'); await page.evaluate(() => __proUpdate.view.setRenderEnabled(true));
  const after = await waitAndFreeze('after'); await page.evaluate(() => __proUpdate.view.setRenderEnabled(true));
  const wrapped = await waitAndFreeze('wrapped');
  assert.ok(before.frame < 56 && after.frame >= 56 && wrapped.frame < 10);
  assert.equal(before.pixels.length, after.pixels.length); assert.notDeepEqual(before.pixels, after.pixels, 'Actual character pixels must change across pages');
  assert.ok(session.network.some(n => n.event === 'response' && n.url.endsWith('/npc/generated/jisi-1.png') && n.status === 200));
  await artifact(session.directory, 'jisi-natural-animation.json', { before: { ...before, pixels: undefined }, after: { ...after, pixels: undefined }, wrapped: { ...wrapped, pixels: undefined }, history: await page.evaluate(() => __proUpdate.frameHistory), clock: 'unmodified runtime delta / native RAF; no setFrame or animation-time override' });
  await page.evaluate(() => __proUpdate.view.setRenderEnabled(true));
  return hideAndDestroy(session, 'jisi');
}

export async function runProUpdate({ directory, buildId, sourceRoot = process.env.SCENE3D_NPC_SOURCE_ROOT || path.join(workspace, '.scene3d-work/pro-update-baseline-007c/pro'), runtimeMode = process.env.PRO_UPDATE_RUNTIME || 'release' }) {
  assert.ok(path.isAbsolute(directory), 'absoluteReportDir is required'); assert.match(buildId, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
  assert.ok(['source', 'release'].includes(runtimeMode));
  const reportRoot = path.join(workspace, '.scene3d-work'); assert.ok(isWithin(reportRoot, directory) && path.resolve(directory) !== path.resolve(reportRoot), 'Use a new child of workspace/.scene3d-work');
  assert.ok(path.isAbsolute(sourceRoot), 'Frozen source root must be absolute');
  assert.ok(!isWithin(directory, sourceRoot) && !isWithin(path.dirname(sourceRoot), directory), 'Evidence must be outside the source freeze and its snapshot wrapper');
  await mkdir(path.dirname(directory), { recursive: true }); await mkdir(directory); // Exclusive: never replace another run's evidence.
  let browser, server, failure, pre; const cases = [], sessions = [];
  const currentPath = path.join(workspace, 'assets/sect3d/current.json'), currentBefore = await readFile(currentPath).catch(() => null);
  try {
    pre = await preflight(buildId, sourceRoot);
    await artifact(directory, 'preflight.json', { buildId, runtimeMode, sourceRoot, manifestSha256: pre.manifestSha256, npcManifestSha256: pre.npcManifestSha256, csvSha256: pre.csvSha256, contract: PRO_UPDATE_CONTRACT });
    server = await startTestServer({ gameRoot: workspace }); browser = await launchBrowser();
    for (const width of [1280, 390]) {
      const viewport = { width, height: width === 1280 ? 800 : 844, deviceScaleFactor: 1 }, childDir = path.join(directory, String(width)); await mkdir(childDir);
      const session = await makeSession(browser, server, childDir, buildId, pre, runtimeMode, viewport); sessions.push(session);
      const { page } = session;
      if (width === 1280) await modelAudit(session, MODEL_ROOMS);
      await page.evaluate(() => __proUpdate.start({ quality: 'low' }));
      let d = await apply(session, 'main'); assertCamera(d, 'main'); assertQuality(d, 'low', false); assert.equal(d.npc.cards, 0); assert.equal(d.hotspots.count, 0);
      await snapshot(session, 'low-main'); await cameraInteraction(session, 'main', 'low-main');
      for (const room of ROOMS) {
        d = await apply(session, room.id); assertCamera(d, room.id); assertQuality(d, 'low', true);
        assert.equal(d.hotspots.count, room.hotspots.length, `${room.id} hotspot count`); assert.equal(d.hotspots.visible, true);
        assert.deepEqual(d.hotspots.labels.map(label => label.mesh).sort(), [...room.hotspots].sort());
        const dom = await page.$$eval('.scene3d-hotspot', nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { mesh: node.dataset.mesh, hidden: node.hidden, pointerEvents: getComputedStyle(node).pointerEvents, x: r.x, y: r.y, width: r.width, height: r.height }; }));
        assert.equal(dom.length, room.hotspots.length); assert.ok(dom.every(node => node.pointerEvents === 'auto'), 'Hotspot buttons stay pointer-enabled (release CSS contract; the layer alone is pointer-events:none)');
        for (const node of dom.filter(node => !node.hidden)) assert.ok(node.x >= -1 && node.y >= -1 && node.x + node.width <= width + 1 && node.y + node.height <= viewport.height + 1, 'Visible hotspot CSS bounds');
        await snapshot(session, `low-${room.id}`); cases.push({ width, quality: 'low', sceneId: room.id, hotspots: d.hotspots, dom });
        await artifact(directory, 'cases.json', cases);
      }
      await cameraInteraction(session, ROOMS.at(-1).id, 'low-interior');
      d = await apply(session, 'main'); assertCamera(d, 'main'); assert.equal(d.hotspots.count, 0); assert.equal(d.npc.cards, 0);
      await snapshot(session, 'low-return-main');
      const ids = Object.keys(NPC_IDS);
      for (let i = 0; i < ids.length; i += 3) {
        const batch = ids.slice(i, i + 3); d = await apply(session, 'training', batch); assertResidents(d, batch, pre.npcManifest);
        assert.equal(d.npc.npcShadows.enabled, true); assert.equal(d.npc.npcShadows.visibleCount, batch.length);
        await ensureNpcsInView(session);
        await snapshot(session, `npc-batch-${i / 3 + 1}`); cases.push({ width, npcBatch: batch, diagnostics: d });
      }
      const feet = d.npc.residents.map(n => n.foot), loads = d.npc.loads;
      assert.equal(await page.evaluate(() => __proUpdate.view.setNpcShadows(false)), true); await frames(page);
      const off = await snapshot(session, 'npc-shadow-off'); assert.equal(off.diagnostics.npc.npcShadows.visibleCount, 0);
      assert.equal(await page.evaluate(() => __proUpdate.view.setNpcShadows(true)), true); await frames(page);
      const on = await snapshot(session, 'npc-shadow-on'); assert.equal(on.diagnostics.npc.npcShadows.visibleCount, 3);
      assert.deepEqual(on.diagnostics.npc.residents.map(n => n.foot), feet); assert.equal(on.diagnostics.npc.loads, loads);
      await nativeAlphaClick(session, pre); await dayNight(session, 'low');
      cases.push({ width, cleanup: await hideAndDestroy(session, 'low') });
      await page.evaluate(() => __proUpdate.start({ quality: 'balanced', npcShadows: false }));
      d = await apply(session, 'main'); assertCamera(d, 'main'); assertQuality(d, 'balanced', false); await snapshot(session, 'balanced-main');
      d = await apply(session, 'library', ['B']); assertCamera(d, 'library'); assertQuality(d, 'balanced', true); assertResidents(d, ['B'], pre.npcManifest);
      assert.equal(d.npc.npcShadows.enabled, false); assert.equal(d.npc.npcShadows.visibleCount, 0, 'mount option forwarded without settings UI');
      await page.evaluate(() => __proUpdate.view.setNpcShadows(true)); await frames(page); assert.equal((await page.evaluate(() => __proUpdate.view.getDiagnostics())).npc.npcShadows.visibleCount, 1);
      await snapshot(session, 'balanced-library-npc'); await dayNight(session, 'balanced');
      cases.push({ width, quality: 'balanced', cleanup: await hideAndDestroy(session, 'balanced') });
      if (width === 1280) cases.push({ width, naturalJisiCleanup: await naturalJisiAnimation(session) });
      assert.deepEqual(session.errors, []); assert.deepEqual(session.violations, []); assert.deepEqual(session.consoleErrors, []);
      const failedRequests = session.network.filter(n => n.event === 'failed');
      // Pausing/disposal intentionally aborts only background GLB requests. Require
      // both the exact native abort reason/path and a matching diagnostic budget.
      assert.ok(failedRequests.every(n => n.reason === 'net::ERR_ABORTED' && n.url.startsWith(`${server.origin}/assets/sect3d/${buildId}/sub_scene/`) && n.url.endsWith('.glb')), 'Unexpected failed asset request');
      assert.ok(failedRequests.length <= (session.expectedPrefetchAborts || 0), 'Aborts must be accounted for by the prefetch owner');
      assert.ok(session.network.filter(n => n.event === 'response').every(n => n.status === 200));
      await artifact(childDir, 'network.json', { network: session.network, errors: session.errors, consoleErrors: session.consoleErrors, violations: session.violations, harnessHashes: session.harnessHashes });
      await artifact(directory, 'cases.json', cases); await session.context.close();
    }
  } catch (error) {
    failure = error; await artifact(directory, 'failure.json', { message: error.message, stack: error.stack, cases });
    for (const session of sessions) if (!session.page.isClosed()) { try { await session.page.screenshot({ path: path.join(session.directory, 'failure.png') }); } catch {} }
  } finally {
    for (const session of sessions) {
      if (!session.page.isClosed()) { try { await session.page.evaluate(async () => { window.__proGuestAudit?.cleanup?.(); await window.__proUpdate?.view?.destroy(); }); } catch {} }
      await artifact(session.directory, 'network.json', { network: session.network, errors: session.errors, consoleErrors: session.consoleErrors, violations: session.violations, harnessHashes: session.harnessHashes });
      await session.context.close().catch(() => {});
    }
    await browser?.close(); await server?.close();
    const currentAfter = await readFile(currentPath).catch(() => null);
    assert.equal(currentAfter ? sha256(currentAfter) : null, currentBefore ? sha256(currentBefore) : null, 'Test never changes current.json');
  }
  if (failure) throw failure;
  // Detect release mutation during the run, not just a successful initial download.
  await verifyRelease(pre.releaseRoot, buildId, pre.manifestSha256);
  const result = { status: 'PASS', buildId, runtimeMode, manifestSha256: pre.manifestSha256, sourceRoot, contract: PRO_UPDATE_CONTRACT, cases,
    scope: 'Real WebGL and native mouse with published models/PNGs; synthetic protocol-valid host snapshots only. Default mode exercises published mount and default NPC controller. Guest model is audit-only, no guest business route. Not original business host UI, physical Android, or an APK/build/publish operation.' };
  await artifact(directory, 'result.json', result); return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , directory, buildId] = process.argv;
  if (!directory || !buildId || process.argv.length !== 4) {
    console.error('Usage: node tests/scene3d/pro-update.browser.mjs <absoluteReportDir under .scene3d-work> <buildId>'); process.exitCode = 2;
  } else {
    try { const result = await runProUpdate({ directory, buildId }); console.log(JSON.stringify({ status: result.status, buildId, runtimeMode: result.runtimeMode, directory, cases: result.cases.length })); }
    catch (error) { console.error(error.stack); console.error(`Evidence: ${directory}`); process.exitCode = 1; }
  }
}
