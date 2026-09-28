// GAL 演出单测公共沙箱：加载真实 game-config.js + game-utils.js（匹配函数与花名册），
// 再从 game-ui.js 按切片标记切出 GalParser / galPresentation 块（或 Phase 0 时的旧 parseSlgMainText）。
// 全部走 vm.createContext，不碰真实 DOM；DOM 只在需要 renderLayers 的测试里用 fakeDom() 造最小假对象。
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
export const read = rel => readFile(new URL(rel, root), 'utf8');
export const readFixture = name => read(`tests/gal/fixtures/${name}`);

const [configSource, utilsSource, uiSource, eventsSource] = await Promise.all([
  read('module/game-config.js'), read('module/game-utils.js'), read('module/game-ui.js'), read('module/game-events.js'),
]);

const PARSER_BEGIN = '// ==== GAL_PARSER_BEGIN ====', PARSER_END = '// ==== GAL_PARSER_END ====';
const PRES_BEGIN = '// ==== GAL_PRESENTATION_BEGIN ====', PRES_END = '// ==== GAL_PRESENTATION_END ====';
const TIME_BEGIN = '// ==== GAL_TIME_BEGIN ====', TIME_END = '// ==== GAL_TIME_END ====';

function slice(source, begin, end) {
  const a = source.indexOf(begin), b = source.indexOf(end);
  if (a < 0 || b < 0 || b <= a) throw new Error(`slice markers not found: ${begin} .. ${end}`);
  return source.slice(a, b);
}

// 解析器切片：Phase 1 之后取 GAL_PARSER 块；之前退化为旧 parseSlgMainText 函数体（Phase 0 基线用）。
export function parserSlice() {
  if (uiSource.includes(PARSER_BEGIN)) return slice(uiSource, PARSER_BEGIN, PARSER_END);
  return slice(uiSource, 'function parseSlgMainText(mainText)', '// 更新日期显示');
}
export function presentationSlice() { return slice(uiSource, PRES_BEGIN, PRES_END); }
// 时间源切片（game-events.js）：resolveTurnTime / applyTurnTime
export function timeSlice() { return slice(eventsSource, TIME_BEGIN, TIME_END); }
export const uiHasParserBlock = () => uiSource.includes(PARSER_BEGIN);

/** 最小 DOM 假对象，够 renderLayers/mask/body.classList 用。 */
export function fakeDom() {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.dataset = {}; this.style = {};
      this.attributes = {}; this.listeners = {}; this.classes = new Set(); this.textContent = ''; this.innerHTML = '';
      this.classList = {
        add: (...n) => n.forEach(x => this.classes.add(x)), remove: (...n) => n.forEach(x => this.classes.delete(x)),
        contains: n => this.classes.has(n), toggle: (n, f) => { (f ?? !this.classes.has(n)) ? this.classes.add(n) : this.classes.delete(n); },
      };
    }
    get className() { return [...this.classes].join(' '); }
    set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get firstChild() { return this.children[0] || null; }
    get childNodes() { return this.children; }
    appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.children.push(n); return n; }
    append(...ns) { ns.forEach(n => this.appendChild(n)); }
    insertBefore(n, ref) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; const i = this.children.indexOf(ref); i < 0 ? this.children.push(n) : this.children.splice(i, 0, n); return n; }
    removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) { this.children.splice(i, 1); n.parentNode = null; } return n; }
    remove() { this.parentNode?.removeChild(this); }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; if (k === 'id') this.id = v; }
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
    dispatch(t, ev = {}) { ev.target ||= this; ev.currentTarget = this; ev.stopPropagation ||= () => {}; ev.preventDefault ||= () => {}; (this.listeners[t] || []).forEach(fn => fn.call(this, ev)); if (typeof this['on' + t] === 'function') this['on' + t].call(this, ev); }
    closest() { return null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 }; }
    matches(sel) { return matchSel(this, sel); }
    querySelectorAll(sel) { const out = []; const walk = n => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  // 支持 .a.b / tag / #id / 逗号并列 / 简单后代 "A B"
  function matchSel(el, sel) {
    return sel.split(',').some(part => {
      const chain = part.trim().split(/\s+/);
      const self = chain[chain.length - 1];
      if (!matchSimple(el, self)) return false;
      let anc = el.parentNode;
      for (let i = chain.length - 2; i >= 0; i--) { while (anc && !matchSimple(anc, chain[i])) anc = anc.parentNode; if (!anc) return false; anc = anc.parentNode; }
      return true;
    });
  }
  function matchSimple(el, s) {
    if (s === '*') return true;
    const m = s.match(/^([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)$/);
    if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && el.id !== m[2].slice(1)) return false;
    if (m[3]) for (const c of m[3].split('.').filter(Boolean)) if (!el.classes.has(c)) return false;
    return true;
  }
  const body = new Element('body');
  const viewport = new Element('div'); viewport.id = 'main-viewport'; body.appendChild(viewport);
  const document = {
    body, baseURI: 'http://127.0.0.1:1234/index.html',
    createElement: tag => new Element(tag),
    getElementById: id => body.querySelector('#' + id),
    querySelector: sel => body.querySelector(sel),
    querySelectorAll: sel => body.querySelectorAll(sel),
    addEventListener() {}, removeEventListener() {},
  };
  return { Element, document, body, viewport };
}

/**
 * 建沙箱：真实 config/utils + 预声明的可写全局。
 * @param {object} globals 需要 `let` 预声明的全局（GameMode/companionNPC/...），值会 JSON 序列化注入
 * @param {object} extra 直接挂到沙箱对象上的东西（document、GameSceneBridge 假件等）
 */
export function makeSandbox(globals = {}, extra = {}) {
  const logs = [];
  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) },
    location: { protocol: 'http:' }, URL, setTimeout, clearTimeout, queueMicrotask, Promise,
    ...extra,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(configSource, context);
  vm.runInContext(utilsSource, context);
  const defaults = { GameMode: 1, companionNPC: [], seasonStatus: 'spring', dayNightStatus: 'daytime', enamor: 0, cgContentEnabled: true, randIdx: 0, newWeek: 0, isStoryExpanded: false, currentPage: 0, slgModeData: [], storyPages: [], currentGameTime: '08:00' };
  const merged = { ...defaults, ...globals };
  const decl = Object.entries(merged).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
  vm.runInContext(`let ${decl};`, context);
  return { context, sandbox, logs, run: code => vm.runInContext(code, context), get: name => vm.runInContext(name, context) };
}

/** 沙箱对象与宿主 Array/Object 原型不同，deepEqual 前先做 JSON 往返归一。 */
export const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

/** 装载解析器切片，返回 parseSlgMainText 可调用句柄。 */
export function loadParser(globals, extra) {
  const box = makeSandbox(globals, extra);
  box.run(parserSlice());
  box.parse = text => plain(box.run('parseSlgMainText')(text));
  return box;
}

/** 装载解析器 + 时间源切片，附带 GameSceneBridge.captureTime 记录与 updateSceneBackgrounds 计数。 */
export function loadTime(globals, extra = {}) {
  const captured = [];
  let bgCalls = 0;
  const box = makeSandbox(globals, {
    GameSceneBridge: { captureTime: t => captured.push(t) },
    updateSceneBackgrounds: () => { bgCalls++; },
    ...extra,
  });
  box.run(parserSlice());
  box.run(timeSlice());
  box.captured = captured;
  box.bgCalls = () => bgCalls;
  // 模拟 parseLLMResponse 开头的时间段：正文 + SIDE_NOTE → 应用
  box.applyFrom = (mainText, sideNote = null) => {
    const frames = mainText ? box.run('parseSlgMainText')(mainText) : [];
    const resolved = box.run('resolveTurnTime')(frames, sideNote);
    return { resolved: plain(resolved), applied: box.run('applyTurnTime')(resolved) };
  };
  return box;
}

export const pick = frames => frames.map(f => ({ text: f.text, npc: f.npc, scene: f.scene, emotion: f.emotion, cg: f.cg }));

/**
 * 装载解析器 + 演出控制器切片，附 fakeDom 与假 GameSceneBridge（记录 setBusy / playCurtain，hasPendingApply 可控）。
 * 返回 box 附加：dom、bridgeCalls、pres()（取沙箱内 galPresentation）、layers()、masks()。
 */
export function loadPresentation(globals = {}, extra = {}) {
  const dom = fakeDom();
  const bridgeCalls = { busy: [], curtain: [] };
  const bridgeState = { pending: false, playable: true };
  const GameSceneBridge = {
    setBusy: (token, on) => bridgeCalls.busy.push([token, on]),
    hasPendingApply: () => bridgeState.pending,
    playCurtain: (cover, label, detail, seal) => {
      if (!bridgeState.playable) return Promise.resolve();
      bridgeCalls.curtain.push({ cover, label, detail, seal });
      return Promise.resolve();
    },
    captureTime() {},
  };
  const box = makeSandbox(globals, { document: dom.document, GameSceneBridge, ...extra });
  box.run(parserSlice());
  box.run(presentationSlice());
  box.dom = dom;
  box.bridgeCalls = bridgeCalls;
  box.bridgeState = bridgeState;
  box.pres = () => box.get('galPresentation');
  box.layers = () => dom.viewport.querySelectorAll('.slg-layer-container');
  box.masks = () => dom.viewport.querySelectorAll('.slg-interaction-mask');
  box.emotionLayers = () => dom.viewport.querySelectorAll('.slg-emotion-layer');
  // slgModeData 是沙箱内 let 绑定，只能通过沙箱代码赋值
  box.setFrames = text => { const frames = box.run('parseSlgMainText')(text); box.sandbox.__frames = frames; box.run('slgModeData = __frames;'); return frames; };
  box.set = (name, value) => { box.sandbox.__v = value; box.run(`${name} = __v;`); };
  return box;
}
