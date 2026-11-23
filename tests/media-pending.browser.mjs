// Pending audio blocks new game mutations at their real entry points, not merely disabled buttons.
// Original roll confirmation, reader actions, settings decisions, commit and SIDE_NOTE all execute unchanged.
import assert from 'node:assert/strict';import path from 'node:path';import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {launchBrowser,newGameContext,startGame,json,fixturesRoot,workspace,assertSessionSafe} from '../scene3d/scripts/test-support.mjs';
import {startTestServer} from '../scene3d/scripts/test-server.mjs';
const out=path.resolve(process.argv[2]||path.join(workspace,'.scene3d-work','media-pending-'+Date.now()));await mkdir(out,{recursive:true});
const bytes=Array.from(await readFile(new URL('./scene3d/fixtures/audio/silence.mp3',import.meta.url)));
const marked='公开第一句待办对白。【D；轻声】|演武场|20:00|萧白瑚:平静|none\n公开第二句待办对白。【M；平静】|演武场|20:00|玄天青:平静|none';
const event={事件类型:'选项事件',事件描述:'公开已提交事件',选项一:{描述:'公开事件选项',奖励:'金钱+10',成功率:'100%'}};
const reply='<MAIN_TEXT>'+marked+'</MAIN_TEXT><SUMMARY>公开待办门控摘要。</SUMMARY><SIDE_NOTE>'+JSON.stringify({时间:'20:00',用户:{位置变动:'none'},当前NPC:{萧白瑚:{好感变化:'上升'}},随机事件:event})+'</SIDE_NOTE>';
const server=await startTestServer({gameRoot:workspace}),browser=await launchBrowser(),checks=[];let session;
async function clickReady(p,selector){const el=await p.waitForSelector(selector,{visible:true});await el.scrollIntoView();await p.waitForFunction(selector=>{const b=document.querySelector(selector),r=b?.getBoundingClientRect();return b&&!b.disabled&&!b.closest('[inert]')&&r.width>0&&r.height>0&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&!document.getAnimations().some(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)&&(a.pending||a.playState==='running'));},{timeout:15000},selector);await el.click();}
async function business(p){return p.evaluate(()=>({ap:actionPoints,mood:playerMood,stats:structuredClone(playerStats),favor:structuredClone(npcFavorability),location:userLocation,week:currentWeek,npcs:structuredClone(currentNpcLocations),history:storageService.loadUIConversation()}));}
async function dismiss(p){if(await p.$eval('#modal',n=>getComputedStyle(n).display!=='none'))await clickReady(p,'#modal button[onclick="closeModal()"]');}
try{
 for(const mode of ['discard','continue','silent']){
  try{
   const payload=await json(path.join(fixturesRoot,'saves/map.json'));payload.gameData.layoutMode=1;payload.gameData.userLocation='yanwuchang';payload.gameData.playerTalents={根骨:25,悟性:25,心性:0,魅力:0};
   const channel='media-pending-'+mode;session=await newGameContext(browser,server,{payload,channel,scene3dPreferences:{schema:2,enabled:false},viewport:{width:1280,height:720}});
   const p=session.page;p.setDefaultTimeout(20000);p.removeAllListeners('dialog');p.on('dialog',d=>d.accept());await startGame(session,server);
   await p.evaluate(async({reply,bytes})=>{
    closeModal();apiService.updateConfig({type:'openai',endpoint:'https://model.example/v1',apiKey:'PUBLIC_PENDING_MODEL_KEY',model:'fixture',streamMode:'non-stream',corsProxyEnabled:true,corsProxyUrl:'https://proxy.example/'});
    await speechService.saveConfig({provider:{kind:'fish-drama3',apiKey:'PUBLIC_PENDING_VOICE_KEY',speed:1},voices:{D:{kind:'fish-drama3',speakerId:'public-D',version:'1'},M:{kind:'fish-drama3',speakerId:'public-M',version:'1'}}});
    await speechRound.savePreferences({enabled:true});await speechStore.setSetting('single-test:main',{provider:'fish-drama3',enabled:false,targetNpcId:'D'});
    window.__pending={main:0,voices:0,side:0};const originalFetch=window.fetch;
    window.fetch=async function(url,options){const u=new URL(String(url),location.href);if(u.origin!=='https://proxy.example')return originalFetch.call(this,url,options);const target=u.searchParams.get('target');
      if(target==='https://model.example/v1/chat/completions'){__pending.main++;return new Response(JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}],usage:{total_tokens:1}}),{headers:{'Content-Type':'application/json'}});}
      if(target==='https://api.fish.audio/v1/tts'){__pending.voices++;if(__pending.voices===2)return new Response('{"error":"public failure"}',{status:500,headers:{'Content-Type':'application/json'}});return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'audio/mpeg'}});}
      throw Error('Unexpected fixture target');};
    const after=sideQuestRunner.afterCommit;sideQuestRunner.afterCommit=function(...args){__pending.side++;return after.apply(this,args);};
   },{reply,bytes});
   assert.equal(await p.evaluate(()=>speechRound.pendingState().ready),true,'startup warmed the synchronous gate');
   await clickReady(p,'#stage-input');await p.type('#free-action-input','公开准备待办');await clickReady(p,'#free-action-send-btn');await clickReady(p,'#srd-pause');await p.waitForFunction(()=>!pipeline.isBusy()&&!speechService.isBusy());
   const before=await business(p);assert.deepEqual(await p.evaluate(()=>({phase:speechRound.pendingState().phase,blocked:speechRound.pendingState().pending,busy:pipeline.isBusy(),main:__pending.main})),{phase:'paused',blocked:true,busy:false,main:1});
   await clickReady(p,'#stage-operation');await clickReady(p,'#yanwuchang-scene .scene-btn');assert.match(await p.$eval('#modal-text',n=>n.textContent),/先处理声音待办/);await dismiss(p);assert.deepEqual(await business(p),before);
   // A confirmation opened before a pending transition must also recheck, including the quick branch.
   for(const quick of [false,true]){
    await p.evaluate(()=>showRollActionConfirm('练武','yanwuchang'));
    await clickReady(p,`#modal button[onclick="confirmRollAction(${quick})"]`);assert.match(await p.$eval('#modal-text',n=>n.textContent),/先处理声音待办/);await dismiss(p);assert.deepEqual(await business(p),before);
   }
   await p.evaluate(()=>executeRollAction('练武','yanwuchang',false));await dismiss(p);assert.deepEqual(await business(p),before,'direct entry cannot bypass the synchronous check');
   await clickReady(p,'#stage-book');await clickReady(p,'#stage-input');await p.type('#free-action-input','仍保留的输入');await clickReady(p,'#free-action-send-btn');await dismiss(p);assert.equal(await p.$eval('#free-action-input',n=>n.value),'仍保留的输入');assert.deepEqual(await business(p),before);
    await clickReady(p,'#viewport-dock-gear');await clickReady(p,'#viewport-dock-menu [onclick*="attribute-dropdown"]');await clickReady(p,'#attribute-dropdown [onclick="showPlayerStats()"]');await clickReady(p,'#player-stats-scene [data-dialog-close]');await p.waitForFunction(()=>stageStory.reading());assert.equal(await p.evaluate(()=>userLocation),before.location);
    await clickReady(p,'#viewport-dock-gear');await clickReady(p,'#viewport-dock-menu .be-seal-system');await clickReady(p,'#system-dropdown button:first-child');await clickReady(p,'.gs-tab[data-tab="speech"]');await p.waitForSelector('#sr-resume',{visible:true});
   assert.deepEqual(await p.evaluate(()=>['sr-resume','sr-silent','sr-discard'].map(id=>document.getElementById(id).disabled)),[false,false,false]);
   assert.equal(await p.evaluate(()=>__pending.main),1,'blocked actions did not request the main model');
   if(mode==='discard'){
    await clickReady(p,'#sr-discard');await p.waitForFunction(()=>speechRound.pendingState().phase==='discarded'&&!speechRound.pendingState().pending);
    await clickReady(p,'#game-settings-modal button[onclick="closeGameSettings()"]');
    await clickReady(p,'#stage-operation');await p.waitForFunction(()=>!stageStory.reading());
    await clickReady(p,'#yanwuchang-scene .scene-btn');
    const expected=await p.evaluate(()=>{const state=__scene3dTest.rng().state;const one=(Math.imul(1664525,state)+1013904223)>>>0,two=(Math.imul(1664525,one)+1013904223)>>>0;
      const value=(two/4294967296*100+getTotalTalents()[actionConfigs['练武'].talentBonus]/2)*(playerMood+10)/100;
      return{ap:actionPoints-1,mood:Math.max(0,playerMood-(value>=80?0:value>=60?5:value>=40?10:value>=20?15:20)),wuxue:playerStats.武学+(value>=80?5:value>=60?3:value>=40?1:0)};});
    await clickReady(p,'#modal button[onclick="confirmRollAction(false)"]');
    await p.waitForFunction(async()=>!pipeline.isBusy()&&(await speechRound.load())?.phase==='published');
    assert.deepEqual(await p.evaluate(()=>({ap:actionPoints,mood:playerMood,wuxue:playerStats.武学})),expected,'original roll cost/result applied exactly once after discard');
   }else{
    await clickReady(p,mode==='continue'?'#sr-resume':'#sr-silent');await p.waitForFunction(async()=>!pipeline.isBusy()&&(await speechRound.load())?.phase==='published');
    assert.deepEqual(await p.evaluate(()=>({ap:actionPoints,mood:playerMood,stats:structuredClone(playerStats)})),{ap:before.ap,mood:before.mood,stats:before.stats});
   }
   const result=await p.evaluate(async()=>({phase:(await speechRound.load()).phase,blocked:speechRound.pendingState().pending,time:currentGameTime,day:dayNightStatus,favor:npcFavorability.D,
     event:currentRandomEvent?.事件描述,eventButtons:document.querySelectorAll('#event-options button').length,eventOwner:document.querySelector('#stage-event-tail #event-description')?.textContent===currentRandomEvent?.事件描述,
     input:inputEnable,main:__pending.main,voice:__pending.voices,side:__pending.side,latest:storageService.loadUIConversation().filter(m=>m.role==='assistant').at(-1)?.roundSpeech?.status}));
   assert.equal(result.phase,'published');assert.equal(result.blocked,false);assert.equal(result.time,'20:00');assert.equal(result.day,'night');assert.equal(result.favor,before.favor.D+1,'real SIDE_NOTE favor gain was not blocked in committing');
   assert.equal(result.event,'公开已提交事件');assert.equal(result.eventButtons,1);assert.equal(result.eventOwner,true);assert.equal(result.input,0,'original event-specific input lock remains');
   assert.equal(result.main,mode==='discard'?2:1);assert.equal(result.side,1);assert.equal(result.latest,mode==='silent'?'silent':'ready');
   assertSessionSafe(session,server,channel);await p.screenshot({path:path.join(out,mode+'.png')});checks.push({mode,status:'PASS',result});
  }catch(error){const state=session?await session.page.evaluate(()=>({reading:stageStory.reading(),gate:speechRound.pendingState(),net:window.__pending,modal:document.getElementById('modal-text')?.textContent,status:document.getElementById('sr-status')?.textContent,location:userLocation})).catch(()=>null):null;
   checks.push({mode,status:'FAIL',message:error.message,state});if(session){await session.page.screenshot({path:path.join(out,mode+'-failure.png')}).catch(()=>{});await writeFile(path.join(out,mode+'-failure.json'),JSON.stringify({message:error.message,state,logs:session.logs,violations:session.violations},null,2));}
  }finally{if(session){await session.close();session=null;}}
 }
 const status=checks.every(c=>c.status==='PASS')?'PASS':'FAIL';await writeFile(path.join(out,'report.json'),JSON.stringify({status,checks,boundary:'Real Chromium DOM/game/IDB/audio decoding; public fixture and mock HTTP only. No real API, device or push.'},null,2));console.log(JSON.stringify({out,status,checks}));assert.equal(status,'PASS');
}finally{if(session)await session.close();await browser.close();await server.close();}
