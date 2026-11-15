/** M3 opt-in and local pending-round decisions. Original settings and pipeline own the work. */
var speechRoundUI=(function(){
    'use strict';
    function owner(){return mediaContext.workspaceId();}
    async function mount(root,workspaceId,current){
        if(!root)return;root.textContent='读取整轮朗读…';
        try{
            var prefs=await speechRound.preferences(workspaceId),draft=await speechRound.load(workspaceId);current();if(!root.isConnected)return;
            root.innerHTML='<h4>Drama 3整轮朗读（横屏阅卷）</h4><p>同一主回复标记每段归属，声音准备完成后按原回合流程提交并展示。每轮最多24个NPC片段、3000字；旁白与玩家不朗读。</p>'+
                '<label><input type="checkbox" id="sr-enabled"> 后续正文启用整轮朗读</label><button type="button" class="modal-btn" id="sr-save">保存整轮选择</button>'+
                '<p id="sr-status" role="status"></p><div id="sr-pending" hidden><p id="sr-description"></p><p id="sr-error"></p>'+
                '<button type="button" class="modal-btn" id="sr-resume">继续准备</button><button type="button" class="modal-btn" id="sr-silent">本轮无声继续</button><button type="button" class="modal-btn" id="sr-discard">放弃待办</button></div>';
            var $=function(id){return root.querySelector('#'+id);};$('sr-enabled').checked=prefs.enabled;
            function available(){current();if(!root.isConnected||owner()!==workspaceId)throw new Error('工作区或设置页已经切换');if(mediaContext.isBusy())throw new Error('请先完成或停止当前准备');}
            $('sr-save').onclick=async function(){
                try{available();var enabled=$('sr-enabled').checked;
                    if(enabled&&!prefs.enabled&&!confirm('开启后，后续每轮会使用Fish Drama 3为已绑定NPC生成语音，按实际发送的台词＋表现描述UTF-8字节计费；最多24片段/3000字不是费用保证。旧提供商开关不会自动迁移。确认开启？')){$('sr-enabled').checked=false;return;}
                    prefs=await speechRound.savePreferences({enabled:enabled},workspaceId);current();$('sr-status').textContent=enabled?'已开启后续整轮朗读；现有正文不补生成。':'已关闭后续整轮朗读；已有待办仍可明确处理。';
                }catch(error){if(root.isConnected)$('sr-status').textContent=error.message;}
            };
            if(speechRound.pending(draft)){
                var phases={draft:'待处理',preparing:'准备中',paused:'已暂停',ready:'可发布',committing:'提交待核对'};
                $('sr-pending').hidden=false;$('sr-description').textContent='待办状态：'+(phases[draft.phase]||draft.phase)+'；'+(draft.plan&&draft.plan.units?draft.plan.units.length:0)+'个候选语音片段。';
                $('sr-error').textContent=draft.error||'';
                var evidence=storageService.loadUIConversation().filter(function(m){return m&&m.roundSpeech&&m.roundSpeech.draftId===draft.id;});
                var reconcile=draft.phase==='committing'&&evidence.length===1&&evidence[0].content===draft.input.mainText;
                var uncertain=draft.phase==='committing';$('sr-resume').disabled=uncertain&&!reconcile;$('sr-silent').disabled=uncertain;$('sr-discard').disabled=uncertain;
                if(uncertain)$('sr-error').textContent='上次提交状态待核对。请检查当前历史，不能自动再次结算。';
                if(draft.renderVersion!=='drama3-v1'&&!reconcile&&!uncertain){$('sr-resume').disabled=true;$('sr-error').textContent='旧提供商待办不再联网续配；原数据保留，可无声继续或明确放弃。';}
                if(reconcile){$('sr-resume').textContent='同步已发布状态';$('sr-error').textContent='当前历史已有同一正文；这里只补齐待办状态，不再次结算。';}
                async function resume(silent){
                    try{available();var options={silent:!!silent};
                        if(!silent&&!reconcile){var captured=await speechRound.settings(workspaceId);available();
                            if(captured.fingerprint!==draft.settingsFingerprint){if(!confirm('连接或声线已改变。使用当前配置继续可能重新生成已成功的片段。确认采用当前配置？'))return;options.adoptSettings=captured.fingerprint;}}
                        if(typeof closeGameSettings==='function')closeGameSettings();
                        await pipeline.resumeRoundSpeech(draft.id,options);
                    }catch(error){if(root.isConnected)$('sr-status').textContent=error.message;else if(typeof showModal==='function')showModal(String(error.message||error).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));}
                }
                $('sr-resume').onclick=function(){resume(false);};$('sr-silent').onclick=function(){resume(true);};
                $('sr-discard').onclick=async function(){try{available();if(!confirm('放弃这份待发布正文？已经生成的录音仍按原缓存规则保留或淘汰。'))return;await speechRound.discard(draft.id);current();await mount(root,workspaceId,current);}catch(error){if(root.isConnected)$('sr-status').textContent=error.message;}};
            }
        }catch(error){if(root.isConnected)root.textContent='整轮设置读取失败：'+error.message;}
    }
    function decision(draft,error,signal){
        if(signal.aborted)return Promise.resolve('pause');
        return new Promise(function(resolve){
            var node=document.createElement('section');node.id='speech-round-decision-modal';node.className='modal';node.style.display='block';node.style.zIndex='5200';
            node.innerHTML='<div class="modal-content" style="max-width:650px;text-align:left"><h3>本轮声音尚未完成</h3><p id="srd-error"></p><p>重试只复用身份一致的成功片段；未成功的请求再次重试仍可能计费。无声继续会按原流程展示本轮正文。</p><div class="modal-buttons"><button class="modal-btn" id="srd-retry">重试声音</button><button class="modal-btn" id="srd-silent">本轮无声继续</button><button class="modal-btn" id="srd-pause">暂停，稍后处理</button></div></div>';
            node.querySelector('#srd-error').textContent=String(error&&error.message||error);
            if(draft.renderVersion!=='drama3-v1')node.querySelector('#srd-retry').disabled=true;
            var finished=false;
            function close(choice){if(finished)return;finished=true;signal.removeEventListener('abort',abort);if(node._unbindFit)node._unbindFit();node.remove();if(typeof presentationHost!=='undefined')presentationHost.syncOverlays();resolve(choice);}
            function abort(){close('pause');}
            ['retry','silent','pause'].forEach(function(choice){node.querySelector('#srd-'+choice).onclick=function(){close(owner()===draft.workspaceId?choice:'pause');};});
            node.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close('pause');}});
            signal.addEventListener('abort',abort,{once:true});document.body.appendChild(node);
            if(typeof fitModalToViewport==='function')fitModalToViewport(node);if(typeof bindModalAutoFit==='function')bindModalAutoFit(node);
            if(typeof presentationHost!=='undefined')presentationHost.syncOverlays();node.querySelector('#srd-pause').focus();
        });
    }
    return {mount:mount,decision:decision};
})();
