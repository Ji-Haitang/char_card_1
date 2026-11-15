/** M2a: explicit one-NPC/one-line test. No automatic synthesis, planner request or business settlement. */
var speechSingleTest = (function () {
    'use strict';
    var generation=0,active=null,modalOwner=null,checkView=null;
    function owner(){return mediaContext.workspaceId();}
    function chars(){return Object.keys(npcs).filter(function(id){return id!=='USER';}).map(function(id){return {id:id,name:npcs[id].name};});}
    function latest(){return storageService.loadUIConversation().slice().reverse().find(function(m){return m&&m.role==='assistant';});}
    function viewKey(){return JSON.stringify([currentStoryText,currentPage,isStoryExpanded,typeof storyHistoryOffset==='undefined'?0:storyHistoryOffset,document.body.classList.contains('layout-landscape'),typeof presentationReader==='undefined'?null:presentationReader.getDiagnostics().index]);}
    function stop(){generation++;if(active){active.abort();active=null;}speechService.stop();}
    function close(){checkView=null;if(modalOwner===null||modalOwner===owner())stop();else{generation++;if(active)active.abort();active=null;}modalOwner=null;var node=document.getElementById('speech-single-test-modal');if(node){if(node._unbindFit)node._unbindFit();node.remove();}}
    async function open(){
        close();var ticket=generation,workspaceId=owner(),context=mediaContext.capture(),key=viewKey(),record=structuredClone(latest()||null),node=document.createElement('div');
        modalOwner=workspaceId;
        node.id='speech-single-test-modal';node.className='modal';node.style.display='block';node.style.zIndex='5100';
        node.innerHTML='<div class="modal-content" style="max-width:720px;text-align:left"><h3>单句语音测试</h3>'+
            '<p>生成当前正文中所选NPC的第一条已标注台词，使用主回复提供的归属与表现描述。</p>'+
            '<p><label><input id="sst-enabled" type="checkbox">让后续主回复附单句测试标记</label></p>'+
            '<p><label>测试角色 <select id="sst-npc"></select></label> <button type="button" id="sst-save">保存测试选择（不联网）</button></p>'+
            '<p>连接与声线在“语音配置”保存。使用Fish Drama 3，简短表现描述随台词发送；本机录音可直接回放。</p>'+
            '<p>测试录音也占用最近10条本机缓存。停止不保证服务端取消或退款。</p>'+
            '<p id="sst-line"></p><p id="sst-emotion"></p><p id="sst-status" role="status">读取当前正文…</p>'+
            '<div class="modal-buttons"><button type="button" id="sst-generate" disabled>合成并播放这一句（可能计费）</button>'+
            '<button type="button" id="sst-play" disabled>只播放本机录音</button><button type="button" id="sst-stop">停止</button>'+
            '<button type="button" id="sst-close">关闭</button></div></div>';
        node.querySelector('.modal-content').style.animation='none';
        node.querySelectorAll('button').forEach(function(button){button.classList.add('modal-btn');});
        document.body.appendChild(node);
        if(typeof fitModalToViewport==='function')fitModalToViewport(node);
        if(typeof bindModalAutoFit==='function')bindModalAutoFit(node);
        var $=function(id){return node.querySelector('#'+id);},status=$('sst-status'),busy=false,selection=null;
        chars().forEach(function(c){var option=document.createElement('option');option.value=c.id;option.textContent=c.name; $('sst-npc').appendChild(option);});
        function current(requireView){
            if(!node.isConnected||ticket!==generation||!mediaContext.isCurrent(context)||owner()!==workspaceId)throw new Error('工作区或测试页已切换，请重新打开');
            if(requireView&&(document.hidden||key!==viewKey()||!record||latest()?.id!==record.id||latest()?.content!==record.content||JSON.stringify(latest()?.singleSpeech)!==JSON.stringify(record.singleSpeech)))throw new Error('正文或阅读位置已变化，请重新打开');
        }
        checkView=function(force){
            if(ticket!==generation)return;
            try{current(true);if(force)throw new Error('页面已离开');}
            catch(e){
                if(owner()===workspaceId)stop();else{generation++;if(active)active.abort();active=null;}
                $('sst-generate').disabled=true;$('sst-play').disabled=true;
                if(node.isConnected)status.textContent='阅读位置或页面已变化，已取消本次单句操作。请重新打开。';
            }
        };
        function error(e){if(node.isConnected&&owner()===workspaceId)status.textContent=e.message||String(e);}
        $('sst-close').onclick=function(){if(document.getElementById(node.id)===node)close();};
        $('sst-stop').onclick=function(){try{current(false);stop();status.textContent='已停止；原音频文件保留。重新测试请关闭后再打开。';}catch(e){error(e);}};
        node.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.getElementById(node.id)===node){e.preventDefault();e.stopPropagation();close();}});
        $('sst-save').onclick=async function(){
            try{current(false);var setting={provider:'fish-drama3',enabled:$('sst-enabled').checked,targetNpcId:$('sst-npc').value};
                await speechStore.setSetting('single-test:'+workspaceId,setting);current(false);status.textContent='已保存。只影响后续主回复，不重发当前正文或自动合成。';
            }catch(e){error(e);}
        };
        function planForOne(){return {sourceHash:selection.plan.sourceHash,units:[selection.unit],issues:[]};}
        async function loadSelection(){
            if(typeof storyHistoryOffset!=='undefined'&&storyHistoryOffset>0)throw new Error('本小节只测试最新正文，请先返回最新记录');
            if(!record||!record.singleSpeech||record.content!==currentStoryText)throw new Error('当前没有已提交的单句测试记录。先保存测试选择，再通过原行动入口生成新正文。');
            if(storageService.loadUIConversation().filter(function(m){return m.id===record.id;}).length!==1)throw new Error('正文ID不唯一，未允许配音');
            var saved=record.singleSpeech;
            if(saved.renderVersion!==undefined&&saved.renderVersion!=='drama3-v1')throw new Error('录音渲染版本不支持');
            if(saved.version!=='inline-v1'||!['stop','STOP','end_turn','tool_calls'].includes(saved.finishReason))throw new Error('本轮没有正常完成标志，未允许语音请求');
            var plan=await speechPlan.fromMainText(saved.rawSource,chars(),{finishReason:saved.finishReason});current(true);
            if(plan.issues.length||saved.issues.length||plan.sourceHash!==saved.sourceHash||plan.source!==speechPlan.documentFor(record.content).source)throw new Error('本轮标记或正文身份校验未通过，未允许合成');
            var unit=plan.units.find(function(u){return u.kind==='speech'&&u.speakerId===saved.targetNpcId&&u.speakerId!=='USER'&&npcs[u.speakerId];});
            if(!unit)throw new Error('本轮没有测试角色的明确台词。不会猜说话人或追加模型请求。');
            if(Array.from(unit.text).length>240)throw new Error('本小节只测试不超过240字的一条台词，不截断或拆成额外请求');
            selection={plan:plan,unit:unit,turnId:'d3-m2a:'+record.id};
            $('sst-line').textContent=npcs[unit.speakerId].name+'：'+unit.text;
            var cost=speechDrama3.estimate(unit.text,unit.emotion||'');
            $('sst-emotion').textContent='表现描述：'+unit.emotion+'；发送约'+cost.billableBytes+' UTF-8字节，官网估价 $'+cost.estimatedUsd.toFixed(5)+'（非账单保证）。';
            $('sst-generate').disabled=!speechTransport.describe().configured;
            var cached=await cachedSelection();current(true);
            $('sst-play').disabled=!cached;
            status.textContent=!speechTransport.describe().configured?speechTransport.describe().message:cached?(cached.turnId===selection.turnId?'本机已有Drama 3录音。':'本机保留旧提供商录音，可只读播放；新合成另存Drama 3身份。'):'尚无本机录音。合成按钮会使用Drama 3连接与声线，按字节计费。';
        }
        async function cachedSelection(){
            var modern=structuredClone(record);modern.singleSpeech.renderVersion='drama3-v1';
            var hit=await speechReplay.resolve({workspaceId:workspaceId,record:modern,characters:chars()});current(true);
            if(!hit&&!record.singleSpeech.renderVersion){hit=await speechReplay.resolve({workspaceId:workspaceId,record:record,characters:chars()});current(true);}
            return hit;
        }
        async function playCached(){
            current(true);var cached=await cachedSelection();current(true);
            if(!cached)throw new Error('没有匹配的本机录音，不会自动生成');
            var played=await speechService.play(workspaceId,cached.turnId,selection.unit.id+'/0');
            current(true);status.textContent=played?'已启动本机录音播放，可停止或重播。':'本次播放已取消。';
        }
        $('sst-play').onclick=async function(){try{if(!selection||busy)return;await playCached();}catch(e){error(e);}};
        $('sst-generate').onclick=async function(){
            if(busy||!selection)return;
            try{
                current(true);if(pipeline.isStreaming()||speechService.isBusy())throw new Error('原回合或语音仍在处理');
                if(!confirm('使用当前Fish Drama 3配置合成此句及其表现描述并播放，将按UTF-8字节计费。继续？'))return;
                busy=true;active=new AbortController();var controller=active;
                $('sst-generate').disabled=true;$('sst-play').disabled=true;status.textContent='正在处理这一句，不会自动重试…';
                var settings=await speechService.getConfig(workspaceId);current(true);
                if(!settings.voices?.[selection.unit.speakerId]?.speakerId)throw new Error('请先在语音配置中绑定该NPC的测试声线');
                await speechService.prepare({workspaceId:workspaceId,turnId:selection.turnId,sourceHash:selection.plan.sourceHash,createdAt:record.createdAt},planForOne(),{manual:true,settings:settings,signal:controller.signal});
                current(true);if(controller.signal.aborted)throw new DOMException('已停止','AbortError');
                $('sst-play').disabled=false;await playCached();
            }catch(e){error(e);}finally{busy=false;if(active===controller)active=null;if(node.isConnected&&ticket===generation)$('sst-generate').disabled=!selection||!speechTransport.describe().configured;}
        };
        try{
            var setting=await speechStore.getSetting('single-test:'+workspaceId);current(false);
            $('sst-enabled').checked=setting?.enabled===true&&setting?.provider==='fish-drama3';if(setting?.targetNpcId&&npcs[setting.targetNpcId])$('sst-npc').value=setting.targetNpcId;
            await loadSelection();
        }catch(e){error(e);}
        if(node.isConnected&&ticket===generation&&owner()===workspaceId)$('sst-enabled').focus();
    }
    function invalidate(){if(checkView)checkView(false);}
    document.addEventListener('visibilitychange',invalidate);
    window.addEventListener('pagehide',function(){if(checkView)checkView(true);});
    return {open:open,close:close,invalidate:invalidate};
})();
