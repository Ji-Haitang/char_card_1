// End-to-end game commit with deterministic model/voice HTTP responses and real persistence/playback preparation.
// Silence fixture: https://github.com/anars/blank-audio/blob/master/1-second-of-silence.mp3
// ID3 metadata removed; 1224 MPEG bytes, SHA256 8833357c87a7ae5a38eb49572f112e89efdd5629cf494fbadf4032f0eb02125d.
import assert from 'node:assert/strict';import path from 'node:path';import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {launchBrowser,newGameContext,startGame,json,fixturesRoot,workspace,assertSessionSafe} from '../scene3d/scripts/test-support.mjs';
import {startTestServer} from '../scene3d/scripts/test-server.mjs';
const out=path.resolve(process.argv[2]||path.join(workspace,'.scene3d-work','media-turn-'+Date.now()));await mkdir(out,{recursive:true});
const mp3=Array.from(await readFile(new URL('./scene3d/fixtures/audio/silence.mp3',import.meta.url)));
const source='公开旧正文。|山门|09:00|萧白瑚:平静|none';
const plain='第一句公开对白。|山门|12:30|萧白瑚:平静;玄天青:平静|none\n第二句公开对白。|山门|12:30|萧白瑚:平静;玄天青:平静|none';
const marked='第一句公开对白。【D；轻声】|山门|12:30|萧白瑚:平静;玄天青:平静|none\n第二句公开对白。【M；平静】|山门|12:30|萧白瑚:平静;玄天青:平静|none';
const legacyPlain='第一句公开对白。|萧白瑚|演武场|平静|none\n第二句公开对白。|玄天青|演武场|平静|none';
const legacyMarked='第一句公开对白。【D；轻声】|萧白瑚|演武场|平静|none\n第二句公开对白。【M；平静】|玄天青|演武场|平静|none';
const envelope=(body,time='12:30')=>'<MAIN_TEXT>'+body+'</MAIN_TEXT><SUMMARY>公开测试摘要。</SUMMARY><SIDE_NOTE>{"时间":"'+time+'","用户":{"位置变动":"none"}}</SIDE_NOTE>';
const server=await startTestServer({gameRoot:workspace}),browser=await launchBrowser(),checks=[];let session;
try{
 for(const kind of ['off','single','round','native-round','tool-round','world-round','round-fail','round-abort']){
  session=await newGameContext(browser,server,{payload:await json(path.join(fixturesRoot,'saves/map.json')),channel:'media-turn-'+kind,scene3dPreferences:{schema:2,enabled:false},viewport:{width:1280,height:720}});
  const p=session.page;p.setDefaultTimeout(20000);await startGame(session,server);
  await p.evaluate(async({kind,source,reply,bytes})=>{
   closeModal();mediaContext.invalidate();GameMode=0;gameData.GameMode=0;inputEnable=1;newWeek=0;gameData.newWeek=0;randomEvent=battleEvent=0;currentRandomEvent=currentBattleEvent=currentSpecialEvent=null;isStoryExpanded=false;currentPage=0;actionPoints=3;
   if(kind==='world-round'){currentGameTime='09:00';dayNightStatus='daytime';syncGameDataFromVariables();}
   renderMainText(source);storageService.replaceUIConversation([{id:'public-before',role:'assistant',content:source,createdAt:1}]);gameData.presentationCursor=null;applyLayoutMode(1);
   apiService.updateConfig({endpoint:'https://model.example/v1',apiKey:'PUBLIC_MAIN_KEY',model:'fixture-model',streamMode:'non-stream',toolOutputEnabled:kind==='tool-round',corsProxyEnabled:true,corsProxyUrl:'https://proxy.example/'});
   await speechService.saveConfig({provider:{kind:'fish-drama3',apiKey:'PUBLIC_FISH_KEY',speed:1},voices:{D:{kind:'fish-drama3',speakerId:'voice-D',version:'1'},M:{kind:'fish-drama3',speakerId:'voice-M',version:'1'}}});
   await speechRound.savePreferences({enabled:kind.includes('round')});await speechStore.setSetting('single-test:main',{provider:'fish-drama3',enabled:kind==='single',targetNpcId:'D'});
   window.__mediaRun={main:0,voice:[],side:0,sideEntered:false,done:false,result:null,reply};
   const nativeFetch=window.fetch;
   window.fetch=async function(url,options){
    const u=new URL(String(url));if(u.origin!=='https://proxy.example')return nativeFetch.call(this,url,options);
    const target=u.searchParams.get('target'),headers=new Headers(options.headers),body=JSON.parse(options.body);
    if(target==='https://model.example/v1/chat/completions'){
     __mediaRun.main++;__mediaRun.messages=body.messages;__mediaRun.mainKeyOK=headers.get('Authorization')==='Bearer PUBLIC_MAIN_KEY';
     const choice=kind==='tool-round'?{message:{content:null,tool_calls:[{id:'public-call',type:'function',function:{name:'submit_game_output',arguments:JSON.stringify({display_stream:reply})}}]},finish_reason:'tool_calls'}:{message:{content:reply},finish_reason:'stop'};
     return new Response(JSON.stringify({choices:[choice],usage:{total_tokens:1}}),{headers:{'Content-Type':'application/json'}});
    }
    if(target==='https://api.fish.audio/v1/tts'){
     __mediaRun.voice.push({text:body.text,id:body.reference_id,model:headers.get('model'),keyOK:headers.get('Authorization')==='Bearer PUBLIC_FISH_KEY'});
     if(__mediaRun.voice.length===1)await new Promise(resolve=>__mediaRun.releaseVoice=resolve);
     if(kind==='round-fail'&&__mediaRun.voice.length===2)return new Response('{"error":"public failure"}',{status:500,headers:{'Content-Type':'application/json'}});
     __mediaRun.voiceReturned=true;
     return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'audio/mpeg'}});
    }
    throw Error('Unexpected fixture target');
   };
   if(kind==='native-round'){
    __mediaRun.nativeCalls=0;
    window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',isPluginAvailable:()=>true,Plugins:{CapacitorHttp:{request:async request=>{
     if(request.url!=='https://api.fish.audio/v1/tts'||request.responseType!=='arraybuffer'||request.disableRedirects!==true)throw Error('Invalid native request');
     __mediaRun.nativeCalls++;
     const response=await window.fetch('https://proxy.example?target='+encodeURIComponent(request.url),{method:request.method,headers:request.headers,body:JSON.stringify(request.data)});
     const data=new Uint8Array(await response.arrayBuffer());let binary='';for(const b of data)binary+=String.fromCharCode(b);
     return {status:response.status,headers:Object.fromEntries(response.headers),data:btoa(binary),url:request.url};
    }}}};
   }
   const after=sideQuestRunner.afterCommit;sideQuestRunner.afterCommit=async function(...args){__mediaRun.side++;__mediaRun.sideEntered=true;await new Promise(resolve=>__mediaRun.releaseSide=resolve);return after.apply(this,args);};
   document.getElementById('free-action-input').value='公开测试行动';
  },{kind,source,reply:envelope(kind==='off'?plain:kind==='world-round'?legacyMarked:marked,kind==='world-round'?'20:00':'12:30'),bytes:mp3});
  if(kind==='round'||kind==='native-round'){
   await p.click('.story-content-wrapper');await p.waitForFunction(()=>presentationHost.getDiagnostics().phase==='open');
   await p.click(kind==='round'?'#pr-input-toggle':'#pr-menu-toggle');
  }
  await p.click('#free-action-send-btn');
  if(kind.includes('round')){
   await p.waitForFunction(()=>__mediaRun.voice.length===1);
   assert.deepEqual(await p.evaluate(()=>({content:currentStoryText,assistants:storageService.loadUIConversation().filter(m=>m.role==='assistant').length,side:__mediaRun.side,busy:pipeline.isBusy()})),{content:source,assistants:1,side:0,busy:true});
   if(kind==='round-abort'){
    await p.click('#stream-stop-btn');await p.waitForFunction(()=>!pipeline.isBusy());
    await p.evaluate(()=>__mediaRun.releaseVoice());await p.waitForFunction(()=>__mediaRun.voiceReturned);
    await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const cancelled=await p.evaluate(async()=>({source:currentStoryText,rows:storageService.loadUIConversation().length,side:__mediaRun.side,voice:__mediaRun.voice.length,phase:(await speechRound.load()).phase,turns:(await speechStore.listTurns('main')).length,host:presentationHost.isActive()}));
    assert.deepEqual(cancelled,{source,rows:1,side:0,voice:1,phase:'paused',turns:0,host:false});
    checks.push({kind,status:'PASS',state:cancelled});assertSessionSafe(session,server,'media-turn-'+kind);await session.close();session=null;continue;
   }
   await p.evaluate(()=>__mediaRun.releaseVoice());
   if(kind==='round-fail'){
    await p.waitForSelector('#srd-silent',{visible:true});assert.equal(await p.evaluate(()=>storageService.loadUIConversation().length),1);
    await p.waitForFunction(()=>{const b=document.getElementById('srd-silent'),r=b?.getBoundingClientRect();return b&&!b.disabled&&!b.closest('[inert]')&&r.width>0&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&!document.getAnimations().some(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)&&(a.pending||a.playState==='running'));});
    await p.click('#srd-silent');
   }
  }
  await p.waitForFunction(()=>__mediaRun.sideEntered);
  assert.equal(await p.evaluate(()=>pipeline.isBusy()),true);assert.equal(await p.evaluate(()=>presentationHost.isActive()),false);
  assert.equal(await p.evaluate(()=>document.body.classList.contains('presentation-wait-active')),true);
  await p.evaluate(()=>__mediaRun.releaseSide());
  await p.waitForFunction(()=>!pipeline.isBusy()&&presentationHost.getDiagnostics().phase==='open');
  const state=await p.evaluate(async()=>{const rows=storageService.loadUIConversation(),last=rows.filter(m=>m.role==='assistant').at(-1),draft=await speechRound.load();return {nativeCalls:__mediaRun.nativeCalls||0,main:__mediaRun.main,mainKeyOK:__mediaRun.mainKeyOK,voice:__mediaRun.voice,side:__mediaRun.side,users:rows.filter(m=>m.role==='user').length,assistants:rows.filter(m=>m.role==='assistant').length,content:last.content,plan:!!last.presentationPlan,world:last.presentationPlan?.world.dayNightStatus,actualWorld:dayNightStatus,replayable:last.roundSpeech?.status==='ready'?!!(await speechRound.replay(last,last.presentationPlan,0)):null,single:last.singleSpeech?.renderVersion,round:last.roundSpeech?.status,finish:last.roundSpeech?.finishReason,draft:draft?.phase};});
  assert.equal(state.main,1);assert.equal(state.mainKeyOK,true);assert.equal(state.side,1);assert.equal(state.users,1);assert.equal(state.assistants,2);assert.equal(state.content,kind==='world-round'?legacyPlain:plain);assert.equal(state.plan,true);
  if(kind==='world-round'){assert.equal(state.world,'night');assert.equal(state.actualWorld,'night');assert.equal(state.replayable,true);assert.match(await p.$eval('.pr-background img',n=>n.getAttribute('src')),/演武场_夜\.webp/);}
  if(kind.includes('round')){assert.deepEqual(state.voice,[{text:'[轻声] 第一句公开对白。',id:'voice-D',model:'drama-3',keyOK:true},{text:'[平静] 第二句公开对白。',id:'voice-M',model:'drama-3',keyOK:true}]);assert.equal(state.round,kind==='round-fail'?'silent':'ready');assert.equal(state.finish,kind==='tool-round'?'tool_calls':'stop');assert.equal(state.draft,'published');}
  else assert.equal(state.voice.length,0);
  if(kind==='native-round')assert.equal(state.nativeCalls,2);
  if(kind==='single'){
   assert.equal(state.single,'drama3-v1');
   p.removeAllListeners('dialog');p.on('dialog',dialog=>dialog.accept().catch(()=>{}));
   await p.click('#pr-menu-toggle');await p.waitForFunction(()=>{const n=document.getElementById('pr-drawer');return n&&!n.hidden&&getComputedStyle(n).opacity==='1';});
   await p.click('#pr-speech-single');await p.waitForSelector('#sst-generate',{visible:true});
   await p.waitForFunction(()=>{const b=document.getElementById('sst-generate');return b&&!b.disabled&&!b.closest('[inert]');});
   await p.click('#sst-generate');await p.waitForFunction(()=>__mediaRun.voice.length===1);await p.evaluate(()=>__mediaRun.releaseVoice());
   await p.waitForFunction(()=>document.getElementById('sst-play')&&!document.getElementById('sst-play').disabled&&!document.getElementById('sst-generate').disabled);
   const clip=await p.evaluate(async()=>{const msg=storageService.loadUIConversation().filter(m=>m.role==='assistant').at(-1),turn=await speechStore.getTurn('main','d3-m2a:'+msg.id);return {renderVersion:turn.renderVersion,units:turn.units.length,calls:__mediaRun.voice.length};});
   assert.deepEqual(clip,{renderVersion:'drama3-v1',units:1,calls:1});
   await p.click('#sst-play');assert.equal(await p.evaluate(()=>__mediaRun.voice.length),1);await p.click('#sst-close');
  }
  await p.screenshot({path:path.join(out,kind+'.png')});assertSessionSafe(session,server,'media-turn-'+kind);
  checks.push({kind,status:'PASS',state});await session.close();session=null;
 }
 await writeFile(path.join(out,'report.json'),JSON.stringify({status:'PASS',checks},null,2));console.log(JSON.stringify({out,passed:checks.length}));
}catch(error){if(session){await session.page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});const state=await session.page.evaluate(()=>({run:window.__mediaRun,host:typeof presentationHost==='undefined'?null:presentationHost.getDiagnostics(),flow:typeof presentationFlow==='undefined'?null:presentationFlow.getDiagnostics(),text:typeof currentStoryText==='undefined'?null:currentStoryText,status:document.getElementById('stream-log')?.textContent,decision:Array.from(document.querySelectorAll('#speech-round-decision-modal button')).map(b=>({id:b.id,disabled:b.disabled,inert:!!b.closest('[inert]'),rect:(()=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,200)}})()}))})).catch(()=>null);await writeFile(path.join(out,'failure.json'),JSON.stringify({message:error.message,state,logs:session.logs,violations:session.violations},null,2));}throw error;}
finally{if(session)await session.close();await browser.close();await server.close();}
