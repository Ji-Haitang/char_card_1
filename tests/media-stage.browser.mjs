// Real game DOM with public state and isolated browser storage. Network policy is inherited from test-support.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,newGameContext,startGame,json,fixturesRoot,workspace,assertSessionSafe} from '../scene3d/scripts/test-support.mjs';
import {startTestServer} from '../scene3d/scripts/test-server.mjs';
const out=path.resolve(process.argv[2]||path.join(workspace,'.scene3d-work','media-stage-'+Date.now()));await mkdir(out,{recursive:true});
const server=await startTestServer({gameRoot:workspace}),browser=await launchBrowser(),results=[];
let session;
try{
 for(const width of [1280,844])for(const mode of [0,1]){
  const payload=await json(path.join(fixturesRoot,'saves/map.json'));
  session=await newGameContext(browser,server,{payload,channel:'media-stage-'+width+'-'+mode,scene3dPreferences:{schema:2,enabled:false},viewport:{width,height:width===844?390:720}});
  const p=session.page;p.setDefaultTimeout(15000);await startGame(session,server);
  await p.evaluate(mode=>{
   closeModal();mediaContext.invalidate();GameMode=mode;gameData.GameMode=mode;inputEnable=1;currentRandomEvent=null;currentBattleEvent=null;currentSpecialEvent=null;
   companionNPC=['D','M'];gameData.companionNPC=companionNPC;mapLocation=mode===1?'沙州':'天山派';gameData.mapLocation=mapLocation;
   currentGameTime='12:00';isStoryExpanded=false;currentPage=0;applyLayoutMode(1);
   const scene=mode===1?'街道':'山门',source='公开第一段。|'+scene+'|09:00|萧白瑚:平静|none\n重复正文。|'+scene+'|10:00|玄天青:平静|none\n重复正文。|'+scene+'|11:00|玄天青:平静|none';
   renderMainText(source);const plan=presentationPlan.captureCurrent(source,'committed','');
   storageService.replaceUIConversation([{id:'public-media-'+mode,role:'assistant',content:source,createdAt:1,presentationPlan:plan}]);gameData.presentationCursor=null;
   document.getElementById('free-action-input').value='公开草稿';window.__originalFree=document.querySelector('.free-action-row');window.__originalParent=__originalFree.parentElement;
  },mode);
   await p.waitForFunction(()=>stageStory.reading());await p.click('.stage-line button:last-child');
   if(mode===0){await p.click('#stage-operation');await p.click('#stage-book');}else{await p.click('#stage-view');await p.click('#stage-backdrop');}
   assert.equal(await p.$eval('.stage-line p',n=>n.textContent),'重复正文。');
   await p.click('#stage-input');assert.deepEqual(await p.evaluate(()=>({same:document.querySelector('.free-action-row')===__originalFree,count:document.querySelectorAll('#free-action-input').length,draft:document.getElementById('free-action-input').value})),{same:true,count:1,draft:'公开草稿'});
   await p.click('#stage-input');
  await p.screenshot({path:path.join(out,'mode-'+mode+'-'+width+'.png')});assertSessionSafe(session,server,'media-stage-'+width+'-'+mode);
  results.push({mode,width,status:'PASS'});await session.close();session=null;
 }
 await writeFile(path.join(out,'report.json'),JSON.stringify({status:'PASS',results,boundary:'Isolated Chromium and public fixture; actual DOM/controllers/storage, no real model or TTS request.'},null,2));console.log(JSON.stringify({out,results}));
}catch(error){if(session){await session.page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await writeFile(path.join(out,'failure.json'),JSON.stringify({message:error.message,logs:session.logs,network:session.network,violations:session.violations},null,2));}throw error;}
finally{if(session)await session.close();await browser.close();await server.close();}
