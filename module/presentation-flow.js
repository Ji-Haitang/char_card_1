/** A presentation lease across the original request/commit. It never settles, retries, or aborts business. */
var presentationFlow=(function(){
    'use strict';var desired=null,waiting=null,sequence=0;
    function landscape(){return document.body.classList.contains('layout-landscape');}
    function bind(){desired={context:mediaContext.capture(),epoch:++sequence};}
    function valid(t){return !!(t&&waiting===t&&desired&&desired.epoch===t.epoch&&mediaContext.isCurrent(t.context)&&landscape());}
    function cleanup(t){if(!t||t.cleaned)return;t.cleaned=true;clearTimeout(t.timer);cancelAnimationFrame(t.raf||0);t.controller.abort();if(t.observer)t.observer.disconnect();
        if(t.marker&&t.marker.parentNode)t.marker.parentNode.insertBefore(t.controls,t.marker);if(t.marker)t.marker.remove();if(t.extra)t.extra.remove();
        t.inert.forEach(function(r){r.node.inert=r.before;});document.body.classList.remove('presentation-wait-active');
        if(t.mask){t.mask.removeAttribute('data-presentation-wait');t.mask.inert=t.maskInert;}if(waiting===t)waiting=null;}
    function cancel(){desired=null;sequence++;cleanup(waiting);}
    function returnToOriginal(){cancel();presentationAdapter.restoreCurrent();}
    function begin(dismissSending){
        if(!landscape()||mediaContext.pendingChoice())return null;
        if(waiting&&valid(waiting))return waiting;if(waiting)cancel();
        if(!desired||!mediaContext.isCurrent(desired.context))bind();if(dismissSending)closeModal();desired.epoch=++sequence;
        var t={context:mediaContext.capture(),owner:mediaContext.workspaceId(),epoch:desired.epoch,controller:new AbortController(),inert:[],phase:'waiting',started:false,receipt:null,wantReader:true};waiting=t;
        presentationHost.invalidate();
        var viewport=document.getElementById('main-viewport'),mask=document.getElementById('stream-mask'),controls=document.getElementById('stream-controls');
        if(!viewport||!mask||!controls){cancel();return null;}
        document.body.classList.add('presentation-wait-active');if(typeof pipeline.showPresentationWait==='function')pipeline.showPresentationWait();
        t.mask=mask;t.maskInert=mask.inert;mask.inert=false;mask.dataset.presentationWait='waiting';
        Array.from(viewport.children).concat([document.querySelector('.story-area')]).forEach(function(n){if(!n||n===mask||n.classList.contains('scene3d-page-turn'))return;t.inert.push({node:n,before:n.inert});n.inert=true;});
        t.controls=controls;t.marker=document.createComment('presentation-stop-home');controls.before(t.marker);mask.appendChild(controls);
        var extra=document.createElement('div');extra.id='presentation-wait-extra';var note=document.createElement('p');note.textContent='沿原流程处理；停止仅在原请求可取消时生效。';
        var leave=document.createElement('button');leave.type='button';leave.textContent='完成后返回正常界面';leave.onclick=function(){t.wantReader=false;leave.disabled=true;note.textContent='本轮结束后返回；需要中断时请使用原停止按钮。';};extra.append(note,leave);mask.appendChild(extra);t.extra=extra;t.note=note;
        t.overlays=presentationOverlays.attach(mask,t.controller.signal,function(){tryResume(t);});
        t.observer=new MutationObserver(function(){if(!valid(t)){cleanup(t);return;}if(mediaContext.pendingChoice())returnToOriginal();});
        t.observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
        return t;
    }
    function pipelineStart(){var t=begin(false);if(t&&t.started){var wanted=t.wantReader;cleanup(t);t=begin(false);if(t)t.wantReader=wanted;}if(t)t.started=true;return t;}
    function tryResume(t){
        if(!valid(t)){if(waiting===t)cancel();return;}if(mediaContext.pendingChoice()){returnToOriginal();return;}
        if(t.phase!=='ready'||t.reopening)return;
        if(mediaContext.isBusy()||presentationActions.isDispatching()||t.overlays.hasOpen()||(window.GameSceneBridge&&GameSceneBridge.hasPendingApply())){
            if(performance.now()>t.deadline){returnToOriginal();return;}cancelAnimationFrame(t.raf||0);t.raf=requestAnimationFrame(function(){tryResume(t);});return;
        }
        var current=presentationPlan.current(),receipt=t.receipt;
        if(!receipt||current.status!=='ready'||current.workspaceId!==receipt.workspaceId||current.messageId!==receipt.messageId||current.plan.sourceHash!==receipt.sourceHash){returnToOriginal();return;}
        if(!t.wantReader){returnToOriginal();return;}t.reopening=true;cleanup(t);
        presentationReader.open({resumeOriginal:true}).then(function(opened){if(!opened&&desired&&desired.epoch===t.epoch)returnToOriginal();}).catch(function(error){console.warn('[PresentationFlow]',error.message);returnToOriginal();});
    }
    // The publisher calls this only after its complete afterCommit/side-quest work has settled.
    function pipelineEnd(t,receipt){if(!valid(t)){if(waiting===t)cancel();return;}t.receipt=receipt;
        t.timer=setTimeout(function(){if(!valid(t)){if(waiting===t)cancel();return;}if(!receipt||mediaContext.pendingChoice()){returnToOriginal();return;}
            t.phase='ready';t.deadline=performance.now()+15000;t.mask.dataset.presentationWait='ready';t.note.textContent='本轮已完成；关闭原提示后继续阅读。';tryResume(t);
        },0);
    }
    function outerSettled(t){if(valid(t)&&!t.started){if(typeof pipeline.hidePresentationWait==='function')pipeline.hidePresentationWait();returnToOriginal();}}
    document.addEventListener('keydown',function(e){if(!waiting)return;if(waiting.overlays&&waiting.overlays.handleKey(e))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();waiting.wantReader=false;waiting.note.textContent='本轮结束后返回；需要中断时请使用原停止按钮。';}},true);
    window.addEventListener('pagehide',cancel);
    return{bind:bind,begin:begin,pipelineStart:pipelineStart,pipelineEnd:pipelineEnd,outerSettled:outerSettled,cancel:cancel,hostInvalidated:function(){if(!waiting)cancel();},afterAction:function(){if(waiting)tryResume(waiting);},isWaiting:function(){return !!waiting;},getDiagnostics:function(){return{desired:!!desired,waiting:!!waiting,phase:waiting&&waiting.phase,owner:waiting&&waiting.owner};}};
})();
