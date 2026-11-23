/** Display ranges only: never change the saved plan's units, cursor or frame text. */
const stageStory = (() => {
    'use strict';
    const terminal = /^[。！？!?]$/u, closer = /^[』”’）)\]】》〉"']$/u, punct = /^\p{P}$/u;
    const gap = /^(?:\s|<br\s*\/?\s*>)$/iu;
    function pagesFor(frames) {
        const pages = [];
        frames.forEach(({text}, frameIndex) => {
            // Token offsets are UTF-16 slice offsets; a surrogate pair or a <br> is indivisible.
            const tokens = Array.from(text.matchAll(/<br\s*\/?\s*>|[\s\S]/giu));
            let start = 0;
            while (start < tokens.length) {
                let end = start, inQuote = false, quotePunct = false;
                while (end < tokens.length) {
                    const ch = tokens[end++][0], next = tokens[end]?.[0];
                    if (ch === '「') { inQuote = true; quotePunct = false; continue; }
                    if (ch === '」') { const split = inQuote && quotePunct; inQuote = false; if (split) break; continue; }
                    if (inQuote) { if (punct.test(ch)) quotePunct = true; continue; }
                    if (terminal.test(ch) || (ch === '.' && (!next || gap.test(next) || closer.test(next))) ||
                        ((ch === '\n' || /^<br/i.test(ch)) && end > start + 1)) break;
                }
                while (end < tokens.length && (terminal.test(tokens[end][0]) || closer.test(tokens[end][0]))) end++;
                while (end < tokens.length && gap.test(tokens[end][0])) end++;
                pages.push({frameIndex, start:tokens[start].index, end:tokens[end]?.index ?? text.length});
                start = end;
            }
        });
        return pages;
    }

    const id = name => document.getElementById(name);
    const body = () => document.body;
    const area = () => document.querySelector('.story-area');
    const wrapper = () => area().querySelector('.story-content-wrapper');
    const landscape = () => body().classList.contains('layout-landscape');
    const hasFrames = () => slgModeData.some(f => !f.tail && (f.scene !== 'none' || f.cast?.length));
    const liveEvent = () => currentBattleEvent || currentRandomEvent || mediaContext.pendingChoice();
    const choice = () => liveEvent() || inputEnable === 0;
    const specialScene = () => document.querySelector('#player-stats-scene.active,#relationships-scene.active');
    const inputBlocked = () => choice() && !(id('free-action-send-btn').disabled && !id('regenerate-btn').disabled);
    let book = null, display = null, waiting = null;

    const canReturn = () => GameMode===0 && !choice() && !mediaContext.isBusy();
    function draw() {
        const {plan,pages,index} = book, page = pages[index];
        if (!page) return;
        const frame = plan.frames[page.frameIndex];
        if (display.frame !== frame || display.cg !== cgContentEnabled || !display.layer?.isConnected) {
            display.layer?.remove();
            display.layer = galPresentation.renderLayers(id('main-viewport'), frame, {mode:GameMode, missing:display.missing, portraitFallback:true,
                context:{...plan.world, frames:plan.frames, frameIndex:page.frameIndex, skin:display.skin, cgEnabled:cgContentEnabled}});
            display.layer.classList.add('stage-story-layers'); display.frame = frame; display.cg = cgContentEnabled;
        }
        const line = area().querySelector('.stage-line');
        line.querySelector('p').textContent = frame.text.slice(page.start,page.end).replace(/<br\s*\/?\s*>/gi,'\n').trim();
        const last=index===pages.length-1, next=line.lastElementChild;
        line.firstElementChild.disabled=index===0; next.disabled=last && !canReturn();
        next.dataset.forward ??= next.getAttribute('aria-label');
        next.setAttribute('aria-label',next.title=last && canReturn() ? id('stage-operation').title : next.dataset.forward);
    }
    function sync() {
        if (!display) {if (book && liveEvent() && !mediaContext.isBusy()) open();return;}
        const pending = !!liveEvent(), locked = !!choice();
        if (locked) {if (inputBlocked()) display.editing=false;body().classList.remove('stage-sight');display.fitInput();}
        const a = area(); a.classList.toggle('stage-full', isStoryExpanded); a.classList.toggle('stage-editing', display.editing);
        id('stage-full').hidden = !book.pages.length; id('stage-full').setAttribute('aria-expanded', String(isStoryExpanded));
        id('stage-event').hidden = !pending || storyHistoryOffset > 0;
        id('stage-event-tail').inert = !isStoryExpanded || storyHistoryOffset > 0;
        id('stage-view').disabled = id('stage-operation').disabled = locked;
        id('stage-input').disabled = !!inputBlocked() || storyHistoryOffset > 0; id('stage-input').setAttribute('aria-pressed', String(display.editing));
        for (const [name, on, alternate] of [['stage-full',isStoryExpanded,'收起'],['stage-input',display.editing,'正文']]) {
            const button=id(name); button.dataset.caption ??= button.title;
            button.setAttribute('aria-label',button.title=on ? alternate : button.dataset.caption);
        }
        id('stage-operation').hidden = GameMode !== 0;
        a.querySelector('.stage-count').textContent = display.editing ? '' : isStoryExpanded ? id('story-history-page-input').value : `${book.index+1} / ${book.pages.length}`;
        if (display.history !== storyHistoryOffset) { wrapper().scrollTop = 0; display.history = storyHistoryOffset; }
        wrapper().onclick = null; // full text scrolls/selects; only its original arrows navigate history
        draw();
        display.media?.sync();
    }
    function relocate(node,parent) {
        const marker = document.createComment('stage-home'); node.before(marker); parent.appendChild(node);
        return () => marker.replaceWith(node);
    }
    function unmount() {
        if (!display) return;
        const d = display; display = null;
        for (const node of [...id('stage-event-tail').children]) {node.classList.remove('show');id('main-viewport').appendChild(node);}
        toggleViewportDock(false); d.events.abort(); d.layer?.remove(); d.homeTask(); d.homeDock(); d.homeArea();
        for (const node of d.underlay) node.inert = false;
        area().classList.remove('stage-bubble','stage-full','stage-editing');
        body().classList.remove('stage-reading','stage-sight');
        body().style.removeProperty('--stage-height'); body().style.removeProperty('--stage-top');
        presentationAdapter.release(d.lease);
    }
    // Only art and plain prose are frozen. No actions, event cards, drafts, audio or save fields.
    function captureWaitView() {
        if (!landscape()) return null;
        const view=document.createElement('div');view.className='stage-wait-view';
        const page=book?.pages[book.index];
        if (display?.layer) {
            const art=display.layer.cloneNode(true);art.setAttribute('aria-hidden','true');view.append(art);
        }
        const text=document.createElement('div');text.className='stage-wait-prose';
        const full=display ? isStoryExpanded : book?.full;
        let prose=text;
        if (page && !full) {
            // Browse a private text cursor; keep the pre-send artwork, save cursor and actions frozen.
            const {plan,pages}=book;let index=book.index;
            prose=document.createElement('div');prose.className='stage-wait-pages';
            const arrow=(delta,label,glyph)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);b.textContent=glyph;b.onclick=()=>turn(delta);return b;};
            const prev=arrow(-1,'上一句','‹'),next=arrow(1,'下一句','›');
            function turn(delta){index=Math.max(0,Math.min(pages.length-1,index+delta));const p=pages[index];text.textContent=plan.frames[p.frameIndex].text.slice(p.start,p.end).replace(/<br\s*\/?\s*>/gi,'\n').trim();text.scrollTop=0;prev.disabled=index===0;next.disabled=index===pages.length-1;}
            text.onclick=e=>{if(window.getSelection().isCollapsed){const r=text.getBoundingClientRect();turn(e.clientX<r.left+r.width/2?-1:1);}};
            prose.append(prev,text,next);turn(0);
        } else text.textContent=id('story-text').innerText.trim();
        return {view,text,prose,scroll:full ? (display?.editing ? display.readScroll : wrapper().scrollTop) : 0};
    }
    function clearWait() {
        if (!waiting) return;
        waiting.preview?.view.remove();waiting.home?.();waiting.footer?.remove();waiting=null;body().classList.remove('stage-turn-wait');
    }
    function beginWait(preview=captureWaitView()) {
        const previous=book, inOperation=!!book && !display; reset();
        waiting={context:mediaContext.capture(),previous,inOperation,preview,home:null};
        fitWait();return waiting;
    }
    function fitWait() {
        if (!waiting) return;
        const on=landscape(), mask=id('stream-mask'), preview=waiting.preview;
        body().classList.toggle('stage-turn-wait',on);
        if (on && !waiting.home) {
            if (preview) mask.prepend(preview.view);
            const footer=document.createElement('div');footer.className='stage-wait-footer';
            mask.append(footer);waiting.footer=footer;
            waiting.home=relocate(id('stream-controls'),footer);
            if (preview?.text.textContent) {footer.append(preview.prose);preview.text.scrollTop=preview.scroll || 0;}
        } else if (!on && waiting.home) {
            preview?.view.remove();waiting.home();waiting.home=null;waiting.footer.remove();waiting.footer=null;
        }
    }
    function endWait(ticket, receipt) {
        if (waiting!==ticket) return;
        clearWait();
        if (!mediaContext.isCurrent(ticket.context) || !landscape()) return;
        if (!receipt && ticket.previous && ticket.previous.source===currentStoryText && ticket.previous.mode===GameMode) book=ticket.previous;
        if (book && ticket.inOperation) { body().classList.add('stage-operation');return; }
        if (!open()) reset();
    }
    function reset() {
        clearWait();
        if (!book) return;
        unmount(); book = null; body().classList.remove('stage-operation');
        storyHistoryOffset = 0;
    }
    function open() {
        if (display || !landscape() || specialScene() || waiting || mediaContext.isBusy()) return false;
        try {
            if (!book) {
                let saved=null, plan = null, pages = [], index = 0;
                if (currentStoryText && hasFrames()) {
                    saved = presentationPlan.current(); plan = saved.status === 'ready' ? saved.plan : presentationPlan.captureCurrent(currentStoryText,'initial-state');
                    pages = pagesFor(plan.frames);
                    const unit = plan.units[saved.status==='ready' ? saved.unitIndex : presentationPlan.unitForPage(plan,storySpeechPages,currentPage)];
                    if (unit) index = Math.max(0,pages.findIndex(p => p.frameIndex === unit.frameIndex && p.end > unit.start));
                }
                book = {saved, context:mediaContext.capture(), source:currentStoryText, mode:GameMode, plan, pages, index, full:!pages.length, history:0, scroll:0};
            }
            const a = area(), stage = id('main-viewport');
            const skin = presentationAdapter.pixelMode(GameMode) ? 'pixel' : 'normal';
            const lease = presentationAdapter.claim();
            display = {lease,skin,missing:new Set(), editing:false, events:new AbortController(), homeArea:relocate(a,stage),homeDock:relocate(id('viewport-dock-layer'),id('stage-menu-slot')),homeTask:relocate(id('viewport-task-btn'),id('stage-task-slot'))};
            // Scene controls must not receive Tab/Enter behind the bubble; leave dialogs and the original dock live.
            display.underlay = [...stage.querySelectorAll(':scope > .scene:not([inert]), :scope > #sect-3d-root:not([inert])')];
            for (const node of display.underlay) node.inert = true;
            const signal = display.events.signal;
            const tail=id('stage-event-tail');
            tail.addEventListener('click',e=>{if (tail.inert || !e.target.closest('.show') || mediaContext.isBusy()) {e.preventDefault();e.stopImmediatePropagation();}}, {signal,capture:true});
            document.addEventListener('click',e=>{if (e.target.closest('#viewport-dock-layer, #viewport-task-btn, [role=dialog], .modal')) display.media?.stop();},{signal,capture:true});
            body().classList.add('stage-reading'); body().classList.remove('stage-operation'); a.classList.add('stage-bubble');
            const line = a.querySelector('.stage-line');
            const font = getComputedStyle(id('story-text'));
            line.style.fontFamily = font.fontFamily;
            line.style.setProperty('--story-font-size',font.fontSize);
            line.addEventListener('click', e => {
                if (e.target.closest('button') || !window.getSelection().isCollapsed) return;
                const r = line.getBoundingClientRect(); step(e.clientX < r.left+r.width/2 ? -1 : 1);
            }, {signal});
            function fitInput() {
                const vv = window.visualViewport;
                if (display.editing && vv) {body().style.setProperty('--stage-height',`${vv.height}px`);body().style.setProperty('--stage-top',`${vv.offsetTop}px`);}
                else {body().style.removeProperty('--stage-height');body().style.removeProperty('--stage-top');}
            }
            display.fitInput=fitInput; window.visualViewport?.addEventListener('resize',fitInput,{signal});window.visualViewport?.addEventListener('scroll',fitInput,{signal});
            display.media=stageStoryMedia.attach({signal,read:()=>{
                const record=_getAssistantTurns().at(-1-storyHistoryOffset);
                return {record,source:storyHistoryOffset?record?.content:book.source,plan:book.plan,page:isStoryExpanded?null:book.pages[book.index],enabled:!display.editing && !mediaContext.isBusy()};
            }});
            if (book.pages.length) currentPage=book.pages[book.index].frameIndex;
            isStoryExpanded = book.full; storyHistoryOffset = book.history; updateStoryDisplay(); wrapper().scrollTop = book.scroll;
            // A curtain queued by the original renderer before the claim may finish clearing its layers later.
            galPresentation.whenSettled().then(() => { if (!signal.aborted && display.layer && !display.layer.isConnected) draw(); });
            if (typeof speechService !== 'undefined') speechService.stop();
            return true;
        } catch (error) { reset(); const el=document.createElement('span');el.textContent=error.message;showModal(el.innerHTML);return false; }
    }
    function step(delta) {
        if (!display || display.editing || isStoryExpanded || mediaContext.isBusy()) return;
        const target = book.index + delta;
        if (!book.pages[target]) {if (delta===1 && target===book.pages.length) operation();return;}
        go(target);
        area().querySelector('.stage-line p').scrollTop=0;
    }
    function go(index) {
        const page=book.pages[index];book.index=index;currentPage=page.frameIndex;
        if (book.saved?.status==='ready') {
            const unitIndex=book.plan.units.findIndex(u=>u.frameIndex===page.frameIndex && u.end>page.start);
            presentationPlan.setCursor({...book.saved,context:book.context,sourceHash:book.plan.sourceHash,planHash:book.plan.planHash,unitIndex});
        }
        sync();
    }
    function toggleFull() {
        if (!display || !book.pages.length || mediaContext.isBusy()) return;
        display.editing=false;display.fitInput();doToggleStoryExpand();wrapper().scrollTop=0;
    }
    function showEvent() {
        if (!display || !liveEvent() || storyHistoryOffset || mediaContext.isBusy()) return;
        if (display.editing) {display.editing=false;display.fitInput();sync();}
        if (!isStoryExpanded) toggleFull();
        const card=id('stage-event-tail').querySelector('.show'), scroll=wrapper();
        if (card) scroll.scrollTop+=card.getBoundingClientRect().top-scroll.getBoundingClientRect().top;
    }
    function toggleInput() {
        if (!display || storyHistoryOffset || inputBlocked() || mediaContext.isBusy()) return;
        if (!display.editing) display.readScroll=wrapper().scrollTop;
        display.editing=!display.editing;sync();display.fitInput();
        if (display.editing) (id('free-action-input').disabled?id('regenerate-btn'):id('free-action-input')).focus(); else id('stage-input').focus();
    }
    function sightsee() {
        if (!display || choice() || mediaContext.isBusy()) return;
        display.media.stop();toggleViewportDock(false);body().classList.add('stage-sight');id('stage-backdrop').focus({preventScroll:true});
    }
    function background() {
        if (body().classList.contains('stage-sight')) {body().classList.remove('stage-sight');id('stage-view').focus({preventScroll:true});}
        else if (GameMode===0 && !isStoryExpanded && !display?.editing) operation();
    }
    function operation() {
        if (!display || !canReturn()) return;
        park();id('stage-book').focus({preventScroll:true});
    }
    function park() {
        book.full=isStoryExpanded;book.history=storyHistoryOffset;book.scroll=wrapper().scrollTop;
        unmount();body().classList.add('stage-operation');
    }
    // An explicit GM0 exit parks the book; refreshing the same text must not steal the map.
    function beforeDisplay() {
        if (book && (book.mode!==GameMode || book.source!==currentStoryText)) reset();
        return !book && open();
    }
    function sceneChanged() {
        if (specialScene() && display) {park();book.resumeAfterPanel=true;}
        else if (!specialScene() && book?.resumeAfterPanel) {delete book.resumeAfterPanel;open();}
    }
    return Object.freeze({pagesFor,open,reset,sync,fitWait,captureWaitView,sceneChanged,beginWait,endWait,isWaiting:()=>!!waiting,beforeDisplay,step,toggleFull,showEvent,toggleInput,sightsee,background,operation,sentence:()=>display?book.index:null, reading:()=>!!display, engaged:()=>!!book});
})();
