/** Reading-unit playback of published M3 clips. Never advances the reader or prepares missing audio. */
var speechRoundPlayback=(function(){
    'use strict';var live=null;
    function attach(options){
        if(live)live.dispose();var parent=options.parent,signal=options.signal,ticket=0,disposed=false,muted=false,binding=null,identity='',selected=null;
        parent.hidden=true;parent.innerHTML='<button type="button" id="pr-round-play" aria-pressed="false">朗读本段</button><span id="pr-round-voice" role="status"></span>';
        var button=parent.querySelector('button'),label=parent.querySelector('span');
        function view(){return options.read();}
        function record(v){return storageService.loadUIConversation().find(function(m){return m&&m.id===v.messageId&&m.content===v.source;});}
        function stamp(v,m){return JSON.stringify([v.workspaceId,v.messageId,v.source,v.plan.planHash,v.index,m&&m.roundSpeech]);}
        function valid(n){
            if(disposed||signal.aborted||n!==ticket||!parent.isConnected||document.hidden)return false;
            var v=view(),m=record(v);return v.enabled&&v.workspaceId===mediaContext.workspaceId()&&stamp(v,m)===identity;
        }
        function stop(){ticket++;if(speechPlayer.getState().view==='round-reading')speechPlayer.stop();button.setAttribute('aria-pressed','false');button.textContent=muted?'朗读已暂停 · 点击恢复':'重播本段';}
        async function playPiece(at,n){
            if(!valid(n)||muted||!binding||at>=binding.units.length)return;
            var unit=binding.units[at];
            try{
                await speechPlayer.play(async function(){var blob=await speechRound.clip(binding,unit);if(!valid(n)||muted)throw new DOMException('阅读位置已变化','AbortError');return blob;},
                    {view:'round-reading',workspaceId:binding.workspaceId,turnId:binding.turnId,unitId:unit.id+'/0'},
                    {onEnded:function(){if(valid(n)&&!muted)playPiece(at+1,n);}});
            }catch(error){if(valid(n)){label.textContent=error.name==='NotAllowedError'?'点击朗读启用声音':'本段录音暂时不可用';button.textContent='朗读本段';button.setAttribute('aria-pressed','false');}}
        }
        async function update(autoplay){
            if(disposed||signal.aborted)return;var v=view(),m=record(v),next=stamp(v,m);
            if(!v.enabled){stop();return;}
            if(next===identity&&binding)return;
            stop();identity=next;binding=null;selected=m;parent.hidden=true;label.textContent='';button.disabled=false;if(options.label)options.label.textContent='无声阅读';
            if(!m||!m.roundSpeech||m.roundSpeech.status!=='ready'||storageService.loadUIConversation().filter(function(x){return x&&x.id===m.id;}).length!==1)return;
            var n=ticket;
            try{
                var result=await speechRound.replay(m,v.plan,v.index);if(!valid(n))return;
                binding=result;if(!binding||!binding.units.length)return;
                parent.hidden=false;if(options.label)options.label.textContent='剧情朗读';button.textContent=muted?'朗读已暂停 · 点击恢复':'朗读本段';
                if(autoplay&&!muted)playPiece(0,n);
            }catch(_){if(valid(n)){parent.hidden=false;button.disabled=true;label.textContent='本段录音不可用';}}
        }
        button.onclick=function(e){e.stopPropagation();if(!valid(ticket)||!binding)return;
            var state=speechPlayer.getState();
            if(state.view==='round-reading'&&['loading','playing'].includes(state.phase)){muted=true;stop();label.textContent='已暂停朗读';return;}
            muted=false;stop();button.disabled=false;playPiece(0,ticket);
        };
        var unsubscribe=speechPlayer.subscribe(function(state){
            if(disposed||!binding)return;var ours=state.view==='round-reading'&&state.workspaceId===binding.workspaceId&&state.turnId===binding.turnId;
            var unit=ours&&binding.units.find(function(u){return u.id+'/0'===state.unitId;});
            if(unit&&['loading','playing'].includes(state.phase)){button.textContent=state.phase==='loading'?'读取声音…':'停止朗读';button.setAttribute('aria-pressed','true');label.textContent=(npcs[unit.speakerId]&&npcs[unit.speakerId].name||unit.speakerId)+' · '+(state.phase==='playing'?'正在朗读':'准备播放');}
            else{button.setAttribute('aria-pressed','false');button.textContent=muted?'朗读已暂停 · 点击恢复':'重播本段';if(!ours||state.phase==='idle')label.textContent='';}
        });
        function hidden(){if(document.hidden)stop();}
        function cache(e){if(binding&&e.detail&&e.detail.workspaceId===binding.workspaceId){stop();binding=null;identity='';update(false);}}
        document.addEventListener('visibilitychange',hidden);window.addEventListener('speech-cache-change',cache);
        function dispose(){if(disposed)return;disposed=true;stop();unsubscribe();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('speech-cache-change',cache);parent.replaceChildren();parent.hidden=true;if(live===api)live=null;}
        var api={update:update,stop:stop,dispose:dispose};live=api;signal.addEventListener('abort',dispose,{once:true});return api;
    }
    return {attach:attach};
})();
