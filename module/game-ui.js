/**
 * game-ui.js - UI更新和显示函数
 * 
 * 文件概述：
 * 负责所有用户界面的更新和显示逻辑，包括状态栏、属性面板、关系界面等。
 * 处理弹窗显示、文本渲染和动态内容更新。
 * 
 * 主要功能：
 * 1. 更新各种显示元素（日期、体力、行动点、属性等）
 * 2. 管理弹窗和提示框
 * 3. 处理Markdown文本渲染
 * 4. 管理悬浮提示框
 * 
 * 对外暴露的主要函数：
 * - updateDateDisplay(): 更新日期显示（年/月/周）
 * - updateMoodDisplay(): 更新体力值显示
 * - updateActionPointsDisplay(): 更新行动点显示并控制按钮状态
 * - updateAllDisplays(): 一次性更新所有显示内容
 * - updateStatsDisplay(): 更新角色属性面板（天赋、数值、战斗属性等）
 * - updateRelationshipsDisplay(): 更新人际关系界面
 * - updateStoryText(text): 使用Markdown渲染并更新故事文本
 * - updateStoryDisplay(): 刷新故事区域（分页/展开、页码指示、SLG图层）
 * - doGoToPage(pageNum) / doPrevPage() / doNextPage(): 文本翻页
 * - doToggleStoryExpand(): 展开/收起全文
 * - showModal(text): 显示普通弹窗
 * - showConfirmModal(title, message, onConfirm): 显示确认弹窗
 * - showTooltip(event, text): 显示悬浮提示框
 * - hideTooltip(): 隐藏悬浮提示框
 * - fitModalToViewport(modal) / bindModalAutoFit(modal): 弹窗适配当前视口
 * - closeAllSpecialModals(): 一键关闭背包/装备/难度/金手指/交易等弹窗
 * - updateEquipmentSlot(slotId, itemName): 刷新装备槽UI
 * - showItemDetail(itemName) / getItemEffectText(item) / closeItemDetailModal(): 道具详情
 * - updateSLGReturnButton(): 根据模式切换显示“返回天山派/跳过一周”
 * 
 * 依赖关系：
 * - 依赖 game-state.js 中的状态变量
 * - 依赖 game-config.js 中的配置数据
 * - 依赖 game-utils.js 中的计算函数
 * - 依赖外部库 markdown-it 进行文本渲染
 */

// 在文件开头添加翻页相关的状态变量
let storyPages = [];  // 存储分页后的文本
let currentPage = 0;  // 当前页码
let isStoryExpanded = false;  // 是否展开显示全文
let slgModeData = [];  // 新增：存储SLG模式的数据

// ==== GAL_PARSER_BEGIN ====
// GAL 解析层：把 MAIN_TEXT 按行解析为演出帧 frames[]，新旧两种段尾格式同一入口。
//   旧五元组：正文|NPC|场景|表情|CG                 → legacy=true, time=null, cast≤1
//   新格式：  正文|场景|HH:MM|NPC:表情;NPC:表情|NSFW → legacy=false, cast≤2（首个为焦点）
// 判定只看第 3 段是否形如 HH:MM。纯函数：不读 DOM、不写全局，所有匹配/白名单能力经 ctx 注入，
// 便于在 node 沙箱按 GAL_PARSER_BEGIN/END 切片单测（见 tests/gal/）。
const GalParser = (() => {
    const cleanToken = (str) => (str || '').replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]/g, '').trim();
    const normalizeNone = (str) => {
        const cleaned = cleanToken(str);
        if (!cleaned) return 'none';
        if (cleaned === '无') return 'none';
        if (cleaned.toLowerCase && cleaned.toLowerCase() === 'none') return 'none';
        return cleaned;
    };
    const TIME_RE = /^(\d{1,2})[:：](\d{2})$/;
    // 第 3 段形如 HH:MM 即视为新格式；越界（25:00）仍算新格式但 time=null
    const parseTime = (raw) => {
        const m = TIME_RE.exec((raw || '').trim());
        if (!m) return undefined;
        const h = +m[1], mi = +m[2];
        if (h > 23 || mi > 59) return null;
        return String(h).padStart(2, '0') + ':' + m[2];
    };
    const normalizeEmotion = (emo, ctx) => {
        if (emo === 'none') return 'none';
        if (/^特殊CG\d+$/.test(emo)) return emo;
        return ctx.matchEmotion ? ctx.matchEmotion(emo) : emo;
    };
    const normalizeCG = (cg, ctx) => (cg === 'none' ? 'none' : (ctx.matchCG ? ctx.matchCG(cg) : cg));

    // GameMode 0 严格白名单：精确名 / 精确 ID / 全名被 token 包含且长度 ≤ 名字+2（容“雨烛姑娘”“破阵子长老”），不走相似度
    const strictMatchNpc = (token, roster) => {
        if (!token || token === 'none') return 'none';
        for (const n of roster) if (token === n.name || token === n.id) return n.name;
        for (const n of roster) if (token.includes(n.name) && token.length <= n.name.length + 2) return n.name;
        return null;
    };
    // 统一的 NPC 归一 + 准入：返回标准名，或 null 表示该 NPC 不合法（GM1：非随行；GM0：不在花名册）
    const resolveNpc = (raw, ctx) => {
        if (raw === 'none') return 'none';
        if (ctx.gameMode === 0) return strictMatchNpc(raw, ctx.roster || []);
        const normalized = ctx.matchNpc ? ctx.matchNpc(raw) : raw;
        return (ctx.isNpcAllowed ? ctx.isNpcAllowed(normalized) : true) ? normalized : null;
    };
    // GameMode 0 场景不做模糊匹配，原样保留（渲染层按门派地点精确回退）；GameMode 1 沿用 matchScene
    const resolveScene = (raw, ctx) => {
        if (raw === 'none') return 'none';
        if (ctx.gameMode === 0) return raw;
        return ctx.matchScene ? ctx.matchScene(raw) : raw;
    };
    // 新格式第 4 段：NPC:表情;NPC:表情 → cast（去重、最多 2 个、丢弃非法者）
    const parseCast = (raw, ctx, dropped) => {
        const cleaned = cleanToken(raw);
        if (!cleaned || cleaned === '无' || cleaned.toLowerCase() === 'none') return { cast: [], requested: 0 };
        const items = (raw || '').split(/[;；]/).map(s => s.trim()).filter(Boolean);
        const cast = [];
        const seen = new Set();
        for (const item of items) {
            const [npcTok, emoTok] = item.split(/[:：]/);
            const npcRaw = normalizeNone(npcTok);
            if (npcRaw === 'none') continue;
            const name = resolveNpc(npcRaw, ctx);
            if (!name || name === 'none') { dropped.push(npcRaw); continue; }
            if (seen.has(name)) continue;
            seen.add(name);
            cast.push({ npc: name, emotion: normalizeEmotion(normalizeNone(emoTok), ctx) });
            if (cast.length >= 2) break;
        }
        return { cast, requested: items.length };
    };

    const makeFrame = (text, display) => ({
        text,
        scene: display.scene,
        time: display.time,
        cast: display.cast.map(c => ({ npc: c.npc, emotion: c.emotion })),
        cg: display.cg,
        legacy: display.legacy,
        npc: display.npc,
        emotion: display.emotion
    });

    /**
     * @param {string} mainText MAIN_TEXT 原文（可为流式未完文本）
     * @param {object} ctx { gameMode, roster:[{id,name}], matchNpc, isNpcAllowed, matchScene, matchEmotion, matchCG, log }
     * @returns {Array} frames；末尾无标记残文作为最后一帧（tail=true），沿用上一有效展示配置
     */
    function parseFrames(mainText, ctx) {
        if (!mainText || typeof mainText !== 'string') return [];
        ctx = ctx || {};
        const log = typeof ctx.log === 'function' ? ctx.log : () => {};
        const lines = mainText.trim().split('\n');
        const result = [];
        let currentTextBlock = [];
        let lastValidDisplay = null;

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            if (!rawLine || !rawLine.trim()) continue;
            const parts = rawLine.split('|');
            // 需要恰好 5 段才是标记行，否则累积为纯正文
            if (parts.length !== 5) {
                const textOnly = (parts[0] || rawLine).trim();
                if (textOnly) currentTextBlock.push(textOnly);
                continue;
            }
            const textPart = (parts[0] || '').trim();
            const time = parseTime(parts[2]);
            let display;
            let accept;
            if (time === undefined) {
                // 旧五元组：正文|NPC|场景|表情|CG
                const npcRaw = normalizeNone(parts[1]);
                const sceneRaw = normalizeNone(parts[2]);
                const emotionRaw = normalizeNone(parts[3]);
                const cgRaw = normalizeNone(parts[4]);
                const npc = resolveNpc(npcRaw, ctx);
                const scene = resolveScene(sceneRaw, ctx);
                const emotion = normalizeEmotion(emotionRaw, ctx);
                const cg = normalizeCG(cgRaw, ctx);
                const npcOk = npc !== null;
                if (!npcOk && ctx.gameMode === 0) log(`[GalParser] 丢弃非花名册 NPC: "${npcRaw}"`);
                const finalNpc = npcOk ? npc : 'none';
                display = {
                    scene, time: null, cg, legacy: true,
                    cast: finalNpc !== 'none' ? [{ npc: finalNpc, emotion }] : [],
                    npc: finalNpc, emotion
                };
                // GM1 沿用原规则：NPC 非随行或场景 none → 整帧拒收，文本并入下一帧；GM0 一律接受
                accept = ctx.gameMode === 0 ? true : (npcOk && scene !== 'none');
            } else {
                // 新格式：正文|场景|HH:MM|NPC:表情;NPC:表情|NSFW
                const sceneRaw = normalizeNone(parts[1]);
                const cgRaw = normalizeNone(parts[4]);
                const scene = resolveScene(sceneRaw, ctx);
                const cg = normalizeCG(cgRaw, ctx);
                const dropped = [];
                const { cast, requested } = parseCast(parts[3], ctx, dropped);
                if (dropped.length) log(`[GalParser] 丢弃不合法 NPC: ${dropped.map(d => `"${d}"`).join(', ')}`);
                const focus = cast[0];
                display = {
                    scene, time, cg, legacy: false, cast,
                    npc: focus ? focus.npc : 'none',
                    emotion: focus ? focus.emotion : 'none'
                };
                // GM1：写了 NPC 却一个都不合法、或场景 none → 拒收（与旧规则同构）；GM0 一律接受
                accept = ctx.gameMode === 0 ? true : (!(requested > 0 && cast.length === 0) && scene !== 'none');
            }

            if (!accept) {
                if (textPart) currentTextBlock.push(textPart);
                continue;
            }
            let mergedText = textPart;
            if (currentTextBlock.length > 0) {
                mergedText = currentTextBlock.join('\n\n') + (textPart ? '\n\n' + textPart : '');
                currentTextBlock = [];
            }
            result.push(makeFrame(mergedText, display));
            lastValidDisplay = display;
        }

        // 末尾残留：用上一次有效展示配置兜底，否则全 none
        if (currentTextBlock.length > 0) {
            const tailText = currentTextBlock.join('\n\n');
            const frame = makeFrame(tailText, lastValidDisplay || { scene: 'none', time: null, cast: [], cg: 'none', legacy: true, npc: 'none', emotion: 'none' });
            frame.tail = true;
            result.push(frame);
        }
        return result;
    }

    /** 末帧有效时间 → 逆序前序帧 → null（时间源迁移用，见 game-events.js resolveTurnTime） */
    function lastTime(frames) {
        for (let i = (frames || []).length - 1; i >= 0; i--) {
            if (frames[i] && frames[i].time) return frames[i].time;
        }
        return null;
    }

    return Object.freeze({ parseFrames, lastTime, strictMatchNpc, parseTime });
})();

// 由宿主全局组装解析上下文：GameMode 1 白名单 = companionNPC；GameMode 0 白名单 = npcs 全花名册
function buildGalParseContext(mode) {
    const gameMode = (typeof mode === 'number') ? mode : ((typeof GameMode !== 'undefined' && GameMode === 1) ? 1 : 0);
    const table = (typeof npcs !== 'undefined' && npcs) ? npcs : {};
    const roster = Object.keys(table).map(id => ({ id, name: table[id] && table[id].name })).filter(n => n.name);
    const isNpcAllowed = (normalizedNpc) => {
        if (normalizedNpc === 'none') return true;
        const pool = new Set((typeof companionNPC !== 'undefined' && companionNPC) || []);
        if (pool.has(normalizedNpc)) return true;
        const id = (typeof npcNameToId !== 'undefined' && npcNameToId) ? npcNameToId[normalizedNpc] : undefined;
        if (id && (pool.has(id) || pool.has(table[id]?.name))) return true;
        if (table[normalizedNpc]?.name && pool.has(table[normalizedNpc].name)) return true;
        return false;
    };
    return {
        gameMode,
        roster,
        isNpcAllowed,
        matchNpc: (name) => (typeof matchNPC === 'function') ? matchNPC(name) : name,
        matchScene: (scene) => (typeof matchScene === 'function') ? matchScene(scene) : scene,
        matchEmotion: (emo) => (typeof matchEmotion === 'function') ? matchEmotion(emo) : emo,
        matchCG: (cg) => (typeof matchCG === 'function') ? matchCG(cg) : (((typeof slgCGOptions !== 'undefined') && slgCGOptions.includes(cg)) ? cg : 'none'),
        log: (...args) => console.log(...args)
    };
}

// 将 MAIN_TEXT 解析为 slgModeData（新旧格式、两种 GameMode 通用；支持流式未完文本）
function parseSlgMainText(mainText, mode) {
    return GalParser.parseFrames(mainText, buildGalParseContext(mode));
}
// ==== GAL_PARSER_END ====

// ==== GAL_PRESENTATION_BEGIN ====
// GAL 演出控制器：渲染 .slg-layer-container（场景/立绘/CG）+ .slg-interaction-mask，并管理 GameMode 0 的进出状态机。
// - GameMode 1：updateStoryDisplay 直接调 renderLayers/clearLayers（行为等同旧 _appendSlgLayers），不走状态机。
// - GameMode 0：enter/goto/exit/onCommit 按 SKILL G0-G13；演出层是业务层（.scene / #sect-3d-root）之上的纯覆盖，
//   不读业务状态、不触发 enamor、不写 __lastValid*，唯一副作用是 body.gal-presenting 与 GameSceneBridge.setBusy('gal')。
// 块内只引用参数、document/window 与 typeof 守卫过的全局，保证可在最小沙箱加载。
const galPresentation = (() => {
    const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    function cnNumber(n) {
        n = Math.max(1, Math.floor(Number(n) || 1));
        if (n < 10) return CN[n];
        if (n < 20) return '十' + (n % 10 ? CN[n % 10] : '');
        if (n < 100) return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : '');
        return String(n);
    }
    const has = v => typeof v !== 'undefined' && v !== null;
    const doc = () => (typeof document !== 'undefined') ? document : null;
    const bridge = () => (typeof window !== 'undefined' && window.GameSceneBridge) ? window.GameSceneBridge : null;
    const frames = () => (typeof slgModeData !== 'undefined' && Array.isArray(slgModeData)) ? slgModeData : [];
    const viewportEl = () => { const d = doc(); return d ? d.getElementById('main-viewport') : null; };
    const assetUrl = p => (typeof _assetUrl === 'function') ? _assetUrl(p) : p;
    const SEASON_CN = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

    let state = 'idle';
    let gen = 0;
    let index = 0;
    let enteredCommitId = null;
    let chain = Promise.resolve();

    function clearLayers(viewport) {
        if (!viewport) return;
        viewport.querySelectorAll('.slg-layer-container').forEach(el => el.remove());
        viewport.querySelectorAll('.slg-interaction-mask').forEach(el => el.remove());
    }

    // 场景图 URL：GameMode 1 沿用 SLG 路径 / legacySceneOptions 分支；GameMode 0 按 G6 只认门派地点，否则回退天山派四季图。
    function sceneUrlFor(frame, mode) {
        const dayNightCN = (typeof dayNightStatus !== 'undefined' && dayNightStatus === 'night') ? '夜' : '昼';
        const sceneName = frame && frame.scene;
        if (mode === 0) {
            const names = (typeof locationNames !== 'undefined' && locationNames)
                ? Object.keys(locationNames).filter(id => id !== 'none' && id !== 'tianshanpai').map(id => locationNames[id])
                : [];
            if (sceneName && sceneName !== 'none' && names.includes(sceneName)) {
                return assetUrl(`img/location/${sceneName}_${dayNightCN}.webp`);
            }
            const season = SEASON_CN[(typeof seasonStatus !== 'undefined') ? seasonStatus : ''] || '冬';
            return assetUrl(`img/location/天山派_${season}_${dayNightCN}.webp`);
        }
        if (!sceneName || sceneName === 'none') return null;
        const locName = (typeof mapLocation !== 'undefined' && mapLocation) || '天山派外堡';
        const isLegacyScene = (typeof legacySceneOptions !== 'undefined') && legacySceneOptions.includes(sceneName);
        return isLegacyScene
            ? assetUrl(`img/location/${sceneName}_${dayNightCN}.webp`)
            : assetUrl(`img/location/scene_webp/${locName}/${dayNightCN}/${sceneName}.webp`);
    }

    // 帧的立绘成员：优先 cast（≤2），兼容只有 npc/emotion 的旧消费者；过滤掉花名册外的名字。
    function castOf(frame) {
        const nameToId = (typeof npcNameToId !== 'undefined' && npcNameToId) ? npcNameToId : {};
        let list = Array.isArray(frame.cast) && frame.cast.length ? frame.cast : [];
        if (!list.length && frame.npc && frame.npc !== 'none') list = [{ npc: frame.npc, emotion: frame.emotion }];
        return list.filter(c => c && c.npc && c.npc !== 'none' && nameToId[c.npc]).slice(0, 2)
            .map(c => ({ npc: c.npc, id: nameToId[c.npc], emotion: (c.emotion && c.emotion !== 'none') ? c.emotion : '平静' }));
    }

    /**
     * 渲染一帧图层到 viewport（不清旧层，调用方决定何时 clearLayers）。
     * opts = { mask, allowEnamor, recordLastValid, mode, portraitFallback, onMaskClick }
     */
    function renderLayers(viewport, frame, opts) {
        const d = doc();
        if (!viewport || !frame || !d) return null;
        opts = opts || {};
        const mode = has(opts.mode) ? opts.mode : ((typeof GameMode !== 'undefined') ? GameMode : 1);

        if (opts.mask) {
            const mask = d.createElement('div');
            mask.className = 'slg-interaction-mask';
            if (typeof opts.onMaskClick === 'function') mask.addEventListener('click', opts.onMaskClick);
            viewport.appendChild(mask);
        }
        const container = d.createElement('div');
        container.className = 'slg-layer-container';
        container.dataset.galMode = String(mode);

        // 1) 场景图层
        const sceneUrl = sceneUrlFor(frame, mode);
        if (sceneUrl) {
            const sceneLayer = d.createElement('div');
            sceneLayer.className = 'slg-layer slg-scene-layer';
            const sceneImg = d.createElement('img');
            sceneImg.src = sceneUrl;
            sceneImg.alt = `${frame.scene || 'none'}`;
            if (opts.recordLastValid) { try { window.__lastValidSceneUrl = sceneUrl; } catch (e) {} }
            sceneLayer.appendChild(sceneImg);
            container.appendChild(sceneLayer);
        }

        // 2) NPC 表情图层：1 人居中；2 人 .slg-cast-left / .slg-cast-right（顺序 = cast 顺序，首个为焦点）
        const members = castOf(frame);
        members.forEach((m, i) => {
            const emotionLayer = d.createElement('div');
            emotionLayer.className = 'slg-layer slg-emotion-layer';
            if (members.length === 2) emotionLayer.classList.add(i === 0 ? 'slg-cast-left' : 'slg-cast-right');
            if (/^特殊CG\d+$/.test(m.emotion)) emotionLayer.classList.add('slg-emotion-special-cg');
            if (opts.allowEnamor && m.emotion === '发情' && typeof enamor !== 'undefined' && enamor === 0) enamor = 1;
            const emotionImg = d.createElement('img');
            const emoUrl = assetUrl(`img/表情差分和CG/${m.npc}/表情差分/${m.emotion}.webp`);
            emotionImg.src = emoUrl;
            emotionImg.alt = `${m.npc}-${m.emotion}`;
            if (opts.portraitFallback && typeof npcPortraits !== 'undefined' && npcPortraits && npcPortraits[m.id]) {
                const fallback = assetUrl(npcPortraits[m.id]);
                emotionImg.onerror = function () { this.onerror = null; this.src = fallback; };
            }
            if (i === 0 && opts.recordLastValid) { try { window.__lastValidNpcEmotionUrl = emoUrl; } catch (e) {} }
            emotionLayer.appendChild(emotionImg);
            container.appendChild(emotionLayer);
        });

        // 3) 特殊CG图层（按焦点 NPC）
        const focus = members[0];
        const cgEnabled = (typeof cgContentEnabled !== 'undefined') && cgContentEnabled;
        if (cgEnabled && frame.cg && frame.cg !== 'none' && focus) {
            const idx = (typeof randIdx !== 'undefined') ? randIdx : 1;
            const cgLayer = d.createElement('div');
            cgLayer.className = 'slg-layer slg-cg-layer';
            const cgImg = d.createElement('img');
            const cgUrl = assetUrl(`img/表情差分和CG/${focus.npc}/色图/${frame.cg}${idx}.webp`);
            cgImg.src = cgUrl;
            cgImg.alt = `${focus.npc}-${frame.cg}${idx}`;
            if (opts.recordLastValid) { try { window.__lastValidCgUrl = cgUrl; } catch (e) {} }
            cgLayer.appendChild(cgImg);
            container.appendChild(cgLayer);
        }

        viewport.appendChild(container);
        return container;
    }

    // ---------- GameMode 0 状态机 ----------
    function isPlaying() { return state === 'playing'; }
    function clamp(i) { const n = frames().length; return Math.max(0, Math.min(Math.floor(Number(i) || 0), Math.max(0, n - 1))); }
    function curtainDetail(frame) {
        return [frame && frame.time, frame && frame.scene && frame.scene !== 'none' ? frame.scene : ''].filter(Boolean).join(' · ');
    }
    function playCurtain(cover, label, detail) {
        const b = bridge();
        if (!b || typeof b.playCurtain !== 'function') { galLog('curtain skipped: no bridge', { cover }); return Promise.resolve(); }
        try { return Promise.resolve(b.playCurtain(cover, label, detail, '话本')); } catch (e) { galLog('curtain threw', e); return Promise.resolve(); }
    }
    // 演出诊断日志（统一前缀，便于在控制台按 [GAL] 过滤）
    function galLog(msg, extra) {
        try { console.log('[GAL] ' + msg, extra !== undefined ? extra : ''); } catch (e) {}
    }
    function setPresenting(on) {
        const d = doc();
        try { if (d && d.body) d.body.classList[on ? 'add' : 'remove']('gal-presenting'); } catch (e) {}
        const b = bridge();
        if (b && typeof b.setBusy === 'function') { try { b.setBusy('gal', on); } catch (e) {} }
    }
    // 把第 i 帧画到 viewport（恒带 mask，mask 点击 = 退出）
    function paint(i) {
        const list = frames();
        const vp = viewportEl();
        if (!vp || !list.length) return false;
        index = clamp(i);
        clearLayers(vp);
        renderLayers(vp, list[index], {
            mask: true, allowEnamor: false, recordLastValid: false, mode: 0, portraitFallback: true,
            onMaskClick: () => { exit({ reason: 'stage-click', curtain: true }); },
        });
        return true;
    }

    /** enter({ source, pageIndex, curtain }) → Promise<boolean>；已在演出中则等价 goto。 */
    function enter(opts) {
        opts = opts || {};
        const list = frames();
        if (!list.length) { galLog('enter ignored: no frames', { source: opts.source }); return Promise.resolve(false); }
        const target = clamp(has(opts.pageIndex) ? opts.pageIndex : 0);
        if (state === 'playing') { galLog('enter → goto (already playing)', { source: opts.source, target }); return Promise.resolve(goto(target)); }
        state = 'playing';
        index = target;
        const myGen = ++gen;
        setPresenting(true);
        const frame = list[target];
        const curtain = !!opts.curtain;
        const b = bridge();
        galLog('enter', { source: opts.source, target, frames: list.length, curtain, bridgeTurn: !!(b && typeof b.hasPendingApply === 'function' && b.hasPendingApply()) });
        const run = async () => {
            if (curtain) await playCurtain(true, `第${cnNumber(target + 1)}回`, curtainDetail(frame));
            if (gen !== myGen) {
                // 封面期间被 exit/reset 抢先：纸已盖上就必须揭开，否则纸页会永久盖在视窗上
                if (curtain) await playCurtain(false);
                galLog('enter aborted by newer op', { target });
                return false;
            }
            paint(index);
            if (curtain) await playCurtain(false);
            return gen === myGen;
        };
        chain = chain.then(run, run);
        return chain;
    }
    /** 演出中翻页：只换图层，不播翻页纸；同页幂等。 */
    function goto(i) {
        if (state !== 'playing') return false;
        const target = clamp(i);
        const vp = viewportEl();
        if (target === index && vp && vp.querySelector('.slg-layer-container')) return true;
        return paint(target);
    }
    /** exit({ reason, curtain }) → Promise<boolean>；幂等。curtain:false 时同步清层。 */
    function exit(opts) {
        opts = opts || {};
        if (state !== 'playing') return Promise.resolve(false);
        state = 'idle';
        const myGen = ++gen;
        const b = bridge();
        // G9/G12：3D 正在换房或有待应用的房间切换 → 不播自身翻页纸，由 3D 翻页兼作退场
        const pending3d = !!(b && typeof b.hasPendingApply === 'function' && b.hasPendingApply());
        const curtain = !!opts.curtain && !pending3d;
        galLog('exit', { reason: opts.reason, curtainRequested: !!opts.curtain, curtain, pending3d });
        if (!curtain) {
            clearLayers(viewportEl());
            setPresenting(false);
            return Promise.resolve(true);
        }
        const run = async () => {
            await playCurtain(true, '收卷', '');
            clearLayers(viewportEl());
            if (gen === myGen) setPresenting(false);
            await playCurtain(false);
            return true;
        };
        chain = chain.then(run, run);
        return chain;
    }
    /** commit 完成后的自动进入判定（G1/G4）：同一 commitId 只进一次。 */
    function onCommit(info) {
        const id = (info && has(info.commitId)) ? info.commitId : null;
        const mode = (typeof GameMode !== 'undefined') ? GameMode : 1;
        const expanded = (typeof isStoryExpanded !== 'undefined') && !!isStoryExpanded;
        const week = (typeof newWeek !== 'undefined') ? newWeek : 0;
        if (mode !== 0 || expanded || week === 1) { galLog('onCommit: not entering', { mode, expanded, week }); return false; }
        if (!frames().some(f => f && !f.tail)) { galLog('onCommit: no presentable frames'); return false; }
        if (id !== null && id === enteredCommitId) return false;
        enteredCommitId = id;
        enter({ source: 'commit', pageIndex: 0, curtain: true });
        return true;
    }
    /** GameMode 切换 / 存档恢复等硬重置：同步清层、清 commit 记忆。 */
    function reset() {
        exit({ reason: 'reset', curtain: false });
        enteredCommitId = null;
    }

    return Object.freeze({
        get state() { return state; },
        get index() { return index; },
        enter, goto, exit, onCommit, reset, isPlaying,
        renderLayers, clearLayers, sceneUrlFor, cnNumber,
    });
})();
// ==== GAL_PRESENTATION_END ====

// GameMode 1 图层参数：只在非人物/关系页加遮罩（沿用旧 _appendSlgLayers 的判定），允许 enamor 与 __lastValid* 记录。
function _slgLayerOptsGm1() {
    const activeScene = document.querySelector('.scene.active');
    const needsMask = !!(activeScene &&
        activeScene.id !== 'player-stats-scene' &&
        activeScene.id !== 'relationships-scene');
    return { mask: needsMask, allowEnamor: true, recordLastValid: true, mode: 1 };
}

// 更新日期显示
function updateDateDisplay() {
    const year = Math.floor((currentWeek - 1) / 48) + 1;
    const remainingWeeks = (currentWeek - 1) % 48;
    const month = Math.floor(remainingWeeks / 4) + 1;
    const week = remainingWeeks % 4 + 1;
    
    document.getElementById('date-display').textContent = `第${year}年第${month}月第${week}周`;
}

// 更新体力显示
function updateMoodDisplay() {
    const container = document.getElementById('mood-display');
    if (!container) return;
    const over = playerMood > 100;
    const base = Math.max(0, Math.min(100, playerMood));
    const overcap = over ? playerMood - 100 : 0;
    const fillWidth = base;

    container.innerHTML = `
        <span class="mood-text">体力 ${playerMood}</span>
        <div class="mood-bar${over ? ' overcap' : ''}">
            <div class="mood-fill" style="width: ${fillWidth}%;"></div>
        </div>
        ${over ? `<span class="mood-badge">+${overcap}</span>` : ''}
    `;
}

// 更新行动点显示
function updateActionPointsDisplay() {
    document.getElementById('action-points-display').textContent = `行动点: ${actionPoints}`;
    
    const allSceneBtns = document.querySelectorAll('.scene-btn');
    allSceneBtns.forEach(btn => {
        btn.disabled = actionPoints < 1;
    });
}

// 更新所有显示
function updateAllDisplays() {
    updateDateDisplay();
    updateMoodDisplay();
    updateActionPointsDisplay();
    updateStatsDisplay();
    updateSLGReturnButton();  // 确保这个函数被调用
    
    // 删除或注释掉这部分
    // if (GameMode === 0) {
    //     const backBtns = document.querySelectorAll('.back-btn.slg-mode-offset');
    //     backBtns.forEach(btn => btn.classList.remove('slg-mode-offset'));
    // }
}

// 更新属性显示
function updateStatsDisplay() {
    const totalTalents = getTotalTalents();
    const totalCombat = getTotalCombatStats();

    // 更新天赋
    document.getElementById('talent-gengu').style.width = Math.min(100, totalTalents.根骨) + '%';
    document.getElementById('talent-gengu-value').textContent = totalTalents.根骨;
    
    document.getElementById('talent-wuxing').style.width = Math.min(100, totalTalents.悟性) + '%';
    document.getElementById('talent-wuxing-value').textContent = totalTalents.悟性;
    
    document.getElementById('talent-xinxing').style.width = Math.min(100, totalTalents.心性) + '%';
    document.getElementById('talent-xinxing-value').textContent = totalTalents.心性;
    
    document.getElementById('talent-meili').style.width = Math.min(100, totalTalents.魅力) + '%';
    document.getElementById('talent-meili-value').textContent = totalTalents.魅力;
    
    // 更新人物数值
    document.getElementById('stat-wuxue-value').textContent = playerStats.武学;
    document.getElementById('stat-xueshi-value').textContent = playerStats.学识;
    document.getElementById('stat-shengwang-value').textContent = playerStats.声望;
    document.getElementById('stat-jinqian-value').textContent = playerStats.金钱;
    
    // 更新战斗数值
    document.getElementById('combat-attack-value').textContent = totalCombat.攻击力;
    document.getElementById('combat-hp-value').textContent = totalCombat.生命值;
    document.getElementById('combat-crit-rate-value').textContent = `${totalCombat.暴击率}%`;
    document.getElementById('combat-crit-damage-value').textContent = `${totalCombat.暴击伤害}%`;
    document.getElementById('combat-block-value').textContent = totalCombat.格挡;
    document.getElementById('combat-armor-pen-value').textContent = totalCombat.穿甲;
    document.getElementById('combat-turnover-value').textContent = Number(totalCombat.回转 || 0).toFixed(2);
    document.getElementById('combat-lifesteal-value').textContent = `${totalCombat.吸血}%`;
    document.getElementById('combat-thorns-value').textContent = `${totalCombat.反伤}%`;
    
    // 更新剩余点数
    const remainingPoints = calculateRemainingPoints();
    document.getElementById('remaining-points-value').textContent = remainingPoints;
    
    // 更新加点按钮状态
    document.getElementById('add-attack-btn').disabled = remainingPoints <= 0;
    document.getElementById('add-hp-btn').disabled = remainingPoints <= 0;
    const extraButtons = [
        'add-crit-rate-btn',
        'add-crit-damage-btn',
        'add-block-btn',
        'add-armor-pen-btn',
        'add-turnover-btn',
        'add-lifesteal-btn',
        'add-thorns-btn'
    ];
    extraButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = remainingPoints <= 0;
        }
    });
    
    // 更新已学武功列表
    const skillsContainer = document.getElementById('learned-skills');
    skillsContainer.innerHTML = '';
    Object.keys(martialArts).forEach(skill => {
        if (martialArts[skill] === 1) {
            const skillDiv = document.createElement('div');
            skillDiv.className = 'skill-item';
            skillDiv.textContent = '• ' + skill;
            skillsContainer.appendChild(skillDiv);
        }
    });
}

// 更新关系显示
function updateRelationshipsDisplay() {
    const grid = document.getElementById('relationship-grid');
    hideTooltip();
    grid.innerHTML = '';
    
    Object.keys(npcs).forEach(npcId => {
        const npc = npcs[npcId];
        const favorability = npcFavorability[npcId];
        const isVisible = npcVisibility[npcId];
        
        const card = document.createElement('div');
        card.className = 'relationship-card';
        
        card.innerHTML = `
            <div class="relationship-portrait">
                <img src="${npcPortraits[npcId]}" alt="${npc.name}">
            </div>
            <div class="relationship-info">
                <div class="relationship-name">${npc.name}</div>
                <div class="relationship-bar">
                    <div class="relationship-fill" style="width: ${Math.max(0, Math.min(100, favorability))}%"></div>
                </div>
                <div class="relationship-value">好感度: <span class="relationship-value-number">${favorability}</span></div>
                <div class="relationship-controls">
                    <label class="visibility-checkbox">
                        <input type="checkbox" id="visibility-${npcId}" ${isVisible ? 'checked' : ''} 
                               onchange="toggleNpcVisibility('${npcId}')">
                        <span class="checkbox-label">出场</span>
                    </label>
                </div>
            </div>
        `;
        
        card.tabIndex = 0;
        card.addEventListener('pointerenter', function(e) {
            if (e.pointerType === 'mouse') showTooltip(e, npc.description);
        });
        card.addEventListener('pointerleave', function(e) {
            if (e.pointerType === 'mouse' && !relationshipTooltipPinned &&
                !document.getElementById('tooltip').contains(e.relatedTarget)) hideTooltip();
        });
        card.addEventListener('click', function(e) {
            if (e.target.closest('input, label, button')) {
                hideTooltip();
                return;
            }
            if (relationshipTooltipAnchor === card && relationshipTooltipPinned) {
                hideTooltip();
            } else {
                showTooltip(e, npc.description);
                relationshipTooltipPinned = true;
            }
        });
        card.addEventListener('keydown', function(e) {
            if (e.target !== card || !['Enter', ' '].includes(e.key)) return;
            e.preventDefault();
            card.click();
        });
        
        grid.appendChild(card);
    });
}


let relationshipTooltipAnchor = null;
let relationshipTooltipPinned = false;
let relationshipTooltipCleanup = null;

// Relationship descriptions use viewport coordinates and an independently scrollable body.
function showRelationshipTooltip(card, text) {
    hideTooltip();
    const tooltip = document.getElementById('tooltip');
    const viewport = document.getElementById('main-viewport');
    if (!tooltip || !viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const left = Math.max(0, bounds.left) + 8;
    const top = Math.max(0, bounds.top) + 8;
    const right = Math.min(window.innerWidth, bounds.right) - 8;
    const bottom = Math.min(window.innerHeight, bounds.bottom) - 8;
    if (right <= left || bottom <= top) return;
    tooltip.classList.add('relationship-tooltip', 'show');
    tooltip.replaceChildren();
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'relationship-tooltip-close';
    close.textContent = '\u00d7';
    close.setAttribute('aria-label', '关闭介绍');
    close.onclick = hideTooltip;
    const content = document.createElement('div');
    content.className = 'tooltip-item';
    content.textContent = text || '';
    tooltip.append(close, content);
    tooltip.setAttribute('role', 'tooltip');
    tooltip.style.cssText = `position:fixed;transform:none;left:${left}px;top:${top}px;width:${Math.min(340, right - left)}px;max-width:${right - left}px;max-height:${bottom - top}px;`;
    const rect = card.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(left, Math.min(right - tip.width, rect.left + (rect.width - tip.width) / 2)) + 'px';
    const preferredTop = rect.top - tip.height - 8 >= top ? rect.top - tip.height - 8 : rect.bottom + 8;
    tooltip.style.top = Math.max(top, Math.min(bottom - tip.height, preferredTop)) + 'px';
    relationshipTooltipAnchor = card;
    card.setAttribute('aria-describedby', 'tooltip');
    const outside = e => {
        if (!tooltip.contains(e.target) && !card.contains(e.target)) hideTooltip();
    };
    const scroll = e => {
        if (!tooltip.contains(e.target)) hideTooltip();
    };
    const escape = e => { if (e.key === 'Escape') hideTooltip(); };
    const observer = new MutationObserver(() => {
        if (!card.isConnected || !card.closest('.scene.active')) hideTooltip();
    });
    observer.observe(document.getElementById('relationships-scene'), { attributes: true, attributeFilter: ['class', 'style'] });
    document.addEventListener('click', outside);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', hideTooltip);
    relationshipTooltipCleanup = () => {
        observer.disconnect();
        document.removeEventListener('click', outside);
        document.removeEventListener('scroll', scroll, true);
        document.removeEventListener('keydown', escape);
        window.removeEventListener('resize', hideTooltip);
    };
}

// 显示悬停提示
function showTooltip(event, text) {
    const tooltip = document.getElementById('tooltip');
    const card = event.currentTarget;
    if (card.matches('.relationship-card')) {
        showRelationshipTooltip(card, text);
        return;
    }
    hideTooltip();
    const rect = card.getBoundingClientRect();
    const viewportRect = document.querySelector('.viewport').getBoundingClientRect();
    
    tooltip.innerHTML = `<div class="tooltip-item">${text}</div>`;
    tooltip.classList.add('show');
    
    let left = rect.left - viewportRect.left + rect.width / 2;
    let top = rect.top - viewportRect.top - 10;
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    tooltip.style.transform = 'translateX(-50%) translateY(-100%)';
    
    const tooltipRect = tooltip.getBoundingClientRect();
    
    if (tooltipRect.left < viewportRect.left) {
        tooltip.style.transform = 'translateX(0) translateY(-100%)';
        tooltip.style.left = '10px';
    } else if (tooltipRect.right > viewportRect.right) {
        tooltip.style.transform = 'translateX(-100%) translateY(-100%)';
        tooltip.style.left = (viewportRect.width - 10) + 'px';
    }
    
    if (tooltipRect.top < viewportRect.top) {
        tooltip.style.transform = 'translateX(-50%)';
        tooltip.style.top = (rect.bottom - viewportRect.top + 10) + 'px';
    }
}

function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    if (relationshipTooltipCleanup) relationshipTooltipCleanup();
    relationshipTooltipCleanup = null;
    if (relationshipTooltipAnchor) relationshipTooltipAnchor.removeAttribute('aria-describedby');
    relationshipTooltipAnchor = null;
    relationshipTooltipPinned = false;
    if (!tooltip) return;
    tooltip.classList.remove('show');
    if (tooltip.classList.contains('relationship-tooltip')) {
        tooltip.classList.remove('relationship-tooltip');
        tooltip.removeAttribute('style');
        tooltip.replaceChildren();
        tooltip.removeAttribute('role');
    }
}

// 显示"属性查看-角色属性"里 7 项属性（根骨/悟性/心性/魅力/武学/学识/声望）当前数值对应的分档文案
// 取基础值（不含装备加成），与 LLM prompt（040主角属性.txt）看到的数值一致
function showAttrTooltip(event, attrName) {
    let value;
    if (typeof playerTalents !== 'undefined' && playerTalents.hasOwnProperty(attrName)) {
        value = playerTalents[attrName];
    } else if (typeof playerStats !== 'undefined' && playerStats.hasOwnProperty(attrName)) {
        value = playerStats[attrName];
    } else {
        return;
    }
    const text = (typeof getAttributeTierText === 'function') ? getAttributeTierText(attrName, value) : '';
    if (text) showTooltip(event, text);
}

// 渲染主要故事文本（供 pipeline / 开场白调用）
function renderMainText(text) {
    if (!text) return;
    updateStoryText(text);
}

// 更新故事文本（支持分页）
function updateStoryText(text) {
    const storyElement = document.getElementById('story-text');
    currentStoryText = text;

    // 保存当前页码和展开状态
    const previousPage = currentPage;
    const previousExpanded = isStoryExpanded;
    
    // 两种 GameMode 都先解析为演出帧：GameMode 1 页=帧（同现状）；GameMode 0 有标记行时页=帧一一对应，
    // 无任何标记行（如 newWeek 周报）时回退为原自然段分页
    const parsed = parseSlgMainText(text);
    const hasFrames = Array.isArray(parsed) && parsed.some(f => !f.tail);
    const md = window.markdownit({
        html: true,
        breaks: true,
        linkify: true,
        typographer: true
    }).disable('strikethrough');
    if (GameMode === 1) {
        if (parsed && parsed.length > 0) {
            slgModeData = parsed;
            storyPages = slgModeData.map(data => md.render(data.text || ''));
        } else {
            // 解析不到有效页时，回退到普通文本渲染，避免显示空白
            slgModeData = [];
            let processedText = text.replace(/\n+/g, '\n');
            processedText = processedText.replace(/(\r\n)+/g, '\n');
            processedText = processedText.replace(/\r+/g, '\n');
            storyPages = [md.render(processedText)];
        }
    } else if (hasFrames) {
        slgModeData = parsed;
        storyPages = slgModeData.map(data => `<div class="story-paragraph">${md.render(data.text || '')}</div>`);
    } else {
        // 普通模式：按自然段分页，并丢弃每段“|”分隔的补充信息
        slgModeData = [];
        let processedText = text.replace(/\n+/g, '\n');
        processedText = processedText.replace(/(\r\n)+/g, '\n');
        processedText = processedText.replace(/\r+/g, '\n');
        
        const rawParagraphs = processedText.split('\n').filter(part => part.trim());
        const cleanedParagraphs = rawParagraphs.map(part => part.split('|')[0].trim()).filter(p => p.length > 0);
        
        if (cleanedParagraphs.length > 0) {
            storyPages = cleanedParagraphs.map(p => {
                const rendered = md.render(p);
                return `<div class="story-paragraph">${rendered}</div>`;
            });
        } else {
            const stripped = processedText.split('\n').map(line => line.split('|')[0].trim()).join('\n');
            const rendered = md.render(stripped);
            storyPages = [rendered];
        }
    }

    // 智能恢复页码：
    // 1. 如果之前是展开状态，保持展开
    if (previousExpanded) {
        isStoryExpanded = true;
        currentPage = 0;  // 展开模式不需要页码
    } 
    // 2. 如果新的页数能容纳之前的页码，保持原页码
    else if (previousPage < storyPages.length) {
        currentPage = previousPage;
        isStoryExpanded = false;
    } 
    // 3. 默认情况
    else {
        currentPage = 0;
        isStoryExpanded = false;
    }
    
    // 在正文后追加“事件描述页”（若存在随机/战斗事件）
    try {
        const activeEvent = (typeof currentBattleEvent !== 'undefined' && currentBattleEvent) 
            ? currentBattleEvent 
            : ((typeof currentRandomEvent !== 'undefined' && currentRandomEvent) ? currentRandomEvent : null);
        if (activeEvent && activeEvent.事件描述) {
            const mdAppend = window.markdownit({ html: true, breaks: true, linkify: true, typographer: true }).disable('strikethrough');
            const eventHtml = mdAppend.render(activeEvent.事件描述);
            storyPages.push(`<div class="story-paragraph">${eventHtml}</div>`);
        }
    } catch (e) {}

    // 覆盖：当 newWeek===1 时，默认展开全文一次（随后保持用户选择）
    try {
        const ls = (typeof getLocalState === 'function') ? getLocalState() : null;
        if (typeof newWeek === 'number' && newWeek === 1 && ls && !ls.defaultExpandApplied) {
            isStoryExpanded = true;
            currentPage = 0;
            ls.defaultExpandApplied = true;
        } else if (typeof newWeek === 'number' && newWeek !== 1 && ls && ls.defaultExpandApplied
                   && typeof isInRenderEnvironment === 'function' && !isInRenderEnvironment()) {
            // 独立模式 + 非新周：重置展开标记，恢复为翻页模式
            ls.defaultExpandApplied = false;
            isStoryExpanded = false;
            currentPage = 0;
        }
    } catch (e) {}

    // 更新显示
    try {
        const viewport = document.getElementById('main-viewport');
        if (GameMode === 1) {
            try { document.body.classList.add('slg-global'); } catch (e) {}
            if (viewport && !viewport.querySelector('.slg-loading-layer')) {
                const loading = document.createElement('div');
                loading.className = 'slg-loading-layer';
                const spinner = document.createElement('div');
                spinner.className = 'slg-loading-spinner';
                const text = document.createElement('div');
                text.className = 'slg-loading-text';
                text.textContent = '场景加载中';
                loading.appendChild(spinner);
                loading.appendChild(text);
                viewport.insertBefore(loading, viewport.firstChild);
            }
            // GameMode 0→1：GAL 演出硬重置（幂等；清 commit 记忆，演出中则同步清层）
            galPresentation.reset();
            // 新文本到达=新场景数据：旧图层（连容器）与交互遮罩一并作废，
            // 由 updateStoryDisplay 按当前模式重建/补建（修复展开状态下 GameMode 0→1 永远"场景加载中"）
            galPresentation.clearLayers(viewport);
        } else {
            try { document.body.classList.remove('slg-global'); } catch (e) {}
            const old = viewport ? viewport.querySelector('.slg-loading-layer') : null;
            if (old) old.remove();
        }
    } catch (e) {}
    updateStoryDisplay();
}

// 修改 updateStoryDisplay 函数
function updateStoryDisplay() {
    const storyElement = document.getElementById('story-text');
    const pageIndicator = document.getElementById('page-indicator');
    const prevBtn = document.getElementById('story-prev-btn');
    const nextBtn = document.getElementById('story-next-btn');
    const expandBtn = document.getElementById('story-expand-btn');
    const viewport = document.getElementById('main-viewport');
    // 正文翻页点击区挂在整块故事滚动区上（横屏下文本区较高，正文只占顶部一截，光点正文下半区会点不到）
    const storyWrapper = storyElement ? storyElement.parentElement : null;
    
    // GameMode 0 演出中：图层由 galPresentation 维护，这里不清、只同步页码（演出内翻页不播翻页纸）
    const galPlaying = GameMode === 0 && galPresentation.isPlaying();
    if (galPlaying) {
        galPresentation.goto(currentPage);
    } else if (!isStoryExpanded || GameMode !== 1) {
        // 只在非展开模式或非SLG模式时清除图层（连容器与遮罩一起，避免空容器壳累积）
        galPresentation.clearLayers(viewport);
        // 退出SLG相关全局标记
        try { if (GameMode !== 1) document.body.classList.remove('slg-global'); } catch (e) {}
    }
    
    storyElement.onclick = null;
    if (storyWrapper) storyWrapper.onclick = null;
    
    if (isStoryExpanded) {
        // 展开模式
        storyElement.innerHTML = storyPages.join('');
        // SLG模式展开：无现存图层容器时按当前页（展开时通常为第0页）补建图层——
        // 修复展开状态下 GameMode 0→1 切换、或展开中收到新回复时永远"场景加载中"；
        // 有现存图层（toggle 切入展开）则不重建，保持"展开保持当前页图"的原设计
        if (GameMode === 1 && slgModeData && slgModeData.length > 0
            && viewport && !viewport.querySelector('.slg-layer-container')) {
            const expandIndex = Math.min(currentPage, slgModeData.length - 1);
            try { window.__lastValidSlgIndex = expandIndex; } catch (e) {}
            galPresentation.renderLayers(viewport, slgModeData[expandIndex], _slgLayerOptsGm1());
        }
        storyElement.classList.add('expanded');
        if (expandBtn) expandBtn.innerHTML = '▲ 收起';
        if (pageIndicator) pageIndicator.style.display = 'none';
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
    } else {
        // 分页模式
        storyElement.innerHTML = storyPages[currentPage] || '';
        storyElement.classList.remove('expanded');
        if (expandBtn) expandBtn.innerHTML = '▼ 展开全文';
        
        // 如果是SLG模式，显示对应的图片（事件页使用“最后验证有效”的图层）
        if (GameMode === 1 && slgModeData && slgModeData.length > 0) {
            const effectiveIndex = Math.min(currentPage, slgModeData.length - 1);
            const pageData = slgModeData[effectiveIndex];
            // 记录最后一次有效的图层索引，供其他模块使用（如战斗背景）
            try { window.__lastValidSlgIndex = effectiveIndex; } catch (e) {}
            galPresentation.renderLayers(viewport, pageData, _slgLayerOptsGm1());
        }
        
        // GameMode 0 且本轮有演出帧：正文中间 1/3 点击 = 进入 GAL 演出（G2），单页时也要挂点击
        const galEnterable = GameMode === 0 && Array.isArray(slgModeData) && slgModeData.length > 0;
        const multiPage = storyPages.length > 1;
        // 翻页控件逻辑
        if (multiPage || galEnterable) {
            if (storyWrapper) storyWrapper.style.cursor = 'pointer';
            storyElement.style.cursor = 'pointer';
            if (storyWrapper) storyWrapper.onclick = function(e) {
                // 点翻页箭头/页码点/流式按钮时交给自己处理，不再走正文翻页
                if (e.target && e.target.closest && e.target.closest('.story-nav-btn, .page-indicator, #stream-controls')) return;
                const rect = storyWrapper.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const width = rect.width;
                const zone = clickX < width / 3 ? 'left' : (clickX > width * 2 / 3 ? 'right' : 'middle');
                try { console.log('[GAL] story click', { zone, GameMode, multiPage, galEnterable, currentPage, playing: galPresentation.isPlaying() }); } catch (_) {}
                
                if (zone === 'left') {
                    if (multiPage) doPrevPage();
                } else if (zone === 'right') {
                    if (multiPage) doNextPage();
                } else if (galEnterable) {
                    // 演出中再点 = goto 当前页（幂等）；事件页越界由控制器 clamp 到末帧
                    galPresentation.enter({ source: 'page', pageIndex: Math.min(currentPage, slgModeData.length - 1), curtain: true });
                }
            };
        }
        if (multiPage) {
            if (pageIndicator) {
                pageIndicator.style.display = 'flex';
                pageIndicator.innerHTML = '';
                for (let i = 0; i < storyPages.length; i++) {
                    const dot = document.createElement('span');
                    dot.className = 'page-dot' + (i === currentPage ? ' active' : '');
                    dot.onclick = (e) => {
                        e.stopPropagation();
                        doGoToPage(i);
                    };
                    pageIndicator.appendChild(dot);
                }
            }
            
            if (prevBtn) {
                prevBtn.style.display = 'block';
                prevBtn.disabled = currentPage === 0;
            }
            if (nextBtn) {
                nextBtn.style.display = 'block';
                nextBtn.disabled = currentPage === storyPages.length - 1;
            }
        } else {
            if (!galEnterable) {
                storyElement.style.cursor = 'default';
                if (storyWrapper) storyWrapper.style.cursor = 'default';
                if (storyWrapper) storyWrapper.onclick = null;
            }
            
            if (pageIndicator) pageIndicator.style.display = 'none';
            if (prevBtn) prevBtn.style.display = 'none';
            if (nextBtn) nextBtn.style.display = 'none';
        }
    }

    // 确保事件容器位于 main-viewport 下，并按模式控制显示
    try {
        const viewportEl = document.getElementById('main-viewport');
        const randomContainer = document.getElementById('random-event-container');
        const battleContainer = document.getElementById('battle-event-container');

        if (viewportEl && randomContainer && randomContainer.parentElement !== viewportEl) {
            viewportEl.appendChild(randomContainer);
        }
        if (viewportEl && battleContainer && battleContainer.parentElement !== viewportEl) {
            viewportEl.appendChild(battleContainer);
        }

        const hasBattle = (typeof currentBattleEvent !== 'undefined') && !!currentBattleEvent;
        const hasRandom = !hasBattle && (typeof currentRandomEvent !== 'undefined') && !!currentRandomEvent;
        const shouldShowByMode = isStoryExpanded 
            ? (hasBattle || hasRandom) 
            : ((storyPages && storyPages.length > 0) && currentPage === storyPages.length - 1 && (hasBattle || hasRandom));

        if (randomContainer) {
            randomContainer.classList.toggle('show', shouldShowByMode && hasRandom);
        }
        if (battleContainer) {
            battleContainer.classList.toggle('show', shouldShowByMode && hasBattle);
        }
    } catch (e) {}
    
    storyElement.style.opacity = '0';
    setTimeout(() => {
        storyElement.style.transition = 'opacity 0.5s ease';
        storyElement.style.opacity = '1';
    }, 100);
}

// 翻页函数（注意函数名改为doXXX避免冲突）
function doGoToPage(pageNum) {
    if (pageNum >= 0 && pageNum < storyPages.length) {
        currentPage = pageNum;
        // GameMode 0 且本轮有演出帧：翻页（正文左右 1/3 / 箭头 / 页码点）即进入演出；已在演出中则 enter 退化为 goto，
        // 展开态不响应。事件描述页越界由控制器 clamp 到末帧。
        if (GameMode === 0 && !isStoryExpanded && Array.isArray(slgModeData) && slgModeData.length > 0) {
            galPresentation.enter({ source: 'page', pageIndex: Math.min(currentPage, slgModeData.length - 1), curtain: true });
        }
        updateStoryDisplay();
    }
}

function doPrevPage() {
    doGoToPage(currentPage - 1);
}

function doNextPage() {
    doGoToPage(currentPage + 1);
}

// 切换展开/收起
function doToggleStoryExpand() {
    isStoryExpanded = !isStoryExpanded;
    // 展开全文 = 阅读模式：GameMode 0 演出播翻页纸退场；收起不自动进入（G3）
    if (isStoryExpanded && GameMode === 0 && galPresentation.isPlaying()) {
        try { galPresentation.exit({ reason: 'expand', curtain: true }); } catch (e) {}
    }
    updateStoryDisplay();
}

// 显示弹窗
function showModal(text) {
    const modal = document.getElementById('modal');
    const modalText = document.getElementById('modal-text');
    const modalButtons = document.getElementById('modal-buttons');
    
    modalText.innerHTML = text;
    modalButtons.innerHTML = '<button class="modal-btn" onclick="closeModal()">确定</button>';
    modal.style.display = 'block';
}

// 显示确认弹窗
function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('modal');
    const modalText = document.getElementById('modal-text');
    const modalButtons = document.getElementById('modal-buttons');
    
    modalText.innerHTML = `<div style="font-size: clamp(1.2rem, 3vw, 1.5rem); margin-bottom: 10px;">${title}</div>${message}`;
    modalButtons.innerHTML = `
        <button class="modal-btn" onclick="confirmAction()">确定</button>
        <button class="modal-btn cancel" onclick="closeModal()">取消</button>
    `;
    
    window.confirmAction = () => {
        closeModal();
        onConfirm();
    };
    
    modal.style.display = 'block';
}

// 更新SLG返回按钮的显示状态
function updateSLGReturnButton() {
    // 按钮外层包了 .dock-btn-wrap（与下拉按钮同构，保证等宽），显隐需切到 wrapper 上，
    // 否则隐藏按钮后空 wrapper 仍占一份 flex 空间
    const slgReturnWrap = document.getElementById('slg-return-wrap');
    const skipWeekWrap = document.getElementById('skip-week-wrap');
    const slgReturnBtn = document.getElementById('slg-return-btn');
    const skipWeekBtn = document.getElementById('skip-week-btn');
    
    if (slgReturnWrap && skipWeekWrap) {
        if (GameMode === 1) {
            // SLG模式：显示返回按钮，隐藏跳过按钮
            slgReturnWrap.style.display = '';
            skipWeekWrap.style.display = 'none';
        } else {
            // 普通模式：隐藏返回按钮，显示跳过按钮
            slgReturnWrap.style.display = 'none';
            skipWeekWrap.style.display = '';
        }
    } else if (slgReturnBtn && skipWeekBtn) {
        // 回退：wrapper 不存在时退回旧版按钮级显隐
        if (GameMode === 1) {
            slgReturnBtn.style.display = 'block';
            skipWeekBtn.style.display = 'none';
        } else {
            slgReturnBtn.style.display = 'none';
            skipWeekBtn.style.display = 'block';
        }
    }
}

function fitModalToViewport(modal) {
    const vp = document.getElementById('main-viewport');
    if (!vp) return;

    const vpRect = vp.getBoundingClientRect();

    // 缺省：对齐到 #main-viewport，大小=1×viewport
    let targetLeft = vpRect.left;
    let targetTop = vpRect.top;
    let targetWidth = vpRect.width;
    let targetHeight = vpRect.height;
    let allowScroll = false;

    // 长内容弹窗：高度改为“container底边 - viewport顶边”，并允许在遮罩内滚动
    const tallModalIds = ['history-summary-modal', 'skill-library-modal', 'skill-equipment-modal', 'pipeline-log-modal', 'game-settings-modal', 'cheat-modal', 'load-modal', 'api-config-modal', 'prompt-editor-modal', 'wb-editor-modal', 'bounty-modal'];
    // 横屏（左视窗/右文本）下，文本区在视窗右侧，长弹窗改为“横向突破视窗”——
    // 从视窗左缘一直铺到 container 右缘，高度仍等于视窗高度。
    const landscape = !!(document.body && document.body.classList && document.body.classList.contains('layout-landscape'));
    if (tallModalIds.includes(modal.id)) {
        const container = document.querySelector('.container') || document.body;
        const containerRect = container.getBoundingClientRect();

        if (landscape) {
            // 横向突破：宽度覆盖“视窗左缘 → container 右缘”，高度不超出视窗
            targetWidth = Math.max(vpRect.width, containerRect.right - vpRect.left);
            targetHeight = vpRect.height;
        } else {
            // 从 #main-viewport 顶边开始，覆盖到整页 container 底边
            const desiredHeight = Math.max(
                vpRect.height,                            // 至少不小于viewport
                containerRect.bottom - vpRect.top        // 覆盖到container底边
            );

            targetHeight = Math.max(0, Math.floor(desiredHeight));
        }
        allowScroll = true;

        // 固定定位的长弹窗必须落在实际可见视口内；页面container可能比屏幕更高。
        // visualViewport也覆盖缩放/软键盘后的可见区域，内部内容仍通过overflow滚动。
        const visual = window.visualViewport;
        const visibleLeft = visual ? visual.offsetLeft : 0;
        const visibleTop = visual ? visual.offsetTop : 0;
        const visibleWidth = Math.max(1, visual ? visual.width : window.innerWidth);
        const visibleHeight = Math.max(1, visual ? visual.height : window.innerHeight);
        targetWidth = Math.min(Math.max(1, targetWidth), visibleWidth);
        targetLeft = Math.max(visibleLeft, Math.min(targetLeft, visibleLeft + visibleWidth - targetWidth));
        targetTop = Math.max(visibleTop, Math.min(targetTop, visibleTop + visibleHeight - 1));
        targetHeight = Math.max(1, Math.min(targetHeight, visibleTop + visibleHeight - targetTop));
    }

    // 统一定位（固定定位，锚到#main-viewport在视口中的位置）
    Object.assign(modal.style, {
        position: 'fixed',
        left: targetLeft + 'px',
        top: targetTop + 'px',
        width: targetWidth + 'px',
        height: targetHeight + 'px',
        margin: '0',
        transform: 'none',
        overflow: allowScroll ? 'auto' : 'hidden',
        zIndex: modal.style.zIndex || 2500
    });

    const content = modal.querySelector('.modal-content');
    if (content) {
        Object.assign(content.style, {
            width: '100%',
            height: '100%',
            maxWidth: 'none',
            maxHeight: 'none',
            left: '0',
            top: '0',
            transform: 'none',
            overflow: 'auto' // 内容区域可滚动
        });
    }
}

/* 供窗口大小变化时实时刷新位置 */
function bindModalAutoFit(modal) {
    let rafId = null;
    
    const refresh = () => {
        // 使用requestAnimationFrame避免过度更新
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            fitModalToViewport(modal);
        });
    };
    
    // 监听窗口大小变化
    window.addEventListener('resize', refresh);
    
    // 监听滚动事件
    window.addEventListener('scroll', refresh, { passive: true });
    document.addEventListener('scroll', refresh, { passive: true });
    const visual = window.visualViewport;
    if (visual) {
        visual.addEventListener('resize', refresh, { passive: true });
        visual.addEventListener('scroll', refresh, { passive: true });
    }
    
    // 清理函数
    modal._unbindFit = () => {
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener('resize', refresh);
        window.removeEventListener('scroll', refresh);
        document.removeEventListener('scroll', refresh);
        if (visual) {
            visual.removeEventListener('resize', refresh);
            visual.removeEventListener('scroll', refresh);
        }
    };
}

// 关闭所有特殊弹窗（背包、装备、难度、金手指）
function closeAllSpecialModals() {
    // 关闭背包
    const inventoryModal = document.getElementById('inventory-modal');
    if (inventoryModal.style.display === 'block') {
        closeInventoryModal();
    }
    
    // 关闭装备
    const equipmentModal = document.getElementById('equipment-modal');
    if (equipmentModal.style.display === 'block') {
        closeEquipmentModal();
    }

    const skillLibraryModal = document.getElementById('skill-library-modal');
    if (skillLibraryModal && skillLibraryModal.style.display === 'block' && typeof closeSkillLibraryModal === 'function') {
        closeSkillLibraryModal();
    }

    const skillEquipmentModal = document.getElementById('skill-equipment-modal');
    if (skillEquipmentModal && skillEquipmentModal.style.display === 'block' && typeof closeSkillEquipmentModal === 'function') {
        closeSkillEquipmentModal();
    }
    
    // 关闭难度设置
    const difficultyModal = document.getElementById('difficulty-modal');
    if (difficultyModal.style.display === 'block') {
        closeDifficultyModal();
    }
    
    // 关闭金手指
    const cheatModal = document.getElementById('cheat-modal');
    if (cheatModal.style.display === 'block') {
        closeCheatModal();
    }
    
    // 关闭物品详情
    const itemDetailModal = document.getElementById('item-detail-modal');
    if (itemDetailModal.style.display === 'block') {
        closeItemDetailModal();
    }

    // 关闭交易
    const tradingModal = document.getElementById('trading-modal');
    if (tradingModal && tradingModal.style.display === 'block') {
        closeTrading();
    }

    // 关闭商品详情
    const shopDetailModal = document.getElementById('shop-detail-modal');
    if (shopDetailModal && shopDetailModal.style.display === 'block') {
        closeShopDetailModal();
    }
}

// 更新装备槽显示
function updateEquipmentSlot(slotId, itemName) {
    const slot = document.getElementById(slotId);
    if (itemName) {
        slot.innerHTML = `<div class="equipped-item">${itemName}</div>`;
    } else {
        slot.innerHTML = '<div class="empty-slot">空</div>';
    }
}

// 显示道具详情
function showItemDetail(itemName) {
    const item = item_list[itemName];
    if (!item) return;
    
    // 先关闭可能已经打开的物品详情弹窗
    const existingDetailModal = document.getElementById('item-detail-modal');
    if (existingDetailModal.style.display === 'block') {
        closeItemDetailModal();
    }
    
    document.getElementById('item-name').textContent = itemName;
    document.getElementById('item-description').textContent = item.描述;
    
    let infoHTML = '';
    if (item.可交易) {
        infoHTML += `<div class="item-stat"><span class="item-stat-label">买入价格：</span>${item.买入价格} 金</div>`;
        infoHTML += `<div class="item-stat"><span class="item-stat-label">卖出价格：</span>${item.卖出价格} 金</div>`;
    }
    if (item.可装备) {
        infoHTML += `<div class="item-stat"><span class="item-stat-label">装备类型：</span>${item.装备类型}</div>`;
        infoHTML += `<div class="item-stat"><span class="item-stat-label">装备属性：</span>${getEquipEffectText(item)}</div>`;
    }
    if (item.可使用) {
        infoHTML += `<div class="item-stat"><span class="item-stat-label">使用效果：</span>${getItemEffectText(item)}</div>`;
    }
    document.getElementById('item-info').innerHTML = infoHTML;
    
    const actionsDiv = document.getElementById('item-actions');
    actionsDiv.innerHTML = '';
    
    if (item.可使用) {
        const useBtn = document.createElement('button');
        useBtn.className = 'modal-btn';
        useBtn.textContent = '使用';
        useBtn.onclick = () => useItem(itemName);
        actionsDiv.appendChild(useBtn);
    }
    
    if (item.可装备) {
        const isEquipped = Object.values(equipment).includes(itemName);
        
        if (isEquipped) {
            const unequipBtn = document.createElement('button');
            unequipBtn.className = 'modal-btn unequip-btn';
            unequipBtn.textContent = '卸下';
            unequipBtn.onclick = () => unequipItem(itemName);
            actionsDiv.appendChild(unequipBtn);
        } else {
            const equipBtn = document.createElement('button');
            equipBtn.className = 'modal-btn';
            equipBtn.textContent = '装备';
            equipBtn.onclick = () => equipItem(itemName);
            actionsDiv.appendChild(equipBtn);
        }
    }
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-btn cancel';
    closeBtn.textContent = '关闭';
    closeBtn.onclick = () => closeItemDetailModal();
    actionsDiv.appendChild(closeBtn);
    
    const modal = document.getElementById('item-detail-modal');
    modal.style.display = 'block';
    
    // 将物品详情弹窗定位在背包弹窗的中心
    const inventoryModal = document.getElementById('inventory-modal');
    const inventoryRect = inventoryModal.getBoundingClientRect();
    const detailContent = modal.querySelector('.modal-content');
    
    // 设置物品详情弹窗的位置
    detailContent.style.position = 'fixed';
    detailContent.style.left = inventoryRect.left + inventoryRect.width / 2 + 'px';
    detailContent.style.top = inventoryRect.top + inventoryRect.height / 2 + 'px';
    detailContent.style.transform = 'translate(-50%, -50%)';
}

// 获取道具效果文本
function formatEffectText(effects) {
    if (!effects || typeof effects !== 'object') return '无';
    const entries = Object.entries(effects).filter(([, value]) => Number(value) !== 0);
    if (entries.length === 0) return '无';
    return entries.map(([attr, value]) => {
        const label = attr === 'playerMood' ? '体力' : attr;
        const sign = Number(value) >= 0 ? '+' : '';
        return `${label} ${sign}${value}`;
    }).join('，');
}

function getItemEffectText(item) {
    return formatEffectText(item.影响属性);
}

function getEquipEffectText(item) {
    return formatEffectText(item.装备属性);
}

function closeItemDetailModal() {
    document.getElementById('item-detail-modal').style.display = 'none';
}