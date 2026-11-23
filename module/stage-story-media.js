/** Read-only playback of already published clips. Positions are UTF-16 source ranges, not text searches. */
const stageStoryMedia = (() => {
    function contains(blocks, frames, page, unit) {
        if (!page) return true; // full text of this record
        const body = frames.filter(f => !f.event);
        if (body.map(f => f.text).join('\n\n') !== blocks.map(b => b.text.trim()).join('\n\n')) return false;
        const frame = frames[page.frameIndex], block = blocks.find(b => b.sourceLine === unit.sourceLine);
        if (!block || frame.event || block.text.slice(unit.start,unit.end) !== unit.text) return false;
        const base = body.slice(0,body.indexOf(frame)).reduce((n,f) => n+f.text.length+2,0);
        const origin = blocks.slice(0,blocks.indexOf(block)).reduce((n,b) => n+b.text.trim().length+2,0) - (block.text.length-block.text.trimStart().length);
        return origin+unit.start >= base+page.start && origin+unit.end <= base+page.end;
    }
    function attach({signal,read}) {
        const button=document.getElementById('stage-voice'), status=document.getElementById('stage-media-status');
        button.dataset.label ??= button.title;
        let epoch=0, identity='', active=false;
        function stop() {
            epoch++; active=false; button.setAttribute('aria-pressed','false');button.setAttribute('aria-label',button.title=button.dataset.label);status.textContent='';
            if (speechPlayer.getState().view==='stage-reading') speechPlayer.stop();
        }
        function sync() {
            const v=read(), key=JSON.stringify([v.record?.id,v.source,v.page,v.enabled]);
            if (key!==identity) {stop();identity=key;}
            button.disabled=!v.enabled;
        }
        async function play() {
            if (active) {stop();return;}
            sync();const v=read();if (!v.enabled) return;
            const m=v.record,n=++epoch,ctx=mediaContext.capture();
            const valid=()=>epoch===n && !signal.aborted && !document.hidden && mediaContext.isCurrent(ctx);
            if (!m?.id || m.content!==v.source || storageService.loadUIConversation().filter(x=>x.id===m.id).length!==1) {status.textContent='这段没有本机录音';return;}
            active=true;button.setAttribute('aria-pressed','true');button.setAttribute('aria-label',button.title='停止播放');
            try {
                const fits=u=>contains(speechPlan.documentFor(m.content).blocks,v.plan?.frames||[],v.page,u);
                let clips=[];
                if (m.roundSpeech?.status==='ready' && m.presentationPlan) {
                    const plan=presentationPlan.validate(m.content,m.presentationPlan);
                    const binding=await speechRound.replay(m,plan,null);
                    clips=(binding?.units||[]).filter(fits).map(u=>({turnId:binding.turnId,unitId:u.id+'/0',load:()=>speechRound.clip(binding,u)}));
                } else if (m.singleSpeech) {
                    const characters=Object.entries(npcs).filter(([id])=>id!=='USER').map(([id,c])=>({id,name:c.name}));
                    const hit=await speechReplay.resolve({record:m,workspaceId:mediaContext.workspaceId(),characters});
                    if (hit && fits(hit.unit)) clips=[{turnId:hit.turnId,unitId:hit.unitId,load:()=>hit.clip.blob}];
                }
                if (!valid()) return;
                if (!clips.length) {stop();status.textContent=v.page?'没有对应这句的录音，可在全文中重听':'这段没有本机录音';return;}
                async function piece(i) {
                    if (!valid()) return;
                    if (!clips[i]) {stop();return;}
                    const c=clips[i];
                    try {await speechPlayer.play(c.load,{workspaceId:mediaContext.workspaceId(),view:'stage-reading',turnId:c.turnId,unitId:c.unitId},{onEnded:()=>piece(i+1)});}
                    catch(err) {if(valid()){stop();status.textContent=err.message;}}
                }
                await piece(0);
            } catch(err) {if(valid()){stop();status.textContent=err.message;}}
        }
        button.addEventListener('click',play,{signal});
        document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();},{signal});
        window.addEventListener('speech-cache-change',stop,{signal});
        signal.addEventListener('abort',stop,{once:true});
        return {sync,stop};
    }
    return {attach,contains};
})();
