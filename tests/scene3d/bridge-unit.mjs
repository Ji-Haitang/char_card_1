import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../module/scene3d-bridge.js', import.meta.url), 'utf8');
const drain = () => new Promise(resolve => setImmediate(resolve));
const helpersSource = await readFile(new URL('../../module/game-helpers.js', import.meta.url), 'utf8');
const legacyLocationPopup = helpersSource.slice(helpersSource.indexOf('function showLocationInfo(locationId, event)'), helpersSource.indexOf('// 设置地点事件'));
assert.ok(legacyLocationPopup.includes('function closeLocationInfo(e)'));
function host({ mode = 0, stored = null, patch = null } = {}) {
  const elements = new Map();
  class Element {
    constructor(id = '') { this.id = id; this.hidden = false; this.children = []; this.dataset = {}; this.style = {}; this.clientWidth = 500; this.clientHeight = 300; this.classes = new Set(); this.classList = { add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)), contains: n => this.classes.has(n) }; }
    append(...nodes) { this.children.push(...nodes); this.firstChild = this.children[0]; }
    appendChild(node) { this.append(node); return node; }
    setAttribute() {} removeAttribute() {} addEventListener() {} remove() {} closest() { return null; }
    getBoundingClientRect() { return { left: 10, top: 20, width: 500, height: 300, right: 510, bottom: 320 }; }
    getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
  }
  for (const id of ['main-viewport', 'sect-3d-root', 'map-scene', 'cangjingge-scene', 'player-stats-scene']) elements.set(id, new Element(id));
  elements.get('cangjingge-scene').classes.add('active');
  const document = {
    baseURI: 'http://127.0.0.1:1234/index.html', hidden: false, body: new Element(), head: new Element(),
    getElementById: id => elements.get(id), createElement: () => new Element(), createTextNode: textContent => ({ textContent }), addEventListener() {},
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const scenes = [...elements.values()].filter(el => el.id.endsWith('-scene'));
      if (selector === '#main-viewport > .scene.active') return scenes.filter(el => el.classes.has('active'));
      if (selector === '#main-viewport > .scene') return scenes;
      return [];
    }
  };
  const counts = { fetch: 0, rng: 0, sync: 0, writes: 0 };
  const sandbox = {
    document, location: { protocol: 'http:' }, innerWidth: 500, URL, TextDecoder, Uint8Array,
    queueMicrotask, setTimeout, clearTimeout, console: { warn() {}, log() {} },
    MutationObserver: class { observe() {} }, addEventListener() {},
    matchMedia: () => ({ matches: true }), getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    localStorage: { getItem: () => stored, setItem() { counts.writes++; } },
    fetch: () => { counts.fetch++; return new Promise(() => {}); },
    syncGameDataFromVariables() { counts.sync++; }, syncVariablesFromGameData() { counts.sync++; },
    Math: Object.assign(Object.create(Math), { random() { counts.rng++; return .5; } })
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(`let GameMode=${mode}, inputEnable=1, userLocation='cangjingge', currentNpcLocations={A:'cangjingge',B:'cangjingge'}, npcs={A:{name:'甲'},B:{name:'乙'}}, npcVisibility={A:true,B:true}, dayNightStatus='daytime',seasonStatus='winter',npcPortraits={A:'img/NPC/a.webp',B:'img/NPC/b.webp'};`, context);
  vm.runInContext(patch ? patch(source) : source, context);
  return { context, counts, elements, document, bridge: sandbox.GameSceneBridge, run: code => vm.runInContext(code, context) };
}
test('classic bridge import is inert and only exposes a frozen boundary', () => {
  const game = host();
  assert.equal(game.bridge.getDiagnostics().started, false);
  assert.deepEqual(game.counts, { fetch: 0, rng: 0, sync: 0, writes: 0 });
  assert.equal(Object.isFrozen(game.bridge), true);
});
test('projection reads lexical GameMode and exact already-selected NPC subset without RNG/sync/save', async () => {
  const game = host();
  assert.equal(game.context.GameMode, undefined);
  game.bridge.publishNpcs('cangjingge', ['B']); game.bridge.start(); await drain();
  const state = game.bridge.getDiagnostics().snapshot;
  assert.equal(state.mode, 0); assert.equal(state.sceneId, 'library'); assert.equal(state.logicalPage, 'cangjingge');
  assert.deepEqual(Array.from(state.renderedNpcs, npc => npc.gameNpcId), ['B']);
  assert.equal(state.renderedNpcs[0].visualKey, 'dongting'); assert.equal(state.residents.length, 2);
  for (let i = 0; i < 20; i++) game.bridge.notify('repeat');
  await drain(); assert.deepEqual(game.counts, { fetch: 0, rng: 0, sync: 0, writes: 0 });
  state.renderedNpcs[0].gameNpcId = 'O';
  assert.equal(game.bridge.getDiagnostics().snapshot.renderedNpcs[0].gameNpcId, 'B');
});
test('enabled Gal cold-start and special pages do not request 3D module/assets', async () => {
  const game = host({ mode: 1, stored: '{"enabled":true,"quality":"low"}' });
  game.bridge.start(); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.visible, false); assert.equal(game.counts.fetch, 0);
  game.run('GameMode=0');
  game.elements.get('cangjingge-scene').classes.delete('active'); game.elements.get('player-stats-scene').classes.add('active');
  game.bridge.notify('attributes'); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.sceneId, null); assert.equal(game.counts.fetch, 0);
});
test('hidden-but-present NPC is excluded without degrading valid roster; exact parsed time is epoch scoped', async () => {
  const game = host(); game.bridge.start();
  game.bridge.publishNpcs('cangjingge', ['B']); game.bridge.captureTime('03:30'); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.environment.hour, 3.5);
  game.bridge.captureTime('99:99'); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.environment.hour, 3.5);
  game.bridge.afterRestore('test-restore', true); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.environment.hour, 14);
  game.run('npcVisibility.B=false'); game.bridge.notify('fixture-hidden'); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.rosterError, false);
  assert.equal(game.bridge.getDiagnostics().snapshot.sceneId, 'library');
  assert.deepEqual(Array.from(game.bridge.getDiagnostics().snapshot.residents, n => n.gameNpcId), ['A']);
  assert.equal(game.bridge.getDiagnostics().snapshot.locationNpcCounts.cangjingge, 2);
  assert.equal(game.counts.rng, 0); assert.equal(game.counts.sync, 0);
});
test('business input lock applies even without a visible modal', async () => {
  const game = host(); game.bridge.start(); game.run('inputEnable=0'); game.bridge.notify('special-chain'); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.blockReasons.includes('business-input-disabled'), true);
  game.bridge.setBusy('transient', true); game.bridge.setBusy('transient', false); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.blockReasons.includes('business-input-disabled'), true);
  game.run('inputEnable=1'); game.bridge.notify('special-end'); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.blockReasons.includes('business-input-disabled'), false);
});
test('generation tokens nest and independent releases do not unlock other owners', async () => {
  const game = host(); game.bridge.start();
  game.bridge.setBusy('main', true); game.bridge.setBusy('special', true); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.blockReasons.includes('generation:main'), true);
  game.bridge.setBusy('main', false); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.blockReasons.includes('generation:main'), false);
  assert.equal(game.bridge.getDiagnostics().snapshot.blockReasons.includes('generation:special'), true);
});

test('original random 2D three-person DOM survives 3D all-residents and return without business RNG/save changes', async () => {
  const game = host();
  const container = game.document.createElement('div'); game.elements.set('cangjingge-npcs', container);
  game.run("for (const id of 'CDEFGHIJKLMNO') { npcs[id]={name:id}; currentNpcLocations[id]='cangjingge'; npcVisibility[id]=true; npcPortraits[id]='img/'+id+'.webp'; }");
  game.run(helpersSource.slice(helpersSource.indexOf('function getNpcsAtLocation(location)'), helpersSource.indexOf('// 立绘像素检测的离屏canvas缓存')));
  game.bridge.start(); game.run("displayNpcs('cangjingge')"); await drain();
  const originalNodes = [...container.children], ids = originalNodes.map(node => node.dataset.npcId);
  assert.equal(ids.length, 3); assert.ok(game.counts.rng > 0, 'real host display consumed its original RNG');
  const rng = game.counts.rng, business = game.run('JSON.stringify({currentNpcLocations,npcs,npcVisibility})');
  assert.deepEqual(Array.from(game.bridge.getDiagnostics().snapshot.renderedNpcs, n => n.gameNpcId), ids);
  game.bridge.setPreference({ enabled: true }); await drain();
  assert.deepEqual(Array.from(game.bridge.getDiagnostics().snapshot.renderedNpcs, n => n.gameNpcId), [...'ABCDEFGHIJKLMNO']);
  assert.equal(game.bridge.getDiagnostics().snapshot.locationNpcCounts.cangjingge, 15);
  assert.deepEqual(container.children, originalNodes, 'same three original DOM nodes while 3D is enabled');
  game.bridge.setPreference({ enabled: false }); await drain();
  assert.deepEqual(Array.from(game.bridge.getDiagnostics().snapshot.renderedNpcs, n => n.gameNpcId), ids);
  assert.deepEqual(container.children, originalNodes);
  assert.equal(game.counts.rng, rng); assert.equal(game.counts.sync, 0); assert.equal(game.counts.writes, 2, 'only explicit presentation preference writes');
  assert.equal(game.run('JSON.stringify({currentNpcLocations,npcs,npcVisibility})'), business);
});

test('3D keeps valid residents while excluding hidden, absent, invalid and legacy placeholder IDs', async () => {
  const game = host({ stored: '{"enabled":true}' });
  game.run("npcs.C={name:'C'}; npcs.D={name:'D'}; currentNpcLocations.C='cangjingge'; currentNpcLocations.D='cangjingge'; currentNpcLocations.Z='cangjingge'; currentNpcLocations.Q='cangjingge'; npcs.Q={name:'invalid'}; npcVisibility.B=false;");
  game.bridge.publishNpcs('cangjingge', ['B', 'Z', 'Q']); game.bridge.start(); await drain();
  const state = game.bridge.getDiagnostics().snapshot;
  assert.deepEqual(Array.from(state.renderedNpcs, n => n.gameNpcId), ['A', 'C', 'D']);
  assert.equal(state.rosterError, false); assert.equal(state.visible, true); assert.equal(state.sceneId, 'library');
  assert.equal(state.locationNpcCounts.cangjingge, 6, '2D dot count does not filter visibility or IDs');
  assert.equal(game.counts.rng, 0); assert.equal(game.counts.sync, 0);
});

test('headcounts match the original 2D helper for 0/1/4/15/16 across main, mode, and visibility notifications', async () => {
  const game = host();
  const legacyCounts = () => {
    game.run(helpersSource.slice(helpersSource.indexOf('function updateLocationHeadcountLabels()'), helpersSource.indexOf('// 暴露到全局（供页面中其他脚本调用）')));
    game.run('updateLocationHeadcountLabels()');
    return Object.fromEntries([...game.elements].filter(([, el]) => el.people).map(([id, el]) => [id, el.people.children.length]));
  };
  for (const id of ['yanwuchang','cangjingge','huofang','houshan','yishiting','tiejiangpu','nandizi','nvdizi','shanmen','gongtian','danfang']) {
    const el = game.document.createElement('div'), people = game.document.createElement('div'), divider = game.document.createElement('div');
    Object.defineProperty(people, 'innerHTML', { set() { this.children = []; } });
    el.people = people; el.querySelector = selector => selector === '.location-people' ? people : divider; game.elements.set(id, el);
  }
  game.elements.get('cangjingge-scene').classes.delete('active'); game.elements.get('map-scene').classes.add('active');
  game.run("userLocation='tianshanpai'; currentNpcLocations={}"); game.bridge.start(); await drain();
  let revision = game.bridge.getDiagnostics().revision;
  for (const count of [0, 1, 4, 15, 16]) {
    game.run(`currentNpcLocations={}; for (const id of 'ABCDEFGHIJKLMNOZ'.slice(0,${count})) currentNpcLocations[id]='cangjingge'; npcVisibility.A=false;`);
    game.bridge.notify('count-change'); await drain();
    const state = game.bridge.getDiagnostics().snapshot;
    assert.equal(state.residents.length, 0); assert.equal(state.locationNpcCounts.cangjingge, count);
    assert.deepEqual(JSON.parse(JSON.stringify(state.locationNpcCounts)), legacyCounts());
    if (count) assert.ok(state.revision > revision, 'headcount-only change advances version');
    revision = state.revision;
  }
  game.run('GameMode=1'); game.document.hidden = true; game.bridge.notify('mode-hidden'); await drain();
  assert.equal(game.bridge.getDiagnostics().snapshot.locationNpcCounts.cangjingge, 16);
  game.run("currentNpcLocations.A='none'; currentNpcLocations.Z='shanmen'"); game.bridge.notify('settlement'); await drain();
  assert.deepEqual(JSON.parse(JSON.stringify(game.bridge.getDiagnostics().snapshot.locationNpcCounts)), legacyCounts());
  assert.equal(game.bridge.getDiagnostics().snapshot.locationNpcCounts.cangjingge, 14);
  assert.equal(game.bridge.getDiagnostics().snapshot.locationNpcCounts.shanmen, 1);
  assert.equal(game.counts.rng, 0); assert.equal(game.counts.sync, 0); assert.equal(game.counts.writes, 0);
});

// Eventful DOM harness for host-owned popups. Unlike the projection-only host
// above, mutations are delivered automatically and detached nodes lose ownership
// ancestry. Renderer injection only skips asset/WebGL loading, not bridge logic.
function menuHost(t, bridgeSource = source) {
  const elements = new Map(), observers = new Set(), timers = new Map(), documentListeners = new Map(), dispatches = [];
  let timerId = 0;
  function mutation(target, attributeName = null) {
    for (const observer of observers) {
      if (!observer.target?.contains(target)) continue;
      if (attributeName && !observer.options.attributeFilter.includes(attributeName)) continue;
      observer.records.push({ target, attributeName, type: attributeName ? 'attributes' : 'childList' });
      if (!observer.queued) {
        observer.queued = true;
        queueMicrotask(() => { observer.queued = false; const records = observer.records.splice(0); if (records.length) observer.callback(records); });
      }
    }
  }
  class Element {
    constructor(id = '') {
      this.id = id; this.parentNode = null; this.children = []; this.dataset = {}; this.classes = new Set(); this.attributes = {};
      this.clientWidth = 500; this.clientHeight = 300; this._hidden = false; this.listeners = new Map();
      this.classList = {
        add: (...names) => { names.forEach(name => this.classes.add(name)); mutation(this, 'class'); },
        remove: (...names) => { names.forEach(name => this.classes.delete(name)); mutation(this, 'class'); },
        contains: name => this.classes.has(name),
      };
      this.style = new Proxy({ setProperty: (name, value) => { this.style[name] = value; } }, {
        set: (object, name, value) => { object[name] = value; mutation(this, 'style'); return true; },
      });
    }
    get hidden() { return this._hidden; }
    set hidden(value) { if (this._hidden !== Boolean(value)) { this._hidden = Boolean(value); mutation(this, 'hidden'); } }
    get className() { return [...this.classes].join(' '); }
    set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); mutation(this, 'class'); }
    get isConnected() { return this === document.body || this === document.head || Boolean(this.parentNode?.isConnected); }
    get firstChild() { return this.children[0]; }
    get firstElementChild() { return this.children[0]; }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } mutation(this); }
    remove() { if (this.parentNode) { const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1); this.parentNode = null; mutation(parent); } }
    contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
    closest(selector) { if (selector === '[data-scene3d-owned]') for (let node = this; node; node = node.parentNode) if (node.dataset?.scene3dOwned) return node; return null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; if (name === 'data-scene3d-ready') delete this.dataset.scene3dReady; }
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
    getBoundingClientRect() { return { left: 10, top: 20, width: 500, height: 300, right: 510, bottom: 320 }; }
    getClientRects() { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; }
  }
  const document = {
    baseURI: 'http://localhost/index.html', hidden: false, body: new Element(), head: new Element(),
    createElement: () => new Element(), createTextNode: textContent => ({ textContent }), getElementById: id => elements.get(id),
    addEventListener(type, listener) { if (!documentListeners.has(type)) documentListeners.set(type, new Set()); documentListeners.get(type).add(listener); },
    removeEventListener(type, listener) { documentListeners.get(type)?.delete(listener); },
    dispatch(type, event) { dispatches.push(type); for (const listener of [...(documentListeners.get(type) || [])]) listener(event); },
    querySelector(selector) { if (selector === '.viewport') return elements.get('main-viewport'); return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      if (selector === '#main-viewport > .scene.active') return [...elements.values()].filter(element => element.classes.has('active'));
      if (selector === '#main-viewport > .scene') return [...elements.values()].filter(element => element.id.endsWith('-scene'));
      const descendants = node => (node.children || []).flatMap(child => [child, ...descendants(child)]);
      if (selector.startsWith('.modal,')) return descendants(this.body).filter(element => element.classes &&
        (element.classes.has('npc-selection-overlay') || element.classes.has('modal') || element.classes.has('location-info-popup') && element.classes.has('show')));
      return [];
    },
  };
  for (const id of ['main-viewport', 'sect-3d-root', 'map-scene', 'cangjingge-scene', 'player-stats-scene', 'location-info-popup', 'outside-control']) elements.set(id, new Element(id));
  document.body.append(elements.get('main-viewport'), elements.get('location-info-popup'), elements.get('outside-control'));
  elements.get('main-viewport').append(elements.get('sect-3d-root'), elements.get('map-scene'), elements.get('cangjingge-scene'), elements.get('player-stats-scene'));
  elements.get('cangjingge-scene').classes.add('active'); elements.get('location-info-popup').classes.add('location-info-popup');
  const renderer = {
    interactionEnabled: false, renderEnabled: false, clears: 0,
    setVisible(value) { this.visible = value; }, setRenderEnabled(value) { this.renderEnabled = value; }, setInteractionEnabled(value) { this.interactionEnabled = value; },
    clearSelection() { this.clears++; },
    async applyState(state) { return { status: 'applied', epoch: state.sessionEpoch, revision: state.revision, sceneId: state.sceneId }; },
  };
  const sandbox = {
    document, renderer, location: { protocol: 'http:' }, URL, queueMicrotask, innerWidth: 500, innerHeight: 300, console,
    localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: true }), addEventListener() {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.records = []; this.queued = false; observers.add(this); }
      observe(target, options) { this.target = target; this.options = options; }
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(`let GameMode=0, inputEnable=1, userLocation='cangjingge', currentNpcLocations={A:'cangjingge'}, npcs={A:{name:'甲',description:'测试人物'}}, npcVisibility={A:true}, npcGiftGiven={}, npcFavorability={A:0}, npcSparred={}, playerStats={金钱:1000}, locationNames={cangjingge:'藏经阁'}; function getNpcsAtLocation(){return []}`, context);
  vm.runInContext(legacyLocationPopup, context);
  const marker = '    window.GameSceneBridge =';
  assert.ok(bridgeSource.includes(marker));
  vm.runInContext(bridgeSource.replace(marker, '    window.__menuTest = { install() { view = renderer; preferences.enabled = true; }, emit: onEvent };\n' + marker), context);
  const bridge = sandbox.GameSceneBridge;
  bridge.start(); sandbox.__menuTest.install(); bridge.publishNpcs('cangjingge', ['A']);
  t.after(() => { observers.clear(); timers.clear(); documentListeners.clear(); });
  return {
    bridge, renderer, document, elements, dispatches,
    emit: event => sandbox.__menuTest.emit(event),
    run: code => vm.runInContext(code, context),
    flushTimers(ms) { for (const [id, timer] of [...timers]) if (timer.ms <= ms) { timers.delete(id); timer.fn(); } },
    openLocation() { bridge.showLocationInfoAtAnchor('cangjingge', { left: 150, top: 100, width: 20, height: 20 }); return elements.get('location-info-popup'); },
    openNpc() { bridge.showNpcInfoAtAnchor('A', 'cangjingge', { left: 200, top: 100, width: 40, height: 87 }); return elements.get('main-viewport').children.find(node => node.dataset.scene3dOwned === 'menu'); },
  };
}
for (const change of ['none', 'moved', 'hidden']) test(`fourth resident native intent/action is live-validated: ${change}`, async t => {
  const game = menuHost(t);
  game.run("for (const id of 'BCD') { npcs[id]={name:id,description:'resident'}; currentNpcLocations[id]='cangjingge'; npcVisibility[id]=true; npcFavorability[id]=0; } var nativeActions=[]; function npcAction(id,verb){nativeActions.push([id,verb])}");
  game.bridge.publishNpcs('cangjingge', ['A','B','C']); await drain();
  const state = game.bridge.getDiagnostics().snapshot;
  assert.deepEqual(Array.from(state.renderedNpcs, n => n.gameNpcId), ['A','B','C','D']);
  game.emit({ type:'npcIntent', epoch:state.sessionEpoch, revision:state.revision, gameNpcId:'D', anchor:{left:200,top:100,width:40,height:87} });
  const menu = game.elements.get('main-viewport').children.find(node => node.dataset.scene3dOwned === 'menu');
  assert.ok(menu, 'unpublished fourth resident opens its native-action menu');
  await drain();
  if (change === 'moved') game.run("currentNpcLocations.D='shanmen'");
  if (change === 'hidden') game.run('npcVisibility.D=false');
  const action = menu.children[0].children[2].children.find(button => button.textContent === '互动');
  for (const listener of action.listeners.get('click')) listener({});
  assert.deepEqual(JSON.parse(game.run('JSON.stringify(nativeActions)')), change === 'none' ? [['D','互动']] : []);
  if (change !== 'none') {
    game.document.dispatch('pointerdown', {target:game.elements.get('outside-control')}); await drain();
    const now = game.bridge.getDiagnostics().snapshot;
    game.emit({type:'npcIntent',epoch:now.sessionEpoch,revision:now.revision,gameNpcId:'D'});
    assert.equal(game.elements.get('main-viewport').children.some(node => node.dataset.scene3dOwned === 'menu'), false);
  }
});

test('only owned 3D location hint says all residents; closing restores original 2D popup contract', async t => {
  const game = menuHost(t);
  game.run("getNpcsAtLocation=()=>[...'ABCD'].map(name=>({name}));"); await drain();
  const popup = game.openLocation(); await drain();
  assert.match(popup.innerHTML, /共4人，全部显示/); assert.doesNotMatch(popup.innerHTML, /随机显示3人/);
  game.document.dispatch('pointerdown', {target:game.elements.get('outside-control')}); await drain();
  assert.match(popup.innerHTML, /随机显示3人/);
  game.run("showLocationInfo('cangjingge',{currentTarget:document.getElementById('map-scene')})");
  assert.match(popup.innerHTML, /随机显示3人/); assert.equal(popup.dataset.scene3dOwned, undefined);
});

function assertMenuLock(game, expected) {
  const snapshot = game.bridge.getDiagnostics().snapshot;
  assert.equal(snapshot.blockReasons.includes('scene-menu'), expected, 'scene-menu lock');
  assert.equal(snapshot.interactive, !expected, 'snapshot input');
  assert.equal(game.renderer.interactionEnabled, !expected, 'renderer input');
  assert.equal(game.renderer.renderEnabled, true, 'menu locks input, not rendering');
}

test('legacy keyboard outside-click closure reconciles an owned location popup and resumes input', async t => {
  const game = menuHost(t); await drain(); assertMenuLock(game, false);
  const popup = game.openLocation(); await drain(); assertMenuLock(game, true);
  assert.equal(popup.dataset.scene3dOwned, 'menu');
  game.flushTimers(100); // Arm the REAL host closeLocationInfo document-click listener.
  game.document.dispatch('click', { target: game.elements.get('outside-control'), detail: 0 });
  assert.deepEqual(game.dispatches, ['click'], 'keyboard activation has no pointerdown bridge close');
  assert.equal(popup.classList.contains('show'), false, 'legacy handler, not bridge, hid it synchronously');
  assert.equal(popup.dataset.scene3dOwned, 'menu', 'bridge reconciliation has not run yet');
  await drain(); assertMenuLock(game, false);
  assert.equal(popup.dataset.scene3dOwned, undefined); assert.equal(game.renderer.clears, 1);
  game.flushTimers(150);
  game.openLocation(); await drain(); assertMenuLock(game, true);
});

for (const kind of ['location', 'npc']) test(`external ${kind} menu detachment automatically retires the stale lock`, async t => {
  const game = menuHost(t); await drain();
  const menu = kind === 'location' ? game.openLocation() : game.openNpc();
  await drain(); assertMenuLock(game, true); assert.equal(menu.isConnected, true);
  menu.remove(); // Parent childList observation must be sufficient; no explicit notify.
  assert.equal(menu.isConnected, false);
  await drain(); assertMenuLock(game, false);
  assert.equal(menu.dataset.scene3dOwned, undefined); assert.equal(game.renderer.clears, 1);
});

test('owned menu hidden attribute retires lock but position styles do not schedule snapshots', async t => {
  const game = menuHost(t); await drain();
  const menu = game.openNpc(); await drain(); assertMenuLock(game, true);
  const before = game.bridge.getDiagnostics();
  menu.style.left = '180px'; menu.style.top = '90px'; menu.style.setProperty('--scene3d-ink-size', '178px');
  await drain();
  assert.equal(game.bridge.getDiagnostics().counters.notifications, before.counters.notifications, 'ignore per-frame positioning mutations');
  assert.equal(game.bridge.getDiagnostics().revision, before.revision);
  assertMenuLock(game, true);
  menu.hidden = true;
  await drain(); assertMenuLock(game, false);
  assert.equal(menu.isConnected, false, 'dynamic hidden menu is removed');
});

test('menu reconciliation clears only its lock and preserves an independent business lock', async t => {
  const game = menuHost(t); await drain();
  const menu = game.openNpc(); await drain(); assertMenuLock(game, true);
  game.run('inputEnable=0'); menu.hidden = true;
  await drain();
  const snapshot = game.bridge.getDiagnostics().snapshot;
  assert.equal(snapshot.blockReasons.includes('scene-menu'), false);
  assert.equal(snapshot.blockReasons.includes('business-input-disabled'), true);
  assert.equal(snapshot.interactive, false); assert.equal(game.renderer.interactionEnabled, false);
  assert.equal(game.renderer.renderEnabled, false);
  game.run('inputEnable=1'); game.bridge.notify('business-lock-released');
  await drain(); assertMenuLock(game, false);
});

for (const kind of ['location', 'npc']) test(`tab hide retires ${kind} menu; visibility resume has no stale menu or lock`, async t => {
  const game = menuHost(t); await drain();
  const menu = kind === 'location' ? game.openLocation() : game.openNpc();
  await drain(); assertMenuLock(game, true);
  game.document.hidden = true;
  game.document.dispatch('visibilitychange', {});
  await drain();
  const hidden = game.bridge.getDiagnostics().snapshot;
  assert.equal(hidden.visible, false); assert.equal(hidden.interactive, false);
  assert.equal(hidden.blockReasons.includes('scene-menu'), false);
  assert.equal(hidden.blockReasons.includes('hidden'), true);
  assert.equal(game.renderer.visible, false); assert.equal(game.renderer.interactionEnabled, false);
  assert.equal(menu.classList.contains('show'), false); assert.equal(menu.dataset.scene3dOwned, undefined);
  assert.equal(menu.isConnected, kind === 'location', 'shared popup retained, dynamic NPC menu removed');
  assert.equal(game.renderer.clears, 1);
  game.document.hidden = false;
  game.document.dispatch('visibilitychange', {});
  await drain(); assertMenuLock(game, false);
  assert.equal(game.renderer.visible, true);
  assert.equal(menu.classList.contains('show'), false, 'resume must not resurrect old menu');
  if (kind === 'npc') {
    const reopened = game.openNpc(); await drain(); assertMenuLock(game, true);
    assert.notEqual(reopened, menu, 'new NPC selection owns a fresh menu');
  } else {
    assert.equal(game.openLocation(), menu); await drain(); assertMenuLock(game, true);
  }
});

test('special-page activation retires shared location menu even when game location is unchanged', async t => {
  const game = menuHost(t);
  // Start directly on the map before the first scheduled apply, as a real
  // location-intent origin. Avoid involving the unrelated page-turn animation.
  game.elements.get('cangjingge-scene').classList.remove('active');
  game.elements.get('map-scene').classList.add('active');
  game.run("userLocation='tianshanpai'");
  await drain();
  const menu = game.openLocation(); await drain(); assertMenuLock(game, true);
  game.elements.get('map-scene').classList.remove('active');
  game.elements.get('player-stats-scene').classList.add('active');
  await drain();
  const special = game.bridge.getDiagnostics().snapshot;
  assert.equal(special.gameLocationId, 'tianshanpai');
  assert.equal(special.logicalPage, 'player-stats'); assert.equal(special.sceneId, null);
  assert.equal(special.visible, false); assert.equal(special.blockReasons.includes('scene-menu'), false);
  assert.equal(menu.isConnected, true); assert.equal(menu.classList.contains('show'), false);
  assert.equal(menu.dataset.scene3dOwned, undefined); assert.equal(game.renderer.interactionEnabled, false);
  game.elements.get('player-stats-scene').classList.remove('active');
  game.elements.get('map-scene').classList.add('active');
  await drain(); assertMenuLock(game, false);
  assert.equal(game.bridge.getDiagnostics().readyScene, 'main');
});

// GAL 演出翻页纸：playCurtain 不受 3D 偏好门控；未 start / 3D 换房中不播。
function curtainHost(stored) {
  const marker = '    window.GameSceneBridge =';
  assert.ok(source.includes(marker));
  const game = host({ stored, patch: src => src.replace(marker, '    window.__turnTest = { set(v) { turn = v; }, get() { return turn; } };\n' + marker) });
  game.pageTurn = () => game.elements.get('main-viewport').children.find(node => node.dataset.scene3dOwned === 'page') || null;
  return game;
}
test('playCurtain is exposed on the frozen boundary and resolves inertly before start', async () => {
  const game = curtainHost('{"enabled":false}');
  assert.equal(typeof game.bridge.playCurtain, 'function');
  assert.equal(typeof game.bridge.hasPendingApply, 'function');
  assert.equal(Object.isFrozen(game.bridge), true);
  await game.bridge.playCurtain(true, '第一回', '08:00 · 藏经阁', '话本');
  assert.equal(game.pageTurn(), null, 'no viewport yet → no sheet DOM');
});
test('playCurtain builds the sheet with GAL seal even when 3D preference is disabled; playPageTurn stays gated', async () => {
  const game = curtainHost('{"enabled":false}');
  game.bridge.start(); await drain();
  assert.equal(game.bridge.getDiagnostics().preferences.enabled, false);
  await game.bridge.playCurtain(true, '第一回', '08:00 · 藏经阁', '话本');
  const page = game.pageTurn();
  assert.ok(page, 'sheet created despite enabled=false');
  assert.equal(page.hidden, false);
  const [seal, title, detail] = page.children[0].children;
  assert.equal(seal.textContent, '话本'); assert.equal(title.textContent, '第一回'); assert.equal(detail.textContent, '08:00 · 藏经阁');
  await game.bridge.playCurtain(false);
  assert.equal(page.hidden, true, 'reveal hides the sheet again');
  // 默认 seal → 话本；再次 cover 复用同一张纸
  await game.bridge.playCurtain(true, '收卷');
  assert.equal(game.pageTurn(), page); assert.equal(seal.textContent, '话本'); assert.equal(title.textContent, '收卷'); assert.equal(detail.textContent, '');
  await game.bridge.playCurtain(false);
  assert.equal(game.elements.get('main-viewport').children.filter(node => node.dataset.scene3dOwned === 'page').length, 1);
});
test('playCurtain yields to an in-flight 3D room turn: no DOM, immediate resolve; hasPendingApply reflects it', async () => {
  const game = curtainHost('{"enabled":false}');
  game.bridge.start(); await drain();
  assert.equal(game.bridge.hasPendingApply(), false);
  game.run('window.__turnTest.set({ phase: "covering", covered: null })');
  assert.equal(game.bridge.hasPendingApply(), true);
  let settled = false;
  const p = game.bridge.playCurtain(true, '第二回', '', '话本').then(() => { settled = true; });
  await p;
  assert.equal(settled, true);
  assert.equal(game.pageTurn(), null, 'turn 非空时不建翻页纸');
  game.run('window.__turnTest.set(null)');
  assert.equal(game.bridge.hasPendingApply(), false);
  await game.bridge.playCurtain(true, '第二回', '', '话本');
  assert.ok(game.pageTurn());
});
