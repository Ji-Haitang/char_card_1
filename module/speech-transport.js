/** Speech HTTP routing: Android native adapter and the game's configured Web CORS service. */
var speechTransport = (function(){
    'use strict';
    var UPSTREAM='https://api.fish.audio/v1/tts',MAX_AUDIO=16*1024*1024,TIMEOUT=180000;
    function nativePlatform(){
        try{return typeof Capacitor!=='undefined'&&Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android';}
        catch(_){return false;}
    }
    function fault(code,message){var e=new Error(message);e.code=code;return e;}
    function route(){
        if(nativePlatform()){
            var ready=typeof illustrationHttp!=='undefined'&&illustrationHttp.nativeAvailable();
            return {configured:ready,mode:'android-native',endpoint:UPSTREAM,origin:'https://api.fish.audio',supportsReference:false,
                message:ready?'Android原生连接：Fish Audio':'当前APK的原生联网桥暂不可用。'};
        }
        try{
            var config=apiService.getConfig();
            if(config.corsProxyEnabled!==true||typeof config.corsProxyUrl!=='string'||!config.corsProxyUrl.trim())throw new Error();
            var url=new URL(config.corsProxyUrl.trim());
            if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error();
            return {configured:true,mode:'web-proxy',endpoint:url.href.replace(/\/+$/,'')+'?target='+encodeURIComponent(UPSTREAM),
                origin:url.origin,supportsReference:true,message:'网页连接：使用API设置中的跨域服务。Fish Key和本次语音请求将经此服务转交Fish。'};
        }catch(_){return {configured:false,mode:'web-proxy',origin:'',supportsReference:true,
            message:'请在API设置中启用有效的HTTPS跨域服务，语音请求使用该路由。'};}
    }
    function describe(){var r=route();return {configured:r.configured,mode:r.mode,origin:r.origin,supportsReference:r.supportsReference,message:r.message};}
    function checkVoiceFor(mode,voice){if(mode==='android-native'&&voice&&voice.reference)throw fault('native-reference','当前APK语音请选择Fish声线ID。');}
    function checkVoice(voice){checkVoiceFor(nativePlatform()?'android-native':'web-proxy',voice);}
    function nativeFetch(options){
        var headers=new Headers(options.headers||{});
        if(!headers.get('content-type')?.toLowerCase().startsWith('application/json')||typeof options.body!=='string')
            throw fault('native-reference','当前APK语音请求需要JSON声线ID参数。');
        var controller=new AbortController(),timedOut=false;
        function abort(){controller.abort();}
        if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
        var timer=setTimeout(function(){timedOut=true;controller.abort();},TIMEOUT);
        return illustrationHttp.fetchLike(UPSTREAM,{method:'POST',headers:headers,body:options.body,signal:controller.signal},
            {transport:'native',maxBytes:MAX_AUDIO,timeoutMs:TIMEOUT}).catch(function(error){
                if(timedOut)throw fault('timeout','原生语音等待超时，服务端结果仍需核对。');
                throw error;
            }).finally(function(){clearTimeout(timer);options.signal?.removeEventListener('abort',abort);});
    }
    function capture(){
        var selected=route();
        if(!selected.configured)throw fault(selected.mode==='android-native'?'native-unavailable':'web-route',selected.message);
        return Object.freeze({endpoint:selected.endpoint,mode:selected.mode,
            checkVoice:function(voice){checkVoiceFor(selected.mode,voice);},
            fetch:function(url,options){
                options=options||{};var headers=new Headers(options.headers||{});
                if(url!==UPSTREAM||options.method!=='POST'||headers.get('model')!=='drama-3')throw fault('target','语音传输目标或模型不合法');
                var forwarded=new Headers();['Authorization','Content-Type','model'].forEach(function(k){if(headers.has(k))forwarded.set(k,headers.get(k));});
                if(selected.mode==='android-native')return nativeFetch({headers:forwarded,body:options.body,signal:options.signal});
                return globalThis.fetch(selected.endpoint,{method:'POST',headers:forwarded,body:options.body,signal:options.signal,
                    mode:'cors',credentials:'omit',redirect:'error',cache:'no-store'});
            }});
    }
    return Object.freeze({capture:capture,endpoint:function(){return capture().endpoint;},describe:describe,checkVoice:checkVoice,
        fetch:function(url,options){return capture().fetch(url,options);}});
})();
