/** Borrow original inputs/events without cloning nodes or registering another business sender. */
var presentationControls=(function(){
    'use strict';var active=null;
    function attach(options){
        var freeTarget=options.freeTarget,eventTarget=options.eventTarget,signal=options.signal,onCommand=options.onCommand,context=options.context,disposed=false,composing=false;
        if(signal.aborted)return{refresh:function(){},dispose:function(){}};if(active)throw new Error('原行动控件已被借用');
        var row=document.querySelector('.free-action-row'),random=document.getElementById('random-event-container'),battle=document.getElementById('battle-event-container');
        if(!row||!random||!battle||!freeTarget||!eventTarget||typeof onCommand!=='function'||typeof context!=='function')throw new Error('缺少原行动节点或接口');
        var roots=[row,random,battle],records=[],listeners=[],targets=[freeTarget,eventTarget].map(function(n){return{node:n,hidden:n.hidden,inert:n.inert,forced:n.classList.contains('presentation-controls-forced')};});
        function listen(n,name,fn,capture){n.addEventListener(name,fn,capture);listeners.push(function(){n.removeEventListener(name,fn,capture);});}
        function available(n){return !disposed&&!signal.aborted&&n.isConnected&&(n===row?freeTarget:eventTarget).contains(n);}
        function command(e,n,id,args,button){e.preventDefault();e.stopImmediatePropagation();if(!available(n)||n.closest('[hidden],[inert]')||(button&&button.disabled))return;onCommand(id,args,context());}
        function freeClick(e){var b=e.target.closest('button');if(!b||!row.contains(b))return;if(b.id==='free-action-send-btn')command(e,row,'free',{},b);else if(b.id==='regenerate-btn')command(e,row,'regenerate',{},b);}
        function keydown(e){if(e.target.id!=='free-action-input'||e.key!=='Enter'||e.shiftKey)return;if(composing||e.isComposing||e.keyCode===229){e.stopImmediatePropagation();return;}command(e,row,'free',{},row.querySelector('#free-action-send-btn'));}
        function eventClick(e){var node=e.currentTarget,b=e.target.closest('button');if(!b||!node.contains(b))return;var rendered=node._presentationEvent;
            if(node===random){var at=Array.from(random.querySelectorAll('#event-options button')).indexOf(b);if(at<0)return;var indexes=['选项一','选项二','选项三'].map(function(k,i){return rendered&&rendered[k]?i+1:0;}).filter(Boolean);if(!indexes[at]){e.preventDefault();e.stopImmediatePropagation();return;}command(e,node,'event-option',{index:indexes[at],event:rendered},b);}
            else if(b.matches('.battle-action-btn.fight,.battle-action-btn.flee')){if(!rendered){e.preventDefault();e.stopImmediatePropagation();return;}command(e,node,b.classList.contains('fight')?'battle-start':'battle-flee',{event:rendered},b);}}
        function refresh(){if(disposed||signal.aborted)return;var hasBattle=!!currentBattleEvent,hasRandom=!hasBattle&&!!currentRandomEvent;random.hidden=!hasRandom;battle.hidden=!hasBattle;freeTarget.hidden=false;freeTarget.inert=false;freeTarget.classList.toggle('presentation-controls-forced',hasRandom||hasBattle);eventTarget.hidden=!hasRandom&&!hasBattle;eventTarget.inert=!hasRandom&&!hasBattle;}
        function dispose(){if(disposed)return;disposed=true;signal.removeEventListener('abort',dispose);listeners.forEach(function(remove){remove();});records.forEach(function(r){var parent=r.marker.parentNode||r.parent;parent.insertBefore(r.node,r.marker.parentNode?r.marker:(r.next&&r.next.parentNode===parent?r.next:null));r.marker.remove();r.node.inert=r.inert;r.node.hidden=r.hidden;r.node.classList.toggle('presentation-controls-event',r.eventClass);});targets.forEach(function(r){r.node.hidden=r.hidden;r.node.inert=r.inert;r.node.classList.toggle('presentation-controls-forced',r.forced);});if(active===api)active=null;}
        var api={refresh:refresh,dispose:dispose,owns:function(n){return !disposed&&!signal.aborted&&freeTarget.isConnected&&eventTarget.isConnected&&roots.includes(n);}};active=api;signal.addEventListener('abort',dispose,{once:true});
        try{roots.forEach(function(n){var marker=document.createComment('presentation-controls-home');records.push({node:n,marker:marker,parent:n.parentNode,next:n.nextSibling,hidden:n.hidden,inert:n.inert,eventClass:n.classList.contains('presentation-controls-event')});n.before(marker);(n===row?freeTarget:eventTarget).appendChild(n);n.inert=false;if(n!==row)n.classList.add('presentation-controls-event');listen(n,'click',function(e){e.stopPropagation();},false);});
            listen(row,'click',freeClick,true);listen(row,'keydown',keydown,true);listen(row,'compositionstart',function(e){if(e.target.id==='free-action-input')composing=true;},true);listen(row,'compositionend',function(e){if(e.target.id==='free-action-input')composing=false;},true);listen(random,'click',eventClick,true);listen(battle,'click',eventClick,true);refresh();return api;
        }catch(error){dispose();throw error;}
    }
    return{attach:attach,owns:function(n){return !!(active&&active.owns(n));},refresh:function(){if(active)active.refresh();}};
})();
