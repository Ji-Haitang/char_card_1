// Migrated from 3a1fc5b tests/speech-native.unit.mjs. Real SDK/transport/native HTTP; only CapacitorHttp.request is fake.
// Public silent MP3 and fake credentials only; not APK, device-memory or server-cancellation verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';

const FISH='https://api.fish.audio/v1/tts',MAX=16*1024*1024,KEY='native-public-fixture-not-a-real-key';
const mp3=fs.readFileSync(new URL('./scene3d/fixtures/audio/silence.mp3',import.meta.url));
const mp3Hash='8833357c87a7ae5a38eb49572f112e89efdd5629cf494fbadf4032f0eb02125d';
const config={kind:'fish-drama3',apiKey:KEY};
const input={text:'原生联网测试。',direction:'轻声、稍慢',voice:{kind:'fish-drama3',referenceId:'native-public-fixture-voice'}};
const jsonBody={text:'['+input.direction+'] '+input.text,format:'mp3',sample_rate:44100,latency:'normal',prosody:{speed:1},reference_id:input.voice.referenceId};
const success=()=>({status:200,headers:{'Content-Type':'audio/mpeg','Content-Length':String(mp3.length)},data:mp3.toString('base64')});
const options=signal=>({method:'POST',headers:{Authorization:'Bearer '+KEY,model:'drama-3','Content-Type':'application/json'},body:JSON.stringify(jsonBody),signal});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(handler=success,extra={}){
    const calls=[],timers=new Map(),signals=[],decoded=[],web=[];let timerId=0;
    class TrackedController extends AbortController{
        constructor(){super();const signal=this.signal,listeners=new Set(),add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
            signal.addEventListener=(type,listener,opts)=>{if(type==='abort')listeners.add(listener);return add(type,listener,opts);};
            signal.removeEventListener=(type,listener,opts)=>{if(type==='abort')listeners.delete(listener);return remove(type,listener,opts);};signals.push({signal,listeners});}
    }
    const env={Blob,URL,Uint8Array,TextEncoder,TextDecoder,Headers,Response,ReadableStream,AbortController:TrackedController,DOMException,crypto:webcrypto,btoa,
        atob:value=>{decoded.push(value.length);return atob(value);},setTimeout:(callback,ms)=>{const id=++timerId;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id),
        fetch:(...args)=>{web.push(args);throw Error('Forbidden browser network');},Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:()=>true,Plugins:{CapacitorHttp:{request:request=>{calls.push(request);return handler(request);}}}},...extra};
    vm.createContext(env);for(const file of ['illustration-http.js','speech-msgpack.js','speech-drama3.js','speech-transport.js'])vm.runInContext(fs.readFileSync(new URL('../module/'+file,import.meta.url),'utf8'),env,{filename:file});
    const synthesize=(signal,request=input)=>env.speechDrama3.synthesize(config,request,{signal,fetch:env.speechTransport.fetch});
    function clean(){assert.equal(web.length,0,'no browser fallback');assert.equal(timers.size,0,'wall-clock timer released');for(const{listeners}of signals)assert.equal(listeners.size,0,'abort listeners removed');}
    return{env,calls,timers,signals,decoded,web,synthesize,clean};
}
function checkRequest(request){
    assert.equal(request.url,FISH);assert.equal(request.method,'POST');assert.equal(request.responseType,'arraybuffer');assert.equal(request.disableRedirects,true);
    assert.equal(request.connectTimeout,15000);assert.equal(request.readTimeout,180000);assert.equal(request.headers.authorization,'Bearer '+KEY);assert.equal(request.headers.model,'drama-3');assert.equal(request.headers['content-type'],'application/json');
    assert.deepEqual(Object.keys(request.headers).sort(),['authorization','content-type','model']);assert.equal(typeof request.data,'object');assert.deepEqual(JSON.parse(JSON.stringify(request.data)),jsonBody);assert.equal(request.dataType,undefined);
}

test('Android platform discovery selects the existing native HTTP adapter',()=>{
    const h=harness();assert.equal(h.env.illustrationHttp.nativeAvailable(),true);assert.equal(h.env.speechTransport.endpoint(),FISH);
    const d=h.env.speechTransport.describe();assert.equal(d.configured,true);assert.equal(d.mode,'android-native');assert.equal(d.origin,'https://api.fish.audio');assert.equal(d.supportsReference,false);assert.equal(h.calls.length,0);h.clean();
});
test('SDK through the real native adapter sends JSON and returns exact public MP3 bytes',async()=>{
    assert.equal(mp3.length,1224);assert.equal(createHash('sha256').update(mp3).digest('hex'),mp3Hash);const h=harness(),controller=new h.env.AbortController();const result=await h.synthesize(controller.signal);
    assert.equal(h.calls.length,1);checkRequest(h.calls[0]);assert.equal(result.model,'drama-3');assert.equal(result.provider,'fish-drama3');assert.equal(result.blob.type,'audio/mpeg');assert.equal(result.blob.size,1224);assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),mp3);assert.equal(result.billableBytes,new TextEncoder().encode(jsonBody.text).length);assert.equal(h.decoded.length,1);h.clean();
});
test('Android wrapped base64 is decoded by the real adapter',async()=>{
    const h=harness(()=>({...success(),data:mp3.toString('base64').match(/.{1,76}/g).join('\r\n')+'\n'}));assert.deepEqual(Buffer.from(await(await h.synthesize()).blob.arrayBuffer()),mp3);assert.equal(h.calls.length,1);h.clean();
});
test('missing Android plugin fails closed before network',async()=>{
    const h=harness();h.env.Capacitor.isPluginAvailable=()=>false;assert.equal(h.env.speechTransport.describe().configured,false);assert.throws(()=>h.env.speechTransport.endpoint(),{code:'native-unavailable'});await assert.rejects(h.synthesize(),{code:'network'});assert.equal(h.calls.length,0);h.clean();
});
test('native target model POST and JSON guards reject before dispatch',()=>{
    const h=harness();for(const[url,opts]of[['https://other.example/v1/tts',options()],[FISH,{...options(),method:'GET'}],[FISH,{...options(),headers:{...options().headers,model:'s2'}}]])assert.throws(()=>h.env.speechTransport.fetch(url,opts),{code:'target'});
    const binary=h.env.speechMsgpack.encode({text:'公开夹具',references:[{audio:new Uint8Array([1,2]),text:'公开夹具'}]});assert.ok(binary instanceof Uint8Array);assert.throws(()=>h.env.speechTransport.fetch(FISH,{...options(),headers:{...options().headers,'Content-Type':'application/msgpack'},body:binary}),{code:'native-reference'});assert.equal(h.calls.length,0);h.clean();
});
test('dynamic reference cannot bypass native JSON-only checks',async()=>{
    const h=harness(),voice={kind:'fish-drama3',reference:{audio:new Uint8Array(mp3),text:'独立公开测试转录。',sha256:mp3Hash}};
    assert.doesNotThrow(()=>h.env.speechTransport.checkVoice(input.voice));assert.throws(()=>h.env.speechTransport.checkVoice(voice),{code:'native-reference'});await assert.rejects(h.synthesize(undefined,{...input,voice}),{code:'network'});assert.equal(h.calls.length,0);h.clean();
});
test('pre-aborted SDK and transport signals make zero requests',async()=>{
    const h=harness(),controller=new h.env.AbortController();controller.abort('fixture reason');await assert.rejects(h.synthesize(controller.signal),{name:'AbortError',code:'aborted'});await assert.rejects(h.env.speechTransport.fetch(FISH,options(controller.signal)),{name:'AbortError',code:'aborted'});assert.equal(h.calls.length,0);h.clean();
});
for(const outcome of ['resolve','reject'])test('native cancellation ignores late '+outcome,async()=>{
    const started=deferred(),native=deferred(),h=harness(()=>{started.resolve();return native.promise;}),controller=new h.env.AbortController();const pending=h.synthesize(controller.signal),rejection=assert.rejects(pending,{name:'AbortError',code:'aborted'});
    await started.promise;assert.equal(h.calls.length,1);controller.abort('private reason');await rejection;await flush();h.clean();assert.equal(h.decoded.length,0);if(outcome==='resolve')native.resolve(success());else native.reject(Error('late fixture failure'));
    await flush();assert.equal(h.decoded.length,0,'late payload ignored before decoding');assert.equal(h.calls.length,1);h.clean();
});
test('native 180000ms timeout cleans up without waiting or retrying',async()=>{
    const native=deferred(),h=harness(()=>native.promise),controller=new h.env.AbortController();const pending=h.env.speechTransport.fetch(FISH,options(controller.signal)),rejection=assert.rejects(pending,{code:'timeout'});
    assert.equal(h.timers.size,1);const timer=[...h.timers.values()][0];assert.equal(timer.ms,180000);timer.callback();await rejection;h.clean();native.resolve(success());await flush();assert.equal(h.decoded.length,0);assert.equal(h.calls.length,1);h.clean();
});
test('SDK timeout is sanitized and does not claim native cancellation',async()=>{
    const started=deferred(),native=deferred(),h=harness(()=>{started.resolve();return native.promise;});const pending=h.synthesize(),rejection=assert.rejects(pending,{code:'network'});
    await started.promise;[...h.timers.values()][0].callback();await rejection;await flush();h.clean();native.reject(Error('late timeout'));await flush();assert.equal(h.calls.length,1);h.clean();
});
test('native JSON errors never reach base64 decoding or expose credentials',async()=>{
    for(const status of [401,429,500,200]){const h=harness(()=>({status,headers:{'content-type':'application/json'},data:{detail:'untrusted echo '+KEY}})),controller=new h.env.AbortController();
        await assert.rejects(h.synthesize(controller.signal),error=>{assert.equal(error.code,status===200?'content_type':'http');if(status!==200)assert.equal(error.status,status);assert.ok(!error.message.includes(KEY));return true;});assert.equal(h.decoded.length,0);assert.equal(h.calls.length,1);h.clean();}
});
test('native synchronous/asynchronous errors neither retry nor leak bridge messages',async()=>{
    for(const async of [false,true]){const h=harness(()=>{const e=Error(KEY+' bridge echo');if(async)return Promise.reject(e);throw e;}),controller=new h.env.AbortController();await assert.rejects(h.synthesize(controller.signal),e=>{assert.equal(e.code,'network');assert.ok(!e.message.includes(KEY));return true;});assert.equal(h.calls.length,1);assert.equal(h.decoded.length,0);h.clean();}
});
test('native 16MiB limit is checked before base64 decoding, equality accepted',async()=>{
    for(const advertised of [true,false]){const h=harness(()=>({status:200,headers:advertised?{'content-type':'audio/mpeg','content-length':String(MAX+1)}:{'content-type':'audio/mpeg'},data:advertised?success().data:Buffer.alloc(MAX+1).toString('base64')}));await assert.rejects(h.env.speechTransport.fetch(FISH,options()),{code:'too_large'});assert.equal(h.decoded.length,0);assert.equal(h.calls.length,1);h.clean();}
    const h=harness(()=>({status:200,headers:{'content-type':'audio/mpeg'},data:Buffer.alloc(MAX).toString('base64')}));const response=await h.env.speechTransport.fetch(FISH,options());assert.equal((await response.arrayBuffer()).byteLength,MAX);assert.equal(h.decoded.length,1);h.clean();
});
test('invalid base64 and redirects fail once with listeners released',async()=>{
    for(const result of [{...success(),headers:{'content-type':'audio/mpeg'},data:'invalid!'},{status:302,headers:{'content-type':'audio/mpeg',location:'https://other.example/'},data:success().data}]){const h=harness(()=>result),controller=new h.env.AbortController();await assert.rejects(h.synthesize(controller.signal));assert.equal(h.calls.length,1);h.clean();}
});
