/** Drama 3 BYOK configuration. Saving/reference binding is local; synthesis is always a separate action. */
var speechUI = (function () {
    'use strict';
    var serial=0;
    async function render(root) {
        if(!root)return;
        var ticket=++serial,workspaceId=speechService.workspaceId(),context=mediaContext.capture();root.textContent='读取语音配置…';
        function current(){if(ticket!==serial||!root.isConnected||!mediaContext.isCurrent(context)||speechService.workspaceId()!==workspaceId)throw new Error('游戏上下文或设置页已变更，请重新打开语音设置');}
        try {
            var settings=await speechService.getConfig(workspaceId),cached=await speechStore.listTurns(workspaceId);current();
            var quote=speechDrama3.estimate('示例','',Date.now());
            root.innerHTML='<style>#speech-panel-root form label{display:block;margin-bottom:6px}#speech-panel-root input:not([type=checkbox]),#speech-panel-root select,#speech-panel-root textarea{box-sizing:border-box;max-width:100%;width:100%}#speech-panel-root fieldset{min-width:0;margin:10px 0}#speech-panel-root .speech-voice-row{display:grid;grid-template-columns:minmax(0,1fr) 55px;gap:8px}#speech-panel-root p{overflow-wrap:anywhere}</style>'+
                '<p class="gs-section-desc">Fish Drama 3：主回复同次提供台词归属与简短表现描述。整轮朗读默认关闭；连接与参考保存于本机，声音按相应按钮或开关生成。</p>'+
                '<p id="speech-legacy-note" class="gs-section-desc"></p>'+
                '<form id="speech-config-form" autocomplete="off"><label>Fish API Key <input name="apiKey" type="password" autocomplete="new-password"></label>'+
                '<label>语速（0.5～2，默认1）<input name="speed" type="number" min="0.5" max="2" step="0.05"></label>'+
                '<p>模型：drama-3；音频：MP3 / 44.1kHz。Fish Key保存在本机，合成使用当前玩家的账户。</p><p id="speech-connection-status" role="status"></p><p id="speech-price"></p>'+
                '<h4>Fish声线 → 游戏角色</h4><p class="gs-section-desc">已预设14个公开声线ID，可按角色调整。留空取消该角色绑定；实际音色可用性以Fish返回为准。</p><div id="speech-voices"></div>'+
                '<p><button type="submit" class="modal-btn">保存配置</button> <button type="button" id="speech-check" class="modal-btn">本地校验</button></p></form>'+
                '<details><summary>高级：绑定本地参考音频</summary><p>可改用WAV/MP3/FLAC参考（≤10MiB），建议10～30秒干净语音，必须填写准确转录。仅本机保存；合成时才向Fish发送此参考。</p>'+
                '<label>角色 <select id="speech-reference-npc"></select></label><label>参考音频 <input id="speech-reference-file" type="file" accept="audio/wav,audio/mpeg,audio/flac,.wav,.mp3,.flac"></label>'+
                '<label>准确转录 <textarea id="speech-reference-text" rows="3"></textarea></label><button id="speech-reference-save" type="button" class="modal-btn">本机保存参考绑定</button></details>'+
                '<p id="speech-status" role="status"></p><hr><p id="speech-cache-status"></p><button type="button" id="speech-clear" class="modal-btn">清除本机语音</button><hr><div id="speech-round-controls"></div>';
            root.querySelector('#speech-legacy-note').textContent=settings.legacyAvailable||settings.legacyConfigKey?'检测到旧提供商配置，旧凭证/缓存保留隔离。请明确保存Fish连接并重新确认开启；不会把旧Key发给Fish。':'';
            root.querySelector('#speech-price').textContent='按发送文本UTF-8字节计费（含表现指令）。当前官网估价 $'+quote.usdPerMillionBytes+'/百万字节；标准价 $50。'+(quote.promotional?'活动至2026-12-01 08:00 UTC。':'')+'此处不是账户账单或硬性消费上限。';
            var form=root.querySelector('form'),field=function(name){return form.elements.namedItem(name);};
            field('apiKey').value=settings.provider.apiKey||'';field('speed').value=String(settings.provider.speed||1);
            var connection=speechTransport.describe();
            root.querySelector('#speech-connection-status').textContent=connection.message;
            root.querySelector('details').hidden=connection.mode==='android-native';
            var voicesRoot=root.querySelector('#speech-voices'),referenceSelect=root.querySelector('#speech-reference-npc'),voiceInputs=[];
            Object.keys(npcs).filter(function(id){return id!=='USER'&&npcs[id].name;}).forEach(function(id){
                var row=document.createElement('p'),label=document.createElement('label'),voice=document.createElement('input'),version=document.createElement('input');
                label.textContent=npcs[id].name+' ';voice.placeholder='Fish reference_id';voice.value=settings.voices?.[id]?.speakerId||'';
                voice.setAttribute('aria-label',npcs[id].name+'音色ID');version.value=settings.voices?.[id]?.version||'1';version.setAttribute('aria-label',npcs[id].name+'声音版本');
                row.className='speech-voice-row';var versionLabel=document.createElement('label');versionLabel.textContent='版本';versionLabel.append(version);label.append(voice);row.append(label,versionLabel);voicesRoot.append(row);
                voiceInputs.push({id:id,voice:voice,version:version});var option=document.createElement('option');option.value=id;option.textContent=npcs[id].name;referenceSelect.append(option);
            });
            var status=root.querySelector('#speech-status');
            function values(){
                current();var next={provider:{kind:'fish-drama3',apiKey:field('apiKey').value.trim(),speed:Number(field('speed').value)},voices:{}};
                voiceInputs.forEach(function(row){
                    var id=row.voice.value.trim(),old=settings.voices?.[row.id];
                    if(id)next.voices[row.id]={kind:'fish-drama3',speakerId:id,version:row.version.value.trim()||'1'};
                    else if(old&&old.speakerId)next.voices[row.id]=null;
                });return next;
            }
            form.onsubmit=async function(event){event.preventDefault();try{settings=await speechService.saveConfig(values(),workspaceId);current();status.textContent='Drama 3配置已保存到本机；请在下方单独确认启用朗读。';}catch(e){if(ticket===serial)status.textContent=e.message;}};
            root.querySelector('#speech-check').onclick=async function(){
                try{
                    var next=values();speechDrama3.normalizeConfig(next.provider);
                    var bound=Object.entries(next.voices).filter(function(entry){return !!entry[1];});
                    if(!bound.length)throw new Error('请至少绑定一个NPC声线');
                    var latest=await speechService.getConfig(workspaceId);current();
                    for(var entry of bound){
                        var complete=Object.assign({},latest.voices[entry[0]]||{},entry[1]);
                        var voice=await speechConfig.resolveVoice(complete,workspaceId);current();
                        speechTransport.checkVoice(voice);
                        await speechDrama3.voiceIdentity(voice);current();
                    }
                    status.textContent='本地字段、'+bound.length+'个绑定与参考哈希通过；账号权限和音质另行验证。';
                }
                catch(e){if(ticket===serial)status.textContent=e.message;}
            };
            root.querySelector('#speech-reference-save').onclick=async function(){
                try{
                    var next=values(),npc=referenceSelect.value,file=root.querySelector('#speech-reference-file').files[0],text=root.querySelector('#speech-reference-text').value;
                    if(!file)throw new Error('请先选择参考音频');
                    if(!file.size||file.size>10*1024*1024)throw new Error('参考音频须为不超过10MiB的文件');
                    if(!text.trim())throw new Error('请填写参考音频的准确转录');
                    await speechService.validateAudio(file);current();
                    var binding=await speechConfig.putReference(file,text,workspaceId);current();next.voices[npc]=binding;
                    settings=await speechService.saveConfig(next,workspaceId);current();
                    var row=voiceInputs.find(function(r){return r.id===npc;});row.voice.value=binding.speakerId;row.version.value=binding.version;
                    status.textContent=npcs[npc].name+'参考已保存在本机，原文件未修改；可在单句测试中试听。';
                }catch(e){if(ticket===serial)status.textContent=e.message;}
            };
            root.querySelector('#speech-cache-status').textContent='本机缓存：'+cached.length+'/10轮。旧缓存只读保留，不自动补生成；最早语音仍按原规则淘汰，正文不删除。';
            root.querySelector('#speech-clear').onclick=async function(){
                try{current();if(!confirm('只清除本机语音文件，不删除正文、参考音频、声线或API配置。继续？'))return;speechService.stop();await speechStore.clearWorkspace(workspaceId);current();status.textContent='本机语音已清除。';root.querySelector('#speech-cache-status').textContent='本机缓存：0/10轮。';}
                catch(e){if(ticket===serial)status.textContent=e.message;}
            };
            if(typeof speechRoundUI!=='undefined')await speechRoundUI.mount(root.querySelector('#speech-round-controls'),workspaceId,current);
        }catch(error){if(ticket===serial)root.textContent='语音设置读取失败：'+error.message;}
    }
    return {render:render};
})();
