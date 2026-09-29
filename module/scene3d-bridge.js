/* Classic-script boundary: only this module reads the game's lexical globals.
 * No state reads, renderer creation, asset requests or event binding before start(). */
(function () {
    'use strict';
    const locations = Object.freeze({ map: 'main', yanwuchang: 'training', cangjingge: 'library', huofang: 'kitchen', houshan: 'back_mountain', yishiting: 'council', tiejiangpu: 'forge', nandizi: 'male_quarters', nvdizi: 'female_quarters', shanmen: 'gate', gongtian: 'fields', danfang: 'alchemy' });
    // Visual identity only: residents and the displayed subset remain host-owned.
    // Kept in sync with scene3d/src/npcs.js by the NPC projection contract tests.
    const animated = Object.freeze({ A: 'pozhenzi', B: 'dongting', C: 'qiantang', D: 'xiaobaihu', E: 'jisi', F: 'shiyannian', G: 'huyanxian', H: 'yuzhu', I: 'anmu', J: 'tangmuli', K: 'luoqianyou', L: 'shenmizayi', M: 'xuantianqing', N: 'luchunruo', O: 'lingxuefei' });
    // Floating hotspot mesh → original business action. Resolved lazily so the
    // host's lexical globals are only read when a button is actually pressed.
    const hotspotActions = Object.freeze({
        gate: { Gate_stairs: () => showWorldMap() },
        fields: { Fields_shed: () => performAction('耕种', 'gongtian') },
        library: { desk: () => performAction('学习', 'cangjingge'), shelf_classics: () => showSkillLibrary() },
        alchemy: { Alchemy_furnace: () => performAction('炼丹', 'danfang') },
        female_quarters: { Female_screen: () => performAction('拜访', 'nvdizi') },
        training: { Training_medallion: () => performAction('练武', 'yanwuchang') },
        council: { sand_table: () => performAction('汇报', 'yishiting'), bounty_board: () => showBountyModal() },
        kitchen: { Kitchen_firewood: () => performAction('打杂', 'huofang'), Kitchen_counter: () => showTrading('food') },
        male_quarters: { Male_bed_east: () => performAction('休息', 'nandizi') },
        forge: { Smith_anvil: () => performAction('打铁', 'tiejiangpu'), Smith_weapon_rack: () => showTrading('equipment') },
        back_mountain: { Ravine_cave: () => performAction('秘密赌场', 'houshan'), Ravine_stairs: () => performAction('探索', 'houshan') },
    });
    // Page-turn sheet copy: 3D scene id → the 前往 verb shown on the covering page
    // (mirrors scene3d/src/interior-scenes.js entry/kind: 入室 / 入坊 / 入山 / 访门 / 入场 / 入田).
    const sceneEntry = Object.freeze({ library: '入室', council: '入室', alchemy: '入室', kitchen: '入室', male_quarters: '入室', female_quarters: '入室', guest_quarters: '入室', forge: '入坊', back_mountain: '入山', gate: '访门', training: '入场', fields: '入田' });
    const key = 'jxz_scene3d_preferences_v1';
    // Bumped whenever the stored shape changes meaning. v2 = quality is no longer
    // chosen by the UI (nor auto-detected), so a legacy v1 value is not a user choice.
    const PREF_SCHEMA = 2;
    let started = false, epoch = 1, revision = 0, life = 0, queued = false, forceNext = false;
    let turn = null, pendingApply = null, retryPending = false, restoreHold = false;
    let root, viewport, notice, view = null, viewToken = null, importTask = null, release = null, unloadTimer = null;
    let preferences = null, last = null, fingerprint = '', readyScene = null;
    let preciseTime = null, menu = null, settings = null, observer = null;
    let page = null, pageAnimation = null;
    const tuningKeys = Object.freeze(['bloom', 'shaft', 'saturation', 'contrast', 'gamma', 'warmth', 'vignette']);
    const defaultTuning = () => ({ bloom: 1, shaft: 0.85, saturation: 1.4, contrast: 1.4, gamma: 0.88, warmth: 0.38, vignette: 0.85 });
    // Native Capacitor app (APK → phone) defaults renderScale to 2.0; plain web defaults to 1.25.
    const nativeMobile = () => !!(typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const defaultPreferences = () => ({ enabled: false, quality: 'balanced', renderScale: (nativeMobile() ? 2 : 1.25), msaa: 2, shadows: true, atmosphere: true, tuning: defaultTuning() });
    const displayed = new Map(), busy = new Set(), errors = [];
    const counters = { notifications: 0, applied: 0, rejectedIntents: 0, mounts: 0, destroys: 0 };
    const clone = value => JSON.parse(JSON.stringify(value));
    const currentMode = () => typeof GameMode === 'number' ? GameMode : null;
    const currentLocation = () => typeof userLocation === 'string' ? userLocation : '';
    const own = node => node && (node.closest?.('[data-scene3d-owned]') || node === root);
    function warn(code, error) {
        const entry = { code, message: String(error?.message || error || code), at: Date.now() };
        errors.push(entry); if (errors.length > 20) errors.shift();
        console.warn('[Scene3D]', code, entry.message);
        if (notice) { notice.hidden = false; notice.firstChild.textContent = '3D暂不可用，已保留2D。'; }
    }
    function isVisible(element) {
        if (!element || element.hidden || !element.getClientRects().length) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }
    function overlayReasons(ignoreOwnMenu) {
        const reasons = Array.from(busy, token => 'generation:' + token);
        if (typeof inputEnable !== 'undefined' && inputEnable === 0) reasons.push('business-input-disabled');
        const nodes = document.querySelectorAll('.modal, [id$="-modal"], .viewport-overlay, .npc-selection-overlay, .location-info-popup.show, .npc-info-popup.show, #stream-mask.active, .random-event-container, .battle-event-container');
        nodes.forEach((element, index) => {
            if (own(element) || !isVisible(element)) return;
            reasons.push('modal:' + (element.id || element.className.split(' ')[0] + ':' + index));
        });
        if (settings && !settings.hidden) reasons.push('settings');
        if (menu && !ignoreOwnMenu) reasons.push('scene-menu');
        return [...new Set(reasons)].sort();
    }
    function snapshot() {
        const active = Array.from(document.querySelectorAll('#main-viewport > .scene.active'));
        const logicalPage = active.length === 1 ? active[0].id.replace(/-scene$/, '') : 'other';
        const mode = currentMode(), place = currentLocation();
        const eligible = mode === 0 && Object.hasOwn(locations, logicalPage) && (logicalPage === 'map' ? place === 'tianshanpai' : place === logicalPage);
        const residents = [], renderedNpcs = [];
        // Match updateLocationHeadcountLabels exactly: count all assigned map entries,
        // not just visible/known renderables. Legacy Z can contribute a sixteenth dot.
        const locationNpcCounts = Object.fromEntries(Object.keys(locations).filter(id => id !== 'map').map(id => [id, 0]));
        if (typeof currentNpcLocations !== 'undefined' && currentNpcLocations && typeof currentNpcLocations === 'object') {
            Object.keys(currentNpcLocations).forEach(id => {
                const assigned = currentNpcLocations[id];
                if (Object.hasOwn(locationNpcCounts, assigned)) locationNpcCounts[assigned]++;
            });
        }
        const rosterError = false;
        if (eligible && logicalPage !== 'map' && typeof currentNpcLocations !== 'undefined' && currentNpcLocations && typeof npcs !== 'undefined' && npcs) {
            Object.keys(currentNpcLocations).forEach(id => {
                if (currentNpcLocations[id] !== place || !Object.hasOwn(animated, id) || !Object.hasOwn(npcs, id) || !npcs[id]
                    || (typeof npcVisibility !== 'undefined' && npcVisibility[id] === false)) return;
                residents.push({ gameNpcId: id, displayName: npcs[id].name });
            });
            // 3D derives the complete legitimate roster without calling displayNpcs,
            // rerolling its random subset, or modifying the original 2D DOM/save state.
            const selected = preferences.enabled ? residents.map(n => n.gameNpcId) : displayed.get(place) || [];
            new Set(selected).forEach(id => {
                if (!residents.some(n => n.gameNpcId === id)) return;
                renderedNpcs.push({ gameNpcId: id, displayName: npcs[id].name, visualKind: 'animated', visualKey: animated[id], portraitUrl: typeof npcPortraits !== 'undefined' ? new URL(npcPortraits[id], document.baseURI).href : '' });
            });
        }
        const rect = viewport.getBoundingClientRect();
        const visible = preferences.enabled && eligible && !rosterError && !document.hidden && rect.width > 0 && rect.height > 0 && location.protocol !== 'file:';
        const blocks = overlayReasons(false);
        if (!visible) blocks.push('hidden');
        const time = preciseTime?.epoch === epoch ? preciseTime.hour : (typeof dayNightStatus !== 'undefined' && dayNightStatus === 'night' ? 22 : 14);
        const season = typeof seasonStatus === 'string' && ['spring', 'summer', 'autumn', 'winter'].includes(seasonStatus) ? seasonStatus : 'winter';
        return { protocol: 1, sessionEpoch: epoch, revision, mode, logicalPage, gameLocationId: place,
            sceneId: eligible && !rosterError ? locations[logicalPage] : null,
            environment: { season, hour: time, timeSource: preciseTime?.epoch === epoch ? 'parsed' : 'dayNightFallback' },
            residents, renderedNpcs, locationNpcCounts, layoutKey: epoch + ':' + logicalPage + ':' + renderedNpcs.map(n => n.gameNpcId).join(','),
            // Own menus lock input, not drawing: location outlines and the focused
            // animated NPC remain alive. Unrelated business overlays still pause both.
            visible, renderEnabled: visible && !blocks.filter(reason => reason !== 'scene-menu').length, interactive: visible && !blocks.length, blockReasons: blocks, rosterError };
    }
    function clearReady() {
        restoreHold = false;
        readyScene = null;
        if (viewport) viewport.removeAttribute('data-scene3d-ready');
        // 布局层通过 body 状态区分 3D 固定分屏与 2D 内容自适应；任何回退都必须同步清理。
        try {
            if (document.body.classList.contains('scene3d-active')) document.body.classList.remove('scene3d-active');
        } catch (e) {}
        if (root) root.hidden = true;
    }
    function stopDrawing(hide) {
        view?.setInteractionEnabled(false);
        view?.setRenderEnabled(false);
        if (hide) { view?.setVisible(false); clearReady(); }
    }
    function closeMenu(restoreView = false) {
        if (!menu) return;
        const element = menu.element, dynamic = menu.kind === 'npc';
        if (menu.originalLocationHtml !== undefined) element.innerHTML = menu.originalLocationHtml;
        menu = null;
        if (dynamic) element.remove();
        // Location popups are shared with the 2D path: un-mark them
        // instead of removing them from the DOM.
        element.classList.remove('show', 'scene3d-menu');
        delete element.dataset.scene3dOwned;
        element.removeAttribute('role');
        element.removeAttribute('aria-label');
        if (element.id === 'location-info-popup' && typeof closeLocationInfo === 'function') {
            // showLocationInfo() arms its own outside-click close 100ms after opening.
            // Closing first leaves that stale document handler armed, and it would kill
            // the next 2D popup on the very click that opens it, so sweep once more.
            const drop = () => document.removeEventListener('click', closeLocationInfo);
            drop(); setTimeout(drop, 150);
        }
        view?.clearSelection?.({ restoreView: dynamic && restoreView });
        notify('menu-closed');
    }
    function pageSheet() {
        if (!page) {
            page = document.createElement('div'); page.className = 'scene3d-page-turn'; page.dataset.scene3dOwned = 'page'; page.setAttribute('aria-hidden', 'true'); page.hidden = true;
            const sheet = document.createElement('div'); sheet.className = 'scene3d-page-sheet';
            const seal = document.createElement('span'); seal.className = 'scene3d-page-seal'; seal.textContent = '山门图志'; seal.setAttribute('aria-hidden', 'true');
            const title = document.createElement('h2'); title.className = 'scene3d-page-title';
            const detail = document.createElement('p'); detail.className = 'scene3d-page-detail';
            const rule = document.createElement('div'); rule.className = 'scene3d-page-rule';
            sheet.append(seal, title, detail, rule); page.append(sheet);
            viewport.append(page);
        }
        return { page, sheet: page.firstElementChild, title: page.querySelector('.scene3d-page-title'), detail: page.querySelector('.scene3d-page-detail') };
    }
    function cancelPageAnimation() {
        const running = pageAnimation;
        pageAnimation = null; // Revoke ownership before cancel() settles its promise.
        running?.cancel();
    }
    function abortTurn() {
        turn = null;
        cancelPageAnimation();
        if (page) page.hidden = true;
        if (viewport) delete viewport.dataset.scene3dTurning;
    }
    function beginTurn(next) {
        // Navigation during loading shares the already covering/covered sheet. During
        // reveal, pin it flat synchronously instead of starting another translucent cover.
        if (turn && turn.phase !== 'revealing') return turn;
        const interruptedReveal = Boolean(turn);
        cancelPageAnimation();
        const owner = { phase: interruptedReveal ? 'covered' : 'covering', covered: null };
        turn = owner;
        viewport.dataset.scene3dTurning = 'true';
        const label = typeof locationNames !== 'undefined' && locationNames[next.gameLocationId] || next.sceneId;
        if (interruptedReveal) {
            const { page, sheet } = pageSheet();
            page.hidden = false; sheet.style.transform = 'rotateY(0deg)'; sheet.style.opacity = '1';
            owner.covered = Promise.resolve();
        } else {
            owner.covered = playPageTurn(true, label, next.sceneId === 'main' ? '合上图志 · 重返天山派' : `翻开山门图志 · 正在${sceneEntry[next.sceneId] || '入室'}`)
                .then(() => { if (turn === owner) owner.phase = 'covered'; });
        }
        return owner;
    }
    async function revealTurn(owner) {
        if (!owner || turn !== owner || owner.phase === 'revealing') return;
        owner.phase = 'revealing';
        // The sheet is completely opaque here; the destination 2D fallback may now
        // reappear beneath it. Only this owner may uncover or release the sheet.
        delete viewport.dataset.scene3dTurning;
        await playPageTurn(false);
        if (turn !== owner) return;
        turn = null;
        // The loading snapshot carried interactive:false. Mark the canonical
        // projection dirty; the owning apply must clear pendingApply BEFORE
        // scheduling its replacement, otherwise same-version dedupe drops it.
        owner.revealed = true;
    }
    function playPageTurn(cover, label, detailText) {
        if (!viewport || !preferences.enabled) return Promise.resolve();
        const { page, sheet, title, detail } = pageSheet();
        if (cover) {
            title.textContent = label || '';
            detail.textContent = detailText || '';
        }
        const returning = !cover;
        const edge = returning ? -1 : 1;
        sheet.style.transformOrigin = returning ? '100% 50%' : '0% 50%';
        page.hidden = false;
        const from = cover ? `rotateY(${-edge * 94}deg)` : 'rotateY(0deg)';
        const to = cover ? 'rotateY(0deg)' : `rotateY(${edge * 94}deg)`;
        const rest = () => { sheet.style.transform = to; sheet.style.opacity = cover ? '1' : '0'; };
        cancelPageAnimation();
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            rest();
            if (returning) page.hidden = true;
            return Promise.resolve();
        }
        let animation;
        try {
            animation = sheet.animate([{ transform: from, opacity: cover ? 0 : 1 }, { transform: to, opacity: cover ? 1 : 0 }], { duration: 300, easing: 'cubic-bezier(.35,.05,.2,1)', fill: 'both' });
        } catch (_) {
            rest(); if (returning) page.hidden = true;
            return Promise.resolve();
        }
        return new Promise(resolve => {
            let timeout, settled = false;
            const owner = { cancel: () => finish(false) };
            const finish = (commit = true) => {
                if (settled) return;
                settled = true; clearTimeout(timeout);
                try { animation.cancel(); } catch (_) {}
                if (pageAnimation === owner) {
                    pageAnimation = null;
                    if (commit) { rest(); if (returning) page.hidden = true; }
                }
                resolve();
            };
            pageAnimation = owner;
            timeout = setTimeout(() => finish(), 750);
            animation.finished.then(() => finish(), () => finish());
        });
    }
    async function destroyView() {
        const old = view; view = null; viewToken = null;
        pendingApply = null; abortTurn();
        clearReady();
        if (old) { counters.destroys++; await old.destroy(); }
    }
    function invalidate(reason) {
        life++;
        stopDrawing(true); closeMenu();
        if (notice) notice.hidden = true;
        notify(reason || 'invalidated', true);
    }
    function relativePath(value) {
        if (typeof value !== 'string' || !value || /[\\?#%\u0000-\u001f]/.test(value) || value.startsWith('/') || /^[a-z]+:/i.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid release path');
        return value;
    }
    function under(base, relative) {
        const url = new URL(relativePath(relative), base);
        if (url.origin !== base.origin || !url.href.startsWith(base.href)) throw new Error('Asset URL escapes release');
        return url.href;
    }
    async function sha256(bytes) {
        if (!globalThis.crypto?.subtle) throw new Error('此环境不能校验3D资源清单，请使用localhost或HTTPS');
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    }
    async function loadRelease() {
        if (release) return release;
        if (importTask) return importTask;
        importTask = (async () => {
            const base = new URL('./assets/sect3d/', document.baseURI);
            const response = await fetch(new URL('current.json', base), { cache: 'no-store' });
            if (!response.ok) throw new Error('3D资源尚未构建');
            const pointer = await response.json();
            if (pointer.schemaVersion !== 1 || typeof pointer.buildId !== 'string' || pointer.buildId.length > 128 || pointer.buildId.includes('/') || relativePath(pointer.buildId) !== pointer.buildId || pointer.bridgeProtocol?.min > 1 || pointer.bridgeProtocol?.max < 1 || !pointer.bridgeProtocol) throw new Error('3D版本协议不兼容');
            if (pointer.manifest !== pointer.buildId + '/manifest.json') throw new Error('Invalid manifest location');
            const manifestResponse = await fetch(under(base, pointer.manifest), { cache: 'no-cache' });
            if (!manifestResponse.ok) throw new Error('3D清单缺失');
            const bytes = await manifestResponse.arrayBuffer();
            if (await sha256(bytes) !== pointer.manifestSha256) throw new Error('3D清单摘要不匹配');
            const manifest = JSON.parse(new TextDecoder().decode(bytes));
            if (manifest.schemaVersion !== 1 || manifest.buildId !== pointer.buildId || manifest.bridgeProtocol?.min > 1 || manifest.bridgeProtocol?.max < 1 || !manifest.bridgeProtocol || !manifest.files) throw new Error('Invalid release manifest');
            const names = new Set();
            for (const name of Object.keys(manifest.files)) {
                relativePath(name);
                if (names.has(name.toLowerCase())) throw new Error('Duplicate case-insensitive asset');
                names.add(name.toLowerCase());
            }
            const versionBase = new URL(pointer.buildId + '/', base);
            if (!manifest.files[manifest.entry] || !Array.isArray(manifest.css) || manifest.css.some(css => !manifest.files[css])) throw new Error('Missing declared entry or CSS');
            const links = [];
            try {
                await Promise.all(manifest.css.map(css => new Promise((resolve, reject) => {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet'; link.href = under(versionBase, css); link.dataset.scene3dOwned = 'stylesheet';
                    const timeout = setTimeout(() => { link.remove(); reject(new Error('3D样式加载超时')); }, 20000);
                    link.onload = () => { clearTimeout(timeout); resolve(); };
                    link.onerror = () => { clearTimeout(timeout); reject(new Error('3D样式加载失败')); };
                    links.push(link); document.head.append(link);
                })));
                const module = await import(under(versionBase, manifest.entry));
                if (typeof module.mount !== 'function') throw new Error('3D模块没有mount接口');
                release = { module, base: versionBase.href, buildId: pointer.buildId, links };
                return release;
            } catch (error) { links.forEach(link => link.remove()); throw error; }
        })();
        try { return await importTask; } finally { importTask = null; }
    }
    async function ensureView(expectedLife) {
        if (view) return view;
        const assets = await loadRelease();
        if (expectedLife !== life || !last?.visible || !last.renderEnabled) return null;
        if (!view) {
            const token = {}; viewToken = token;
            view = assets.module.mount(root, { protocol: 1, assetBaseUrl: assets.base, quality: preferences.quality, renderScale: preferences.renderScale, msaa: preferences.msaa, shadows: preferences.shadows, atmosphere: preferences.atmosphere, tuning: preferences.tuning,
                onEvent: event => { if (viewToken === token) onEvent(event); } });
            counters.mounts++;
        }
        return view;
    }
    async function apply(force) {
        if (!started) return;
        counters.notifications++;
        // Legacy 2D closers can hide a shared location popup outside this bridge.
        // Never retain a scene-menu input lock after its actual UI has disappeared.
        if (menu && (menu.element.isConnected === false || menu.element.hidden || !menu.element.classList.contains('show'))) closeMenu();
        const next = snapshot();
        // The ancient header is transparent: render the world behind it instead of
        // leaving an uncovered paper-colored strip. The opaque flat header still
        // reserves space so it cannot hide world-projected roof labels.
        const status = !document.body.classList.contains('ui-style-ancient') && next.logicalPage === 'map' && document.querySelector('#map-scene > .status-display');
        const vp = viewport.getBoundingClientRect();
        const inset = status ? Math.max(0, status.getBoundingClientRect().bottom - vp.top) * viewport.clientHeight / Math.max(1, vp.height) : 0;
        const top = inset + 'px';
        // A restored business snapshot may already target a different room while
        // generation still owns the render lock. Keep the *rendered* scene, its
        // dimensions and epoch intact until a first frame can actually be drawn.
        const holdingRestore = restoreHold && next.visible && !next.renderEnabled;
        const releasingRestore = restoreHold && next.visible && next.renderEnabled;
        if (!holdingRestore && root.style.top !== top) root.style.top = top;
        const previousScene = restoreHold ? readyScene : last?.sceneId ?? null;
        const navigating = Boolean(previousScene && next.sceneId && previousScene !== next.sceneId);
        const compare = JSON.stringify({ ...next, revision: 0 });
        const changed = compare !== fingerprint;
        if (changed) { fingerprint = compare; revision++; }
        next.revision = revision; last = next;
        if (menu && (!next.visible || menu.epoch !== epoch || menu.place !== next.gameLocationId || next.mode !== 0 || (menu.npcId && !next.renderedNpcs.some(n => n.gameNpcId === menu.npcId)))) closeMenu();
        if (!next.visible) {
            pendingApply = null;
            abortTurn();
            stopDrawing(true);
            if (!unloadTimer && view) unloadTimer = setTimeout(() => { unloadTimer = null; destroyView().catch(error => warn('DESTROY', error)); }, 30000);
            return;
        }
        clearTimeout(unloadTimer); unloadTimer = null;
        if (holdingRestore) {
            // Do not forward the new epoch to runtime.applyState: that cancels its
            // active scene even when RAF is paused, leaving a blank canvas. Do not
            // begin a page turn either: its first-frame barrier cannot pass locked.
            stopDrawing(false);
            return;
        }
        if (releasingRestore) restoreHold = false;
        if (!view && !next.renderEnabled) return;
        // Update locks immediately, even while another call is waiting for cover/load.
        if (!next.renderEnabled) stopDrawing(false);
        if (navigating) {
            beginTurn(next);
            // Cancel an unfinished old navigation. A ready old scene may keep drawing
            // behind the covering paper; an unfinished one must not commit mid-cover.
            if (!readyScene) { view?.setVisible(false); clearReady(); }
        }
        if (turn) view?.setInteractionEnabled(false);
        const owner = turn;
        const version = `${life}:${epoch}:${revision}`;
        if (pendingApply?.version === version) return;
        if (!changed && !force && readyScene === next.sceneId) return;
        const request = { version, life, epoch, revision, sceneId: next.sceneId, retry: retryPending };
        retryPending = false;
        pendingApply = request;
        const current = () => pendingApply === request && request.life === life && request.epoch === epoch
            && request.revision === revision && last?.visible && last.sceneId === request.sceneId
            && (!owner || turn === owner);
        try {
            // force and retry use exactly the same barrier. No swap may overtake cover.
            if (owner) await owner.covered;
            if (!current()) return;
            if (readyScene !== next.sceneId) clearReady();
            root.hidden = false;
            const activeView = await ensureView(request.life);
            if (!activeView || !current()) return;
            activeView.setVisible(true);
            activeView.setRenderEnabled(last.renderEnabled);
            activeView.setInteractionEnabled(last.interactive && !turn);
            let result = await activeView.applyState({ ...clone(last), interactive: last.interactive && !turn });
            // Self-heal once: navigation dedupes a failed epoch:scene key forever,
            // so a one-off failure (e.g. shader compile under landscape GPU
            // pressure right after a regenerate) would otherwise strand the scene
            // on the 2D fallback with no visible retry path.
            if (!request.retry && current() && result?.status === 'degraded') result = await activeView.retry();
            if (request.retry && current() && result?.status === 'degraded') result = await activeView.retry();
            counters.applied++;
            if (activeView !== view || !current() || result?.epoch !== epoch || result.revision !== revision || result.sceneId !== last.sceneId) return;
            // ready events are advisory; only the matching apply promise may publish.
            // Check live DOM too: a synchronous host switch may precede its observer.
            const live = snapshot();
            if (!live.visible || live.sceneId !== request.sceneId) { notify('stale-completion'); return; }
            if (result.status === 'degraded') clearReady();
            else if (result.status === 'applied') {
                readyScene = result.sceneId; root.hidden = false; viewport.dataset.scene3dReady = 'true'; notice.hidden = true;
                // 仅在匹配状态真正应用后进入 3D 分屏，避免加载中或降级时提前改变正文布局。
                try {
                    if (!document.body.classList.contains('scene3d-active')) document.body.classList.add('scene3d-active');
                } catch (e) {}
                activeView.setRenderEnabled(live.renderEnabled); activeView.setInteractionEnabled(live.interactive && !turn);
            }
            if (result.status === 'applied' || result.status === 'degraded') await revealTurn(owner);
        } catch (error) {
            if (!current()) return;
            clearReady(); warn('LOAD', error);
            await revealTurn(owner);
        } finally {
            // A superseded operation must never remove a newer operation's cover.
            if (pendingApply === request) {
                pendingApply = null;
                if (retryPending) notify('retry-pending', true);
                else if (owner?.revealed && !turn && request.life === life && request.epoch === epoch) notify('turn-revealed', true);
            }
        }
    }
    function notify(reason, force) {
        forceNext = forceNext || !!force;
        if (!started || queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; const requestForce = forceNext; forceNext = false; apply(requestForce).catch(error => warn('PROJECT', error)); });
    }
    function intentAllowed(event, ignoreMenu) {
        const okay = started && !turn && currentMode() === 0 && preferences.enabled && last?.visible && event.epoch === epoch && event.revision === revision && !overlayReasons(ignoreMenu).length;
        if (!okay) counters.rejectedIntents++;
        return okay;
    }
    // 地点共享原2D弹窗；NPC使用独立管理的选框，复用2D古风水墨图案与类名。
    // .scene3d-menu 仅标记桥接层所有权，不改变地点弹窗的原有皮肤。
    const POPUPS = { location: 'location-info-popup' };
    function anchorRect(anchor) {
        const box = anchor && typeof anchor === 'object' ? anchor : (viewport ? viewport.getBoundingClientRect() : null);
        const left = (box && box.left) || 0, top = (box && box.top) || 0, width = (box && box.width) || 0, height = (box && box.height) || 0;
        return { left, top, width, height, right: left + width, bottom: top + height };
    }
    function adoptPopup(kind, event, label) {
        const element = document.getElementById(POPUPS[kind]);
        if (!element) return null;
        closeMenu();
        element.classList.add('show', 'scene3d-menu');
        element.dataset.scene3dOwned = 'menu';
        element.setAttribute('role', 'dialog');
        if (label) element.setAttribute('aria-label', label);
        menu = { element, kind, epoch, place: currentLocation(), npcId: event.gameNpcId || null, anchor: anchorRect(event.anchor) };
        // Freeze the camera (stable anchor) but keep rendering so the golden
        // OutlinePass stays visible; interaction is re-locked by the scene-menu
        // block reason on the next apply.
        view?.setInteractionEnabled(false); notify('menu-open');
        return menu;
    }
    // NPC选框使用场景内坐标；共享地点弹窗为fixed，使用客户端坐标。
    function placeMenu() {
        if (!menu) return;
        if (menu.kind === 'npc') {
            const vp = viewport.getBoundingClientRect(), box = menu.anchor;
            const sx = viewport.clientWidth / Math.max(1, vp.width), sy = viewport.clientHeight / Math.max(1, vp.height);
            // Same ink ring as 2D, sized in the actual scene viewport (not browser vw).
            // Failed-image fallback buttons have no world card: retain a usable
            // action ring instead of shrinking it to the button's 24px height.
            const size = Math.min(Math.max(box.height * sy * 2.05, viewport.clientHeight * .60), viewport.clientHeight * .70, viewport.clientWidth * .88);
            const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
            const x = clamp((box.left + box.width / 2 - vp.left) * sx, size * .52, viewport.clientWidth - size * .52);
            const y = clamp((box.top + box.height / 2 - vp.top) * sy, size * .58, viewport.clientHeight - size * .58);
            menu.frame.style.width = size + 'px'; menu.frame.style.height = size + 'px';
            menu.frame.style.left = x + 'px'; menu.frame.style.top = y + 'px';
            menu.element.style.setProperty('--scene3d-ink-size', size + 'px');
            // Give the prose its own measured area, not a percentage-height scroller.
            // Widen first (especially on phones), then fit the complete text to 3 lines.
            const desc = menu.description;
            if (desc) {
                const font = Math.max(12, Math.min(20, size * .048)), pad = Math.max(5, Math.min(12, size * .035));
                const maxWidth = viewport.clientWidth * .88;
                let descWidth = Math.min(maxWidth, Math.max(size * .90, Array.from(desc.textContent).length * (font + .5) * 1.12 / 3 + pad * 2));
                desc.style.fontSize = font + 'px'; desc.style.padding = pad + 'px'; desc.style.width = descWidth + 'px';
                if (typeof getComputedStyle === 'function' && desc.scrollHeight) {
                    const tooTall = () => desc.scrollHeight > parseFloat(getComputedStyle(desc).lineHeight) * 3 + pad * 2 + 1;
                    while (tooTall() && descWidth < maxWidth) { descWidth = Math.min(maxWidth, descWidth + 8); desc.style.width = descWidth + 'px'; }
                    for (let smaller = font - .5; tooTall() && smaller >= 10; smaller -= .5) desc.style.fontSize = smaller + 'px';
                }
                const center = clamp(x + size * .10, descWidth / 2 + 4, viewport.clientWidth - descWidth / 2 - 4);
                const foot = (box.top + box.height - vp.top) * sy;
                const descHeight = desc.offsetHeight || (font * 1.4 * 3 + pad * 2);
                const top = Math.min(foot + Math.max(6, size * .035), viewport.clientHeight - descHeight - 5);
                desc.style.left = (center - x + size / 2) + 'px';
                desc.style.top = (top - y + size / 2) + 'px';
            }
            return;
        }
        const element = menu.element, rect = element.getBoundingClientRect(), box = menu.anchor;
        const vp = viewport ? viewport.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        const margin = 8;
        const minLeft = vp.left + margin, maxLeft = Math.max(minLeft, vp.right - margin - rect.width);
        const minTop = vp.top + margin, maxTop = Math.max(minTop, vp.bottom - margin - rect.height);
        const above = menu.kind === 'location';
        let left = box.left + box.width / 2 - rect.width / 2;
        let top = above ? box.top - rect.height - 10 : box.top + box.height / 2 - rect.height / 2;
        if (above && top < minTop) top = box.bottom + 10;
        element.style.left = Math.min(maxLeft, Math.max(minLeft, left)) + 'px';
        element.style.top = Math.min(maxTop, Math.max(minTop, top)) + 'px';
        element.style.transform = 'none';
    }
    function menuAction(owner, container, label, event, operation, disabled, className) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = !!disabled;
        if (className) button.className = className;
        if (disabled) button.classList.add('disabled');
        button.addEventListener('click', () => {
            // Menu opening itself changes the view revision; bind to its data epoch/identity instead.
            if (!menu || menu !== owner || menu.epoch !== epoch || menu.place !== currentLocation() || currentMode() !== 0 || !preferences.enabled || !last?.visible || overlayReasons(true).length) return;
            if (event.gameNpcId && !liveNpcAllowed(event.gameNpcId, currentLocation())) return;
            closeMenu();
            try { Promise.resolve(operation()).catch(error => warn('ACTION', error)); } catch (error) { warn('ACTION', error); }
        });
        container.append(button);
    }
    function showLocationInfoAtAnchor(locationId, anchor, event) {
        if (!Object.hasOwn(locations, locationId) || locationId === 'map') return;
        const captured = event || { epoch, revision, anchor };
        if (!intentAllowed(captured, false)) return;
        if (typeof showLocationInfo !== 'function' || typeof locationNames === 'undefined') return;
        // 直接调用 2D 那套函数：同一份 HTML（地点名 + 分割线 + 在场人物 + 前往按钮）
        // 与同一套定位逻辑，2D/3D 才是同一个弹窗。
        const box = anchorRect(anchor);
        closeMenu();
        showLocationInfo(locationId, { currentTarget: { getBoundingClientRect: () => box } });
        const element = document.getElementById(POPUPS.location);
        // The host function bails out (SLG mode / unknown name) without showing anything;
        // never adopt a popup it did not actually open.
        if (!element || !element.classList.contains('show')) return;
        const owner = adoptPopup('location', { ...captured, anchor }, locationNames[locationId]);
        // Only this 3D-owned opening changes the subset hint. Restore shared markup
        // on close; the host's next 2D opening still uses its untouched helper.
        if (owner && element.innerHTML.includes('人，随机显示3人）')) {
            owner.originalLocationHtml = element.innerHTML;
            element.innerHTML = element.innerHTML.replace('人，随机显示3人）', '人，全部显示）');
        }
    }
    function showNpcInfoAtAnchor(npcId, locationId, anchor, event) {
        const captured = event || { epoch, revision, gameNpcId: npcId, anchor };
        if (!intentAllowed(captured, false) || !liveNpcAllowed(npcId, locationId)) return;
        closeMenu();
        // A dedicated owned layer avoids the legacy popup's document-click closer
        // and hidden 2D portrait layout. Both UI themes use the original ink artwork.
        const element = document.createElement('div');
        element.className = 'npc-selection-overlay scene3d-npc-selection scene3d-menu show';
        element.dataset.scene3dOwned = 'menu'; element.dataset.npcId = npcId;
        element.setAttribute('role', 'dialog'); element.setAttribute('aria-label', npcs[npcId].name);
        const frame = document.createElement('div'); frame.className = 'npc-selection-frame options-left';
        const name = document.createElement('div'); name.className = 'npc-selection-name'; name.textContent = npcs[npcId].name;
        const description = document.createElement('div'); description.className = 'npc-selection-desc'; description.textContent = String(npcs[npcId].description || '').replace(/\s+/g, ' ').trim(); description.title = description.textContent;
        const actions = document.createElement('div'); actions.className = 'npc-selection-options';
        frame.append(name, description, actions); element.append(frame); viewport.append(element);
        const owner = menu = { element, frame, description, kind: 'npc', epoch, place: currentLocation(), npcId, anchor: anchorRect(anchor) };
        const canGift = !npcGiftGiven[npcId] && npcFavorability[npcId] <= 40 && playerStats.金钱 >= 500;
        const giftLabel = npcGiftGiven[npcId] ? '已送礼' : npcFavorability[npcId] > 40 ? '好感>40' : playerStats.金钱 < 500 ? '金钱不足' : '送礼';
        const actionEvent = { ...captured, gameNpcId: npcId };
        menuAction(owner, actions, giftLabel, actionEvent, () => giveGift(npcId), !canGift, 'npc-selection-option');
        menuAction(owner, actions, npcSparred[npcId] ? '已切磋' : '切磋', actionEvent, () => npcAction(npcId, '切磋'), npcSparred[npcId], 'npc-selection-option');
        menuAction(owner, actions, '互动', actionEvent, () => npcAction(npcId, '互动'), false, 'npc-selection-option');
        view?.setInteractionEnabled(false);
        placeMenu(); notify('menu-open');
    }
    function liveNpcAllowed(npcId, locationId) {
        return preferences.enabled && currentMode() === 0 && last?.visible && currentLocation() === locationId
            && document.querySelector('#main-viewport > .scene.active')?.id === locationId + '-scene'
            && Object.hasOwn(animated, npcId)
            && typeof npcs !== 'undefined' && !!npcs && Object.hasOwn(npcs, npcId) && !!npcs[npcId]
            && typeof currentNpcLocations !== 'undefined' && !!currentNpcLocations && Object.hasOwn(currentNpcLocations, npcId) && currentNpcLocations[npcId] === locationId
            && (typeof npcVisibility === 'undefined' || npcVisibility[npcId] !== false);
    }
    function onEvent(event) {
        // Context loss belongs to the renderer instance, not a business epoch.
        // During restoreHold the live renderer intentionally has the older epoch;
        // mount's token filter still rejects callbacks from destroyed instances.
        if (!last || (event.epoch !== epoch && !(event.type === 'error' && event.code === 'CONTEXT_LOST'))) return;
        if (event.type === 'ready') {
            // Events can arrive before applyState settles (or from cancelled loads).
            // Publication belongs exclusively to the versioned apply completion above.
            return;
        } else if (event.type === 'error') {
            if (event.code !== 'CONTEXT_LOST' && (event.revision !== revision || (event.sceneId && event.sceneId !== last.sceneId))) return;
            clearReady(); warn(event.code || 'RENDER', event.message || '场景显示失败');
            if (event.code === 'CONTEXT_LOST') { life++; destroyView().catch(error => warn('DESTROY', error)); }
        } else if (event.type === 'npcAnchor') {
            if (menu?.kind === 'npc' && menu.npcId === event.gameNpcId && menu.place === currentLocation()) { menu.anchor = anchorRect(event.anchor); placeMenu(); }
        } else if (event.type === 'actionIntent') {
            const action = hotspotActions[event.sceneId]?.[event.mesh];
            if (action && intentAllowed(event, false)) { closeMenu(); try { Promise.resolve(action()).catch(error => warn('ACTION', error)); } catch (error) { warn('ACTION', error); } }
        } else if (event.type === 'locationIntent') showLocationInfoAtAnchor(event.locationId, event.anchor, event);
        else if (event.type === 'npcIntent') showNpcInfoAtAnchor(event.gameNpcId, currentLocation(), event.anchor, event);
        else if (event.type === 'returnIntent' && intentAllowed(event, false)) backToMap();
    }
    function publishNpcs(locationId, ids) {
        displayed.set(locationId, Array.from(ids)); notify('npc-display');
    }
    function afterRestore(reason, preserveSpecial) {
        const active = document.querySelector('#main-viewport > .scene.active');
        const special = active && ['player-stats-scene', 'relationships-scene'].includes(active.id);
        const target = currentLocation() === 'tianshanpai' ? 'map' : currentLocation();
        // A page turn in flight (turn !== null) must not force an invalidate+hide:
        // the rendered scene is already applied and its canvas stays readable if we
        // simply cancel the covering/revealing sheet and hold the last frame. The
        // old !turn clause here was turning a routine mid-turn regenerate into a
        // blank viewport on phones.
        const keepFrame = reason === 'snapshot-restored' && preferences?.enabled && currentMode() === 0
            && Object.hasOwn(locations, target) && view && readyScene
            && (restoreHold || readyScene === locations[active?.id?.replace(/-scene$/, '')])
            && viewport?.dataset.scene3dReady === 'true' && !root.hidden;
        if (keepFrame) {
            abortTurn();
            life++; restoreHold = true;
            stopDrawing(false); closeMenu();
            if (notice) notice.hidden = true;
        } else invalidate(reason);
        epoch++; preciseTime = null;
        if (!(preserveSpecial && special) && Object.hasOwn(locations, target) && (active?.id !== target + '-scene' || active.classList.contains('slg-mode') !== (currentMode() === 1))) {
            document.querySelectorAll('#main-viewport > .scene').forEach(el => el.classList.remove('active', 'slg-mode'));
            const next = document.getElementById(target + '-scene');
            next?.classList.add('active');
            if (currentMode() === 1) next?.classList.add('slg-mode');
        }
        notify(reason || 'restored', true);
    }
    function captureTime(time) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(time));
        if (match && +match[1] < 24 && +match[2] < 60) preciseTime = { epoch, hour: +match[1] + +match[2] / 60 };
        notify('time');
    }
    function setBusy(token, enabled) {
        if (enabled) { busy.add(String(token)); closeMenu(); stopDrawing(false); } else busy.delete(String(token));
        notify('busy');
    }
    function setPreference(patch) {
        const next = { ...preferences, tuning: { ...preferences.tuning } };
        if ('enabled' in patch) next.enabled = !!patch.enabled;
        if (['low', 'balanced'].includes(patch.quality)) next.quality = patch.quality;
        if (patch.renderScale === null || [1, 1.25, 1.5, 2].includes(patch.renderScale)) next.renderScale = patch.renderScale;
        if ([2, 4].includes(patch.msaa)) next.msaa = patch.msaa;
        if (typeof patch.shadows === 'boolean') next.shadows = patch.shadows;
        if (typeof patch.atmosphere === 'boolean') next.atmosphere = patch.atmosphere;
        if (patch.tuning && typeof patch.tuning === 'object') for (const k of tuningKeys) if (Number.isFinite(patch.tuning[k])) next.tuning[k] = patch.tuning[k];
        const recreate = next.quality !== preferences.quality;
        const live = {};
        for (const k of ['renderScale', 'msaa', 'shadows', 'atmosphere']) if (next[k] !== preferences[k]) live[k] = next[k];
        if (tuningKeys.some(k => next.tuning[k] !== preferences.tuning[k])) live.tuning = next.tuning;
        preferences = next;
        try { localStorage.setItem(key, JSON.stringify({ ...preferences, schema: PREF_SCHEMA })); } catch (_) { /* Current-session preference still works. */ }
        if (!next.enabled || recreate) { life++; stopDrawing(true); closeMenu(); destroyView().then(() => notify('preference', true)).catch(error => warn('DESTROY', error)); }
        else { if (Object.keys(live).length && view) view.setSettings(live); notify('preference', true); }
    }
    function openSettings() {
        if (!started) return;
        closeMenu(); stopDrawing(false);
        // 3D settings live inside the host's game-settings modal, merged into the 通用设置 (switches) panel.
        if (typeof showGameSettings === 'function') {
            showGameSettings();
            if (typeof gsSelectTab === 'function') gsSelectTab('switches');
        }
        notify('settings-open');
    }
    async function retry() {
        if (!started || !preferences.enabled) return;
        notice.hidden = true;
        // Retrying the renderer directly could navigate to its old latest snapshot
        // while a new host route is still covering. Route retries through apply too.
        retryPending = true;
        notify('retry', true);
    }
    function start() {
        if (started) return;
        viewport = document.getElementById('main-viewport'); root = document.getElementById('sect-3d-root');
        if (!viewport || !root) return;
        started = true;
        preferences = defaultPreferences();
        // 画质固定「均衡」（后期/描边/阴影/氛围全开），不再按设备自动降级：桌面与移动端
        // 一律均衡，细节交给「游戏设置 → 3D画面」里的渲染分辨率、MSAA、阴影、氛围与调色。
        // 只有当前 schema 明确写下的画质才沿用——旧版本自动判断留下的低配值不是玩家选择，
        // 一律丢弃，免得统一到均衡之后又被旧存档拽回低配。
        preferences.quality = 'balanced';
        try {
            const stored = JSON.parse(localStorage.getItem(key) || 'null');
            if (stored) {
                preferences.enabled = stored.enabled === true;
                if (stored.schema === PREF_SCHEMA && ['low', 'balanced'].includes(stored.quality)) preferences.quality = stored.quality;
                if ([1, 1.25, 1.5, 2].includes(stored.renderScale)) preferences.renderScale = stored.renderScale;
                if ([2, 4].includes(stored.msaa)) preferences.msaa = stored.msaa;
                if (typeof stored.shadows === 'boolean') preferences.shadows = stored.shadows;
                if (typeof stored.atmosphere === 'boolean') preferences.atmosphere = stored.atmosphere;
                if (stored.tuning && typeof stored.tuning === 'object') for (const k of tuningKeys) if (Number.isFinite(stored.tuning[k])) preferences.tuning[k] = stored.tuning[k];
            }
        } catch (_) { /* Stored preference parse failure falls back to defaults. */ }
        notice = document.createElement('div'); notice.className = 'scene3d-notice'; notice.dataset.scene3dOwned = 'notice'; notice.hidden = true;
        notice.append(document.createTextNode(''));
        const retryButton = document.createElement('button'); retryButton.type = 'button'; retryButton.textContent = '重试3D'; retryButton.addEventListener('click', retry); notice.append(retryButton); viewport.append(notice);
        observer = new MutationObserver(records => {
            if (records.some(record => (record.target === menu?.element && ['class', 'hidden'].includes(record.attributeName)) || (!own(record.target) && !(record.target === viewport && record.attributeName === 'data-scene3d-ready')))) notify('ui');
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        document.addEventListener('visibilitychange', () => { if (document.hidden) { life++; stopDrawing(true); } notify('visibility', true); });
        addEventListener('pagehide', () => { life++; clearTimeout(unloadTimer); unloadTimer = null; destroyView().catch(error => warn('DESTROY', error)); });
        addEventListener('pageshow', () => notify('pageshow', true));
        addEventListener('resize', () => { view?.resize(); placeMenu(); notify('resize'); });
        addEventListener('scroll', event => { if (menu && !menu.element.contains(event.target)) closeMenu(true); }, true);
        document.addEventListener('pointerdown', event => { if (menu && !menu.element.contains(event.target)) closeMenu(true); }, true);
        document.addEventListener('keydown', event => { if (menu && event.key === 'Escape') { closeMenu(true); event.preventDefault(); } });
        notify('start', true);
    }
    window.GameSceneBridge = Object.freeze({ start, notify, invalidate, afterRestore, captureTime, publishNpcs, setBusy, setPreference, openSettings, retry, showNpcInfoAtAnchor, showLocationInfoAtAnchor,
        getDiagnostics() { return { started, epoch, revision, buildId: release?.buildId || null, readyScene, preferences: clone(preferences), counters: { ...counters }, snapshot: last ? clone(last) : null, errors: clone(errors), renderer: view?.getDiagnostics?.() || view?.getDebugState?.() || view?.debug || null }; } });
})();
