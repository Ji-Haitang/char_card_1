/** Reversible landscape host. It leases original DOM/curtain/locks, never commits or returns from SLG. */
var presentationHost = (function () {
    'use strict';
    var active=null,serial=0,LOCK='presentation-host';
    function bridge(){return window.GameSceneBridge;}
    function landscape(){return document.body.classList.contains('layout-landscape');}
    function same(op){return mediaContext.isCurrent(op.context)&&GameMode===op.mode&&currentStoryText===op.snapshot.sourceText;}
    function unchanged(op){return active===op&&same(op)&&landscape()&&!mediaContext.pendingChoice();}
    function stopAudio(){if(typeof speechService!=='undefined')speechService.stop();}
    function restorePosition(op){if(!same(op)||serial!==op.serial||active||mediaContext.isBusy())return;
        if(op.scroll.node&&op.scroll.node.isConnected){op.scroll.node.scrollTop=op.scroll.top;op.scroll.node.scrollLeft=op.scroll.left;}
        if(op.focus&&op.focus.isConnected&&!op.focus.closest('[inert]'))op.focus.focus({preventScroll:true});}
    function cleanup(op){if(op.cleaned)return;op.cleaned=true;op.controller.abort();if(op.observer)op.observer.disconnect();
        if(op.root)op.root.remove();document.body.classList.remove('presentation-host-active','presentation-host-mounted','presentation-operation');
        op.inert.forEach(function(r){r.node.inert=r.before;});if(op.dispose){var dispose=op.dispose;op.dispose=null;dispose();}}
    function release(op){if(active!==op)return;active=null;var b=bridge();if(b)b.setBusy(LOCK,false);}
    function invalidate(){var op=active;if(!op)return;if(typeof presentationFlow!=='undefined')presentationFlow.hostInvalidated();stopAudio();presentationAdapter.cancelCurtain(op);
        try{cleanup(op);}catch(error){console.warn('[PresentationHost] 清理失败:',error.message);}finally{presentationAdapter.release(op.display);release(op);}}
    function onStoryChange(text){if(active&&(text!==active.snapshot.sourceText||!same(active)))invalidate();}
    function syncUnderlay(op){if(active!==op)return;var blocked=!!(!op.operation||op.covered||op.overlayOpen);
        op.inert.forEach(function(r){if(!op.root?.contains(r.node)&&!r.node.classList.contains('presentation-host-overlay'))r.node.inert=blocked?true:r.before;});
        if(op.blocked!==blocked){op.blocked=blocked;var b=bridge();if(b)b.setBusy(LOCK,blocked);}}
    function setOperation(on,covered){var op=active;if(!op||op.phase!=='open'||!unchanged(op))return false;op.operation=!!on;op.covered=!!covered;op.root.dataset.operation=String(op.operation);op.root.setAttribute('aria-modal',String(!op.operation||op.covered));document.body.classList.toggle('presentation-operation',op.operation);syncUnderlay(op);return true;}
    function guard(options){
        if(!landscape())throw new Error('阅卷仅用于横屏');if(mediaContext.isBusy()||(typeof speechService!=='undefined'&&speechService.isBusy()))throw new Error('当前操作尚未结束');
        if(mediaContext.pendingChoice())throw new Error('请先在原界面处理支线抉择');
        if((currentRandomEvent||currentBattleEvent||inputEnable===0)&&!(options.allowEvents&&(currentRandomEvent||currentBattleEvent)))throw new Error('请先处理当前事件');
        if(isStoryExpanded&&storyHistoryOffset>0)throw new Error('请先返回当前正文');
        if(Array.from(document.querySelectorAll('.modal,[id$="-modal"]')).some(function(el){return !el.hidden&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';}))throw new Error('请先关闭原界面弹窗');
        var page=document.querySelector('.scene.active');if(page&&['player-stats-scene','relationships-scene'].includes(page.id))throw new Error('请先返回原业务场景');
        var b=bridge();if(b&&b.hasPendingApply&&b.hasPendingApply())throw new Error('原场景仍在切换');
    }
    function observeContext(op){op.observer=new MutationObserver(function(){
        if(active!==op)return;if(!same(op)||!landscape()){invalidate();return;}
        // Side-quest afterCommit can present a choice asynchronously without changing the story text.
        if(mediaContext.pendingChoice()){invalidate();if(typeof presentationFlow!=='undefined')presentationFlow.cancel();presentationAdapter.restoreCurrent();}
    });op.observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','style']});}
    async function enter(options){
        options=options||{};if(active)return false;guard(options);if(typeof options.mount!=='function')throw new Error('缺少舞台渲染器');
        var snapshot=options.snapshot||presentationView.captureCurrentReading();if(snapshot.workspaceId!==mediaContext.workspaceId()||snapshot.sourceText!==currentStoryText||!snapshot.frames.length)throw new Error('阅读快照已失效');
        var viewport=document.getElementById('main-viewport'),story=document.querySelector('.story-area');if(!viewport||!story)throw new Error('原游戏容器不可用');
        var scroller=story.querySelector('.story-content-wrapper');
        var op={context:mediaContext.capture(),mode:GameMode,snapshot:snapshot,serial:++serial,phase:'opening',controller:new AbortController(),root:null,dispose:null,display:null,focus:document.activeElement,onExit:options.onExit,onEscape:options.onEscape,
            scroll:{node:scroller,top:scroller?scroller.scrollTop:0,left:scroller?scroller.scrollLeft:0},inert:Array.from(viewport.children).concat(story).map(function(node){return{node:node,before:node.inert};})};
        active=op;stopAudio();var b=bridge();if(b)b.setBusy(LOCK,true);op.blocked=true;op.inert.forEach(function(r){r.node.inert=true;});document.body.classList.add('presentation-host-active');
        observeContext(op);
        try{
            op.display=await presentationAdapter.suspend();
            if(!unchanged(op)){presentationAdapter.release(op.display);if(active===op)invalidate();if(!active&&same(op))presentationAdapter.restoreCurrent();return false;}
            await presentationAdapter.curtain(true,op,'入卷');if(!unchanged(op)){if(active===op)invalidate();return false;}
            var root=document.createElement('section');root.id='presentation-host';root.tabIndex=-1;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','横屏阅读舞台');
            var content=document.createElement('div');content.id='presentation-host-content';root.appendChild(content);
            var close=document.createElement('button');close.type='button';close.id='presentation-host-close';close.textContent='返回正常界面';close.onclick=function(){exit().catch(function(e){console.warn('[PresentationHost]',e.message);});};root.appendChild(close);
            op.root=root;viewport.appendChild(root);document.body.classList.add('presentation-host-mounted');
            if(options.overlays)op.overlays=presentationOverlays.attach(root,op.controller.signal,function(on){op.overlayOpen=on;syncUnderlay(op);if(options.onOverlayChange)options.onOverlayChange(on);});
            var dispose=await options.mount(content,snapshot,{signal:op.controller.signal});
            if(!unchanged(op)){if(typeof dispose==='function')dispose();if(active===op)invalidate();return false;}
            if(typeof dispose==='function')op.dispose=dispose;
            await presentationAdapter.curtain(false,op);if(!unchanged(op)){if(active===op)invalidate();return false;}
            op.phase='open';root.focus({preventScroll:true});return true;
        }catch(error){if(active!==op)return false;var display=op.display;try{cleanup(op);}finally{release(op);presentationAdapter.resume(display);presentationAdapter.cancelCurtain(op);restorePosition(op);}throw error;}
    }
    async function exit(){
        var op=active;if(!op||op.phase==='closing')return false;if(typeof op.onExit==='function')op.onExit();
        if(op.phase==='opening'){var display=op.display;invalidate();if(display&&same(op))presentationAdapter.restoreCurrent();restorePosition(op);return true;}
        stopAudio();op.phase='closing';
        try{await presentationAdapter.curtain(true,op,'收卷');if(!unchanged(op)){if(active===op)invalidate();return false;}
            cleanup(op);release(op);presentationAdapter.resume(op.display);await presentationAdapter.curtain(false,op);return true;
        }finally{if(active===op){try{cleanup(op);}finally{release(op);presentationAdapter.resume(op.display);}}presentationAdapter.cancelCurtain(op);restorePosition(op);}
    }
    document.addEventListener('keydown',function(event){var op=active;if(!op)return;if(op.overlays&&op.overlays.handleKey(event))return;
        if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!(typeof op.onEscape==='function'&&op.onEscape()===true))exit().catch(function(){});return;}
        if(event.key!=='Tab'||!op.root||(op.operation&&!op.covered))return;
        var items=Array.from(op.root.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')).filter(function(el){return !el.disabled&&el.tabIndex>=0&&!el.hidden&&!el.closest('[inert]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';});
        var at=items.indexOf(document.activeElement);if(!items.length){event.preventDefault();op.root.focus();}else if(at<0||(!event.shiftKey&&at===items.length-1)||(event.shiftKey&&at===0)){event.preventDefault();items[event.shiftKey?items.length-1:0].focus();}
    },true);
    window.addEventListener('pagehide',invalidate);
    return{enter:enter,exit:exit,invalidate:invalidate,onStoryChange:onStoryChange,setOperation:setOperation,isActive:function(){return !!active;},hasOverlay:function(){return !!(active&&active.overlays&&active.overlays.hasOpen());},syncOverlays:function(){if(active&&active.overlays)active.overlays.sync();},getDiagnostics:function(){return{phase:active?active.phase:'closed',workspaceId:active&&active.snapshot.workspaceId,operation:!!(active&&active.operation)};}};
})();
