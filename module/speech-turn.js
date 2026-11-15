/** Game-facing speech coordination. The supplied commit callback owns all gameplay side effects. */
var speechTurn = (function(){
    'use strict';
    var active=null;
    var COMPLETE=['stop','STOP','end_turn','tool_calls'];
    function assertContext(ctx){if(!ctx||!mediaContext.isCurrent(ctx.context)||ctx.controller.signal.aborted)throw new DOMException('本轮语音准备已取消','AbortError');}
    function cancel(){if(active)active.controller.abort();speechService.stop();}
    function progressReason(){
        var state=speechRound.pendingState();
        if(!state.ready)return '正在读取本机声音待办，请稍后再行动；游戏设置仍可打开。';
        if(!state.pending)return '';
        return state.phase==='committing'?'声音待办的提交状态待核对，请先到游戏设置 → 语音配置检查已发布状态，暂不能开始新行动。'
            :'请先处理声音待办：在游戏设置 → 语音配置中继续准备、本轮无声继续或放弃待办，再进行新行动。';
    }
    function guardProgress(){
        var reason=progressReason();if(!reason)return true;
        if(typeof showModal==='function')showModal(reason);
        return false;
    }
    async function begin(){
        var context=mediaContext.capture(),workspaceId=mediaContext.workspaceId();
        var pending;
        try{pending=await speechRound.load(workspaceId);}
        catch(_){
            if(!mediaContext.isCurrent(context))throw new DOMException('游戏上下文已变更','AbortError');
            if(speechRound.pendingState().pending)throw new Error(progressReason());
            console.warn('[Speech] 本机语音状态暂不可读，本轮继续正文流程');return null;
        }
        if(speechRound.pending(pending))throw new Error('本机还有待发布的语音正文，请先在语音配置中处理');
        var round=await speechRound.context(workspaceId),single=null;
        if(!round)try{single=await speechStore.getSetting('single-test:'+workspaceId);}catch(_){single=null;}
        if(!mediaContext.isCurrent(context))throw new DOMException('游戏上下文已变更','AbortError');
        if(!round&&!(single&&single.provider==='fish-drama3'&&single.enabled===true&&single.targetNpcId!=='USER'&&npcs[single.targetNpcId]))return null;
        var ctx={kind:round?'round':'single',workspaceId:workspaceId,context:context,controller:new AbortController(),
            round:round,targetNpcId:single&&single.targetNpcId,finishReason:null};active=ctx;return ctx;
    }
    function release(ctx){if(active===ctx)active=null;}
    function instruction(ctx){
        if(!ctx)return '';
        return ctx.kind==='round'?speechRoundPlan.instruction(speechRound.characters()):speechPlan.singleInstruction({id:ctx.targetNpcId,name:npcs[ctx.targetNpcId].name});
    }
    async function singlePlan(text,ctx){
        var plan=await speechPlan.fromMainText(text,speechRound.characters());assertContext(ctx);
        if(!COMPLETE.includes(ctx.finishReason))plan.issues.push({reason:'completion-not-confirmed'});
        return Object.assign(plan,{targetNpcId:ctx.targetNpcId,finishReason:ctx.finishReason,renderVersion:'drama3-v1'});
    }
    function envelope(raw){
        var parsed=responseParser.run(raw);
        if(!parsed.mainText||!parsed.summaries||!parsed.summaries.length||parsed.sideNote===null)throw new Error('本轮正文格式不完整，未进入语音提交');
        return parsed;
    }
    function evidence(draft){return storageService.loadUIConversation().filter(function(m){return m&&m.roundSpeech&&m.roundSpeech.draftId===draft.id;});}
    async function publish(draft,ctx,options,commit,status){
        options=options||{};assertContext(ctx);
        var previous=evidence(draft);
        if(previous.length){
            if(previous.length!==1||previous[0].content!==draft.input.mainText)throw new Error('待办发布记录需要核对');
            await speechRound.update(draft,{phase:'published'});return true;
        }
        await speechRound.assertCurrent(draft,ctx.controller.signal);assertContext(ctx);
        var commitStarted=false;
        try{
            if(options.silent)draft=await speechRound.update(draft,{silent:true,phase:'ready'});
            while(!draft.silent){
                assertContext(ctx);if(status)status('准备本轮声音…');
                try{
                    draft=await speechRound.prepare(draft,{signal:ctx.controller.signal,adoptSettings:options.adoptSettings,
                        onProgress:function(done,total){if(status)status('声音准备 '+done+' / '+total);}});
                    assertContext(ctx);break;
                }catch(error){
                    assertContext(ctx);options.adoptSettings=null;
                    draft=await speechRound.update(draft,{phase:'paused',error:String(error.message||error).slice(0,300)});
                    var choice=await speechRoundUI.decision(draft,error,ctx.controller.signal);assertContext(ctx);
                    if(choice==='pause')return false;
                    if(choice==='silent'){draft=await speechRound.update(draft,{silent:true,phase:'ready'});break;}
                }
            }
            await speechRound.assertCurrent(draft,ctx.controller.signal);assertContext(ctx);
            draft=await speechRound.update(draft,{phase:'committing'});assertContext(ctx);commitStarted=true;
            var success=await commit(draft.input.preprocessed,draft.input.rawText,draft.input.isRegenerate,
                {mainText:draft.input.mainText,readingPlan:draft.readingPlan,roundSpeech:speechRound.record(draft)});
            assertContext(ctx);
            var saved=evidence(draft);
            if(saved.length!==1||saved[0].content!==draft.input.mainText)throw new Error('本轮提交结果需要核对');
            await speechRound.update(draft,{phase:'published'});
            return success;
        }catch(error){
            if(!commitStarted&&mediaContext.isCurrent(ctx.context)){
                var current=await speechRound.load(ctx.workspaceId);
                if(current&&current.id===draft.id&&speechRound.pending(current)&&current.phase!=='committing')
                    await speechRound.update(current,{phase:'paused',error:String(error.message||error).slice(0,300)});
            }
            if(error.name==='AbortError')return false;
            throw error;
        }
    }
    async function finish(ctx,preprocessed,rawText,isRegenerate,commit,status){
        if(!ctx)return commit(preprocessed,rawText,isRegenerate);
        assertContext(ctx);
        var parsed=ctx.kind==='round'?envelope(rawText):responseParser.run(rawText);
        if(ctx.kind==='single'){
            var single=await singlePlan(parsed.mainText,ctx);
            return commit(preprocessed,rawText,isRegenerate,{mainText:single.source,singleSpeech:single});
        }
        ctx.round.finishReason=ctx.finishReason;
        var clean=await speechPlan.fromMainText(parsed.mainText,speechRound.characters());assertContext(ctx);
        var reading=presentationPlan.validate(clean.source,presentationPlan.captureCurrent(clean.source,'committed',''));
        var plan=await speechRoundPlan.compile(parsed.mainText,speechRound.characters(),{finishReason:ctx.finishReason,readingPlan:reading,
            maxChars:ctx.round.maxChars,maxClips:ctx.round.maxClips});assertContext(ctx);
        if(typeof summaryRunner!=='undefined'&&summaryRunner.isRunning())summaryRunner.cancel();
        if(typeof eventRunner!=='undefined'&&eventRunner.cancel)eventRunner.cancel();
        if(typeof locationRunner!=='undefined'&&locationRunner.cancel)locationRunner.cancel();
        var draft=await speechRound.create({preprocessed:preprocessed,rawText:rawText,rawSource:parsed.mainText,mainText:plan.source,
            isRegenerate:isRegenerate,readingPlan:reading,plan:plan},ctx.round,ctx.controller.signal);assertContext(ctx);
        return publish(draft,ctx,{},commit,status);
    }
    async function resume(id,options,commit,status){
        var ctx={kind:'round',workspaceId:mediaContext.workspaceId(),context:mediaContext.capture(),controller:new AbortController()};active=ctx;
        try{return await speechRound.withLease(ctx.workspaceId,async function(){
            var draft=await speechRound.load(ctx.workspaceId);assertContext(ctx);
            if(!draft||draft.id!==id)throw new Error('这份语音待办已失效');
            return publish(draft,ctx,options,commit,status);
        });}finally{release(ctx);}
    }
    return {begin:begin,release:release,instruction:instruction,finish:finish,resume:resume,cancel:cancel,guardProgress:guardProgress,progressReason:progressReason,
        active:function(){return !!active;},setCompletion:function(ctx,value){if(ctx)ctx.finishReason=value&&value.finishReason||null;}};
})();
