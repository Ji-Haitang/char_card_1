/** Lease existing panels and their focus; no cloned business DOM or second panel controller. */
var presentationOverlays=(function(){
    'use strict';
    var selector='.modal,[id$="-modal"],.scene3d-settings,.viewport-overlay,#player-stats-scene.active,#relationships-scene.active';
    function visible(n){return n&&!n.hidden&&n.getClientRects().length&&getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden';}
    function candidates(root){return Array.from(document.querySelectorAll(selector)).filter(function(n){return !root.contains(n)&&visible(n);});}
    function closeKnown(n){var names={modal:'closeModal','inventory-modal':'closeInventoryModal','equipment-modal':'closeEquipmentModal','trading-modal':'closeTrading','skill-library-modal':'closeSkillLibraryModal','skill-equipment-modal':'closeSkillEquipmentModal','game-settings-modal':'closeGameSettings','api-config-modal':'closeConfigModal','bounty-modal':'closeBountyModal','side-quest-modal':'closeSideQuestPanel','player-stats-scene':'backToMap','relationships-scene':'backToMap','music-modal':'closeMusicModal','font-modal':'closeFontModal','load-modal':'closeLoadModal','history-summary-modal':'closeHistorySummaryModal','pipeline-log-modal':'closePipelineLog'};
        var fn=names[n.id]&&window[names[n.id]];if(typeof fn==='function'){fn();return true;}return false;}
    function attach(root,signal,onChange){
        var records=new Map(),top=null,sequence=0,disposed=false,rootInert=root.inert;
        function restore(r){var n=r.node;n.inert=r.inert;n.classList.toggle('presentation-host-overlay',r.marked);if(r.z)n.style.setProperty('--presentation-overlay-z',r.z);else n.style.removeProperty('--presentation-overlay-z');if(r.tab===null)n.removeAttribute('tabindex');else n.setAttribute('tabindex',r.tab);if(r.marker){if(r.marker.parentNode)r.marker.parentNode.insertBefore(n,r.marker);r.marker.remove();r.marker=null;}}
        function controls(n){return Array.from(n.querySelectorAll('button,input,textarea,select,a[href],iframe,[tabindex="0"]')).filter(function(v){return !v.disabled&&v.tabIndex>=0&&!v.closest('[inert]')&&visible(v);});}
        function focus(n,preferred){if(preferred&&preferred.isConnected&&n.contains(preferred)&&!preferred.closest('[inert]')&&visible(preferred))preferred.focus({preventScroll:true});else(controls(n)[0]||n).focus({preventScroll:true});}
        function sync(){if(disposed||signal.aborted)return;var open=candidates(root),previous=top,prior=top&&records.get(top);
            records.forEach(function(r,n){if(!open.includes(n)){restore(r);records.delete(n);}});
            open.forEach(function(n){if(records.has(n))return;var r={node:n,inert:n.inert,marked:n.classList.contains('presentation-host-overlay'),z:n.style.getPropertyValue('--presentation-overlay-z'),tab:n.getAttribute('tabindex'),opener:document.activeElement,order:++sequence,marker:null};records.set(n,r);
                if(n.id==='modal'&&n.parentElement!==document.body){r.marker=document.createComment('presentation-modal-home');n.before(r.marker);document.body.appendChild(n);}n.classList.add('presentation-host-overlay');n.style.setProperty('--presentation-overlay-z',String(10000+r.order));if(r.tab===null)n.setAttribute('tabindex','-1');});
            top=open.slice().sort(function(a,b){return records.get(a).order-records.get(b).order;}).at(-1)||null;
            records.forEach(function(r,n){var inert=!!top&&n!==top&&!n.contains(top);if(n.inert!==inert)n.inert=inert;});if(root.inert!==!!top)root.inert=!!top;
            if(previous!==top){if(onChange)onChange(!!top);if(top)focus(top,prior&&prior.opener);else if(previous)focus(root,root.querySelector('#pr-menu-toggle'));}else if(top&&!top.contains(document.activeElement))focus(top);
        }
        var observer=new MutationObserver(function(changes){if(changes.some(function(c){return !root.contains(c.target);}))sync();});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden']});
        function handleKey(e){sync();if(!top)return false;if(e.key==='Escape'){if(closeKnown(top)){e.preventDefault();e.stopImmediatePropagation();sync();}return true;}
            if(e.key==='Tab'){var items=controls(top),i=items.indexOf(document.activeElement);if(!items.length){e.preventDefault();top.focus();}else if(i<0||(!e.shiftKey&&i===items.length-1)||(e.shiftKey&&i===0)){e.preventDefault();items[e.shiftKey?items.length-1:0].focus();}e.stopImmediatePropagation();}return true;}
        function dispose(){if(disposed)return;disposed=true;observer.disconnect();records.forEach(restore);records.clear();root.inert=rootInert;top=null;}
        signal.addEventListener('abort',dispose,{once:true});if(signal.aborted)dispose();else sync();return{sync:sync,hasOpen:function(){return !disposed&&candidates(root).length>0;},handleKey:handleKey,dispose:dispose};
    }
    return{attach:attach};
})();
