// Migrated from 3a1fc5b tests/speech-proxy.unit.mjs; the upstream header allowlist is intentionally retained.
// Real Request/Response/streams and local Worker code; fetch is the only network boundary. No deployed service claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const FISH='https://api.fish.audio/v1/tts',TOKEN='speech-proxy-public-fixture-not-real';
const mp3=fs.readFileSync(new URL('./scene3d/fixtures/audio/silence.mp3',import.meta.url));
const source=fs.readFileSync(new URL('../worker/cors-proxy.js',import.meta.url),'utf8');
function worker(fetch){const scope={Request,Response,Headers,URL,fetch};vm.createContext(scope);assert.equal((source.match(/export default /g)||[]).length,1);vm.runInContext(source.replace('export default ','globalThis.worker = '),scope,{filename:'cors-proxy.js'});return scope.worker;}
function request({target=FISH,method='POST',body='{"text":"公开测试。","reference_id":"fixture","format":"mp3"}',type='application/json',headers={},signal}={}){return new Request('https://proxy.example/?target='+encodeURIComponent(target),{method,headers:{'Content-Type':type,Authorization:'Bearer '+TOKEN,model:'drama-3',...headers},body:['GET','HEAD','OPTIONS'].includes(method)?undefined:body,signal,duplex:'half'});}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function safeError(response,status){assert.equal(response.status,status);assert.equal(response.headers.get('content-type'),'application/json');assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.equal(response.headers.get('location'),null);const text=await response.text();assert.ok(!text.includes(TOKEN));assert.ok(!text.includes('untrusted-echo'));assert.equal(typeof JSON.parse(text).error,'string');assert.ok(!response.statusText.includes(TOKEN));}

test('preflight adds model to the existing upstream allowlist only',async()=>{
    let calls=0;const response=await worker(()=>{calls++;throw Error('No preflight upstream');}).fetch(request({method:'OPTIONS',headers:{Origin:'https://game.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,model'}}));
    assert.equal(response.status,204);assert.equal(calls,0);assert.deepEqual(response.headers.get('access-control-allow-headers').split(',').map(s=>s.trim()).sort(),['content-type','authorization','model','x-api-key','anthropic-version','anthropic-beta','x-goog-api-key'].sort());assert.equal(response.headers.get('access-control-max-age'),'86400');
});
for(const kind of ['JSON','MessagePack'])test('Fish '+kind+' request and MP3 response bytes are transparent',async()=>{
    const bytes=kind==='JSON'?Buffer.from('{"text":"[轻声] 公开测试。","reference_id":"fixture","format":"mp3"}'):new Uint8Array([0x81,0xa4,0x74,0x65,0x78,0x74,0xa2,0x68,0x69]);
    const type=kind==='JSON'?'application/json':'application/msgpack',incoming=request({body:bytes,type,headers:{Cookie:'private=fixture',Origin:'https://game.example','X-Unapproved':'must-not-forward'}});let calls=0,upstreamBody;
    const proxy=worker(async(url,init)=>{calls++;assert.equal(url,FISH);assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.body,incoming.body);assert.equal(init.signal,incoming.signal);assert.equal(init.duplex,'half');assert.equal(init.headers.get('model'),'drama-3');assert.equal(init.headers.get('authorization'),'Bearer '+TOKEN);assert.equal(init.headers.get('content-type'),type);assert.deepEqual([...init.headers.keys()].sort(),['authorization','content-type','model']);assert.deepEqual(Buffer.from(await new Response(init.body).arrayBuffer()),Buffer.from(bytes));
        const upstream=new Response(mp3,{status:201,statusText:'Created',headers:{'Content-Type':'audio/mpeg','Content-Length':String(mp3.length),'X-Fixture':'retained'}});upstreamBody=upstream.body;return upstream;});
    const response=await proxy.fetch(incoming);assert.equal(response.body,upstreamBody);assert.equal(response.status,201);assert.equal(response.statusText,'Created');assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal(response.headers.get('x-fixture'),'retained');assert.deepEqual(Buffer.from(await response.arrayBuffer()),mp3);assert.equal(calls,1);
});
test('model is forwarded exactly and not invented when absent',async()=>{
    for(const model of ['drama-3','fixture-model']){const response=await worker(async(url,init)=>{assert.equal(init.headers.get('model'),model);return new Response(mp3,{headers:{'content-type':'audio/mpeg'}});}).fetch(request({headers:{model}}));assert.equal(response.status,200);await response.body.cancel();}
    const incoming=request();incoming.headers.delete('model');const response=await worker(async(url,init)=>{assert.equal(init.headers.has('model'),false);return new Response(null,{status:204});}).fetch(incoming);assert.equal(response.status,204);
});
test('Fish rejects every 3xx without forwarding Location or retaining the body',async()=>{
    for(const status of [300,301,302,303,304,307,308,399]){let calls=0,cancelled=0;const response=await worker(async(url,init)=>{calls++;assert.equal(url,FISH);assert.equal(init.redirect,'manual');return new Response(status===304?null:new ReadableStream({cancel(){cancelled++;}}),{status,headers:{Location:'https://other.example/?untrusted-echo='+TOKEN}});}).fetch(request());await safeError(response,502);assert.equal(calls,1);assert.equal(cancelled,status===304?0:1);}
});
test('Fish refuses an already redirected 200 response',async()=>{
    let calls=0,cancelled=0;const response=await worker(async(url,init)=>{calls++;assert.equal(init.redirect,'manual');const upstream=new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'audio/mpeg'}});Object.defineProperty(upstream,'redirected',{value:true});return upstream;}).fetch(request());await safeError(response,502);assert.equal(calls,1);assert.equal(cancelled,1);
});
test('Fish HTTP errors preserve status with fixed sanitized error text',async()=>{
    for(const status of [400,401,429,500]){let calls=0,cancelled=0;const response=await worker(async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('untrusted-echo '+TOKEN));},cancel(){cancelled++;}}),{status,statusText:'untrusted-echo '+TOKEN,headers:{'Content-Type':'text/plain','X-Echo':TOKEN}});}).fetch(request());await safeError(response,status);assert.equal(response.headers.has('x-echo'),false);assert.equal(calls,1);assert.equal(cancelled,1);}
});
test('Fish exceptions are sanitized without retry',async()=>{let calls=0;const response=await worker(async()=>{calls++;throw Error('untrusted-echo '+TOKEN);}).fetch(request());await safeError(response,502);assert.equal(calls,1);});
test('pre-aborted Fish request makes zero upstream calls',async()=>{let calls=0;const controller=new AbortController();controller.abort('untrusted-echo '+TOKEN);const response=await worker(async()=>{calls++;throw Error('Unexpected upstream');}).fetch(request({signal:controller.signal}));await safeError(response,499);assert.equal(calls,0);});
test('Fish cancellation propagates the original signal to its single upstream request',async()=>{
    const controller=new AbortController(),started=deferred(),incoming=request({signal:controller.signal});let calls=0;
    const pending=worker((url,init)=>{calls++;started.resolve();assert.equal(init.signal,incoming.signal);return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('untrusted-echo '+TOKEN)),{once:true}));}).fetch(incoming);
    await started.promise;controller.abort();await safeError(await pending,499);assert.equal(calls,1);
});
test('Fish late success after cancellation is discarded',async()=>{
    const controller=new AbortController(),started=deferred(),late=deferred();let calls=0,cancelled=0;const pending=worker(async()=>{calls++;started.resolve();return late.promise;}).fetch(request({signal:controller.signal}));await started.promise;controller.abort();late.resolve(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'audio/mpeg'}}));await safeError(await pending,499);assert.equal(calls,1);assert.equal(cancelled,1);
});
test('downstream cancellation reaches the upstream stream without buffering',async()=>{let cancelled=0;const upstream=new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'audio/mpeg'}});const response=await worker(async()=>upstream).fetch(request());assert.equal(response.body,upstream.body);assert.equal(response.bodyUsed,false);await response.body.cancel();assert.equal(cancelled,1);});
test('generic methods approved credentials SSE and redirect behavior retain the upstream contract',async()=>{
    for(const method of ['GET','HEAD','POST','PUT','DELETE']){const target='https://api.example/v1/messages?fixture=1',incoming=request({target,method,headers:{'X-Api-Key':'public-api-fixture','Anthropic-Version':'2023-06-01','Anthropic-Beta':'fixture','X-Goog-Api-Key':'public-google-fixture','HTTP-Referer':'https://game.example','X-Title':'game-fixture','X-Unapproved':'drop'}});let calls=0;
        const upstream=new Response('data: fixture\n\n',{status:202,headers:{'Content-Type':'text/event-stream','X-Original':'retained'}});
        const response=await worker(async(url,init)=>{calls++;assert.equal(url,target);assert.equal(init.method,method);assert.equal(init.redirect,undefined);assert.equal(init.body,['GET','HEAD'].includes(method)?undefined:incoming.body);assert.equal(init.headers.get('x-api-key'),'public-api-fixture');assert.equal(init.headers.get('anthropic-version'),'2023-06-01');assert.equal(init.headers.get('anthropic-beta'),'fixture');assert.equal(init.headers.get('x-goog-api-key'),'public-google-fixture');for(const name of ['http-referer','x-title','x-unapproved'])assert.equal(init.headers.has(name),false,'not in upstream allowlist');return upstream;}).fetch(incoming);
        assert.equal(response.body,upstream.body);assert.equal(response.status,202);assert.equal(response.headers.get('content-type'),'text/event-stream');assert.equal(await response.text(),'data: fixture\n\n');assert.equal(calls,1);
    }
});
test('generic target validation and network errors retain the upstream contract',async()=>{
    let calls=0;const proxy=worker(async()=>{calls++;throw Error('generic fixture failure');});for(const[url,status]of[['https://proxy.example/',400],['https://proxy.example/?target=invalid',400],['https://proxy.example/?target=http%3A%2F%2Fapi.example%2F',403]])assert.equal((await proxy.fetch(new Request(url))).status,status);assert.equal(calls,0);const response=await proxy.fetch(request({target:'https://api.example/v1/messages'}));assert.equal(response.status,502);assert.equal((await response.json()).error,'Upstream request failed: generic fixture failure');assert.equal(calls,1);
});
