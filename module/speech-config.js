/** Drama 3 settings and local reference ownership. Old credentials are archived, never sent to Fish. */
var speechConfig = (function () {
    'use strict';
    var KIND='fish-drama3';
    function owner(){return mediaContext.workspaceId();}
    function guard(id){var context=mediaContext.capture();return function(){if(id!==owner()||!mediaContext.isCurrent(context))throw new DOMException('语音配置期间游戏上下文已变更','AbortError');};}
    function defaults(){return {enabled:false,provider:{kind:KIND,apiKey:'',speed:1},voices:typeof speechVoiceDefaults!=='undefined'?speechVoiceDefaults.create():{},parser:{useMain:true,config:{}}};}
    function object(v){if(!v||typeof v!=='object'||Array.isArray(v))return false;var p=Object.getPrototypeOf(v);return p===null||Object.getPrototypeOf(p)===null;}
    function merge(base,patch){
        if(!object(base)||!object(patch))return structuredClone(patch);
        var out=structuredClone(base);
        Object.keys(patch).forEach(function(k){Object.defineProperty(out,k,{value:object(base[k])&&object(patch[k])?merge(base[k],patch[k]):structuredClone(patch[k]),enumerable:true,writable:true,configurable:true});});
        return out;
    }
    function project(raw){
        if(!raw)return defaults();
        if(raw.provider&&raw.provider.kind===KIND){
            var saved=merge(defaults(),raw);saved.voices=structuredClone(raw.voices||{});return saved;
        }
        var next=merge(defaults(),raw);
        next.enabled=false;next.provider=defaults().provider;next.voices=defaults().voices;next.legacyAvailable=true;
        return next;
    }
    async function get(workspaceId){var id=workspaceId||owner();return project(await speechStore.getSetting('config:'+id));}
    function voiceBinding(v){
        if(!object(v)||v.kind!==KIND||typeof v.speakerId!=='string'||!v.speakerId.trim())throw new Error('请重新绑定Drama 3音色或参考音频');
        var out=structuredClone(v);out.speakerId=out.speakerId.trim();out.version=String(out.version||'1');
        if(out.speakerId.startsWith('ref:')){
            if(!/^[a-f0-9]{64}$/.test(out.referenceHash||'')||out.speakerId!=='ref:'+out.referenceHash||typeof out.referenceText!=='string'||!out.referenceText.trim())throw new Error('本地音色参考缺少哈希或准确转录');
        }else if(!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(out.speakerId)||/^S_/i.test(out.speakerId))throw new Error('需要Fish音色ID，不能使用火山S_槽ID');
        return out;
    }
    async function save(value,workspaceId){
        var id=workspaceId||owner(),patch=structuredClone(value),verify=guard(id);verify();
        if(!object(patch))throw new Error('语音配置补丁不合法');
        if(patch.provider&&patch.provider.kind!==KIND)throw new Error('配置页版本已变化，请刷新并填写Fish Drama 3凭证');
        var raw=await speechStore.getSetting('config:'+id);verify();
        var legacy=raw&&raw.provider?.kind!==KIND;
        if(legacy&&!patch.provider)throw new Error('请先明确保存Drama 3连接，再修改绑定');
        var next=merge(project(raw),patch);next.enabled=next.enabled===true;
        next.provider=merge(defaults().provider,next.provider||{});
        next.provider.apiKey=String(next.provider.apiKey||'').trim();
        next.provider.speed=Number(next.provider.speed);
        if(!Number.isFinite(next.provider.speed)||next.provider.speed<0.5||next.provider.speed>2)throw new Error('语速须在0.5至2之间');
        Object.keys(patch.voices||{}).forEach(function(id){
            if(patch.voices[id]===null){delete next.voices[id];return;}
            if(id==='USER'||(typeof npcs!=='undefined'&&!Object.prototype.hasOwnProperty.call(npcs,id)))throw new Error('仅支持注册NPC的音色绑定');
            next.voices[id]=voiceBinding(next.voices[id]);
        });
        if(next.enabled||next.provider.apiKey)speechDrama3.normalizeConfig(next.provider);
        if(legacy){
            // Archive before replacing; failure here leaves the original settings intact.
            var digest=await speechPlan.hash(JSON.stringify(raw));verify();
            var key='legacy-volcengine-config:'+id+':'+digest;
            if(!await speechStore.getSetting(key)){verify();await speechStore.setSetting(key,raw);}
            verify();next.legacyConfigKey=key;delete next.legacyAvailable;
        }
        verify();await speechStore.setSetting('config:'+id,next);verify();return next;
    }
    async function putReference(blob,text,workspaceId){
        var id=workspaceId||owner(),verify=guard(id);verify();
        if(!(blob instanceof Blob)||!blob.size||blob.size>10*1024*1024)throw new Error('参考音频须为不超过10MiB的音频文件');
        if(typeof text!=='string'||!text.trim()||new TextEncoder().encode(text).length>65536)throw new Error('请填写参考音频的准确转录（不超过64KiB）');
        var audio=new Uint8Array(await blob.arrayBuffer());verify();
        var hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',audio))).map(function(b){return b.toString(16).padStart(2,'0');}).join('');verify();
        await speechStore.setSetting('fish-reference:'+id+':'+hash,{audio:audio,sha256:hash});verify();
        return {kind:KIND,speakerId:'ref:'+hash,referenceHash:hash,referenceText:text,referenceName:typeof blob.name==='string'?blob.name:'本地参考',version:'1'};
    }
    async function resolveVoice(value,workspaceId){
        var id=workspaceId||owner(),verify=guard(id);verify();var voice=voiceBinding(value);
        if(!voice.speakerId.startsWith('ref:'))return {kind:KIND,referenceId:voice.speakerId};
        var saved=await speechStore.getSetting('fish-reference:'+id+':'+voice.referenceHash);verify();
        if(!saved||saved.sha256!==voice.referenceHash||!(saved.audio instanceof Uint8Array))throw new Error('本机参考音频不存在，请重新选择；不会自动训练或调用旧提供商');
        return {kind:KIND,reference:{audio:new Uint8Array(saved.audio),text:voice.referenceText,sha256:voice.referenceHash}};
    }
    return {kind:KIND,defaults:defaults,get:get,save:save,putReference:putReference,resolveVoice:resolveVoice,voiceBinding:voiceBinding};
})();
