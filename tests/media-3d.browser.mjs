// The upstream renderer and published assets run unchanged; this tests only the presentation lease around them.
import assert from 'node:assert/strict';import path from 'node:path';import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,newGameContext,startGame,json,fixturesRoot,workspace,assertSessionSafe} from '../scene3d/scripts/test-support.mjs';
import {startTestServer} from '../scene3d/scripts/test-server.mjs';
const out=path.resolve(process.argv[2]||path.join(workspace,'.scene3d-work','media-3d-'+Date.now()));await mkdir(out,{recursive:true});
const server=await startTestServer({gameRoot:workspace}),browser=await launchBrowser();let session;
try{
 const payload=await json(path.join(fixturesRoot,'saves/map.json'));payload.gameData.userLocation='huofang';payload.gameData.layoutMode=1;
 session=await newGameContext(browser,server,{payload,channel:'media-3d',scene3dPreferences:{schema:2,enabled:true},viewport:{width:1280,height:720}});
 const p=session.page;p.setDefaultTimeout(30000);await startGame(session,server);
 await p.waitForFunction(()=>GameSceneBridge.getDiagnostics().readyScene==='kitchen'&&GameSceneBridge.getDiagnostics().renderer);
 const before=await p.evaluate(()=>({location:userLocation,scene:GameSceneBridge.getDiagnostics().readyScene,canvas:document.querySelectorAll('#main-viewport canvas').length}));assert.ok(before.canvas>0);
 await p.evaluate(()=>{closeModal();const source='公开历史山门。|山门|09:00|萧白瑚:平静|none';renderMainText(source);storageService.replaceUIConversation([{id:'public-3d-history',role:'assistant',content:source,presentationPlan:presentationPlan.captureCurrent(source,'committed',''),createdAt:1}]);});
 await p.waitForFunction(()=>stageStory.reading());
 assert.equal(await p.$eval('.stage-line p',n=>n.textContent),'公开历史山门。');
 assert.equal(await p.evaluate(()=>userLocation),'huofang');await p.screenshot({path:path.join(out,'reading.png')});
 await p.click('#stage-operation');await p.waitForFunction(()=>!stageStory.reading()&&GameSceneBridge.getDiagnostics().readyScene==='kitchen');
 const after=await p.evaluate(()=>({location:userLocation,scene:GameSceneBridge.getDiagnostics().readyScene,canvas:document.querySelectorAll('#main-viewport canvas').length,errors:GameSceneBridge.getDiagnostics().errors}));
 assert.equal(after.location,before.location);assert.equal(after.scene,before.scene);assert.equal(after.canvas,before.canvas);assert.equal(await p.$('#presentation-reader'),null);
 await p.click('.scene3d-sightseeing');await p.waitForSelector('.scene3d-sightseeing-exit',{visible:true});assert.ok(await p.$eval('#stage-book',e=>!e.checkVisibility()));await p.click('.scene3d-sightseeing-exit');await p.waitForSelector('#stage-book',{visible:true});
 await p.setViewport({width:844,height:390});await p.click('#stage-book');await p.waitForFunction(()=>{const imgs=[...document.querySelectorAll('.stage-story-layers img')];return imgs.length>=2&&imgs.every(i=>i.complete&&i.naturalWidth);});await p.screenshot({path:path.join(out,'844-performance.png')});await p.click('#stage-view');await p.click('#stage-backdrop');assert.ok(await p.$eval('.stage-line p',e=>e.checkVisibility()));await p.click('#stage-operation');
 assertSessionSafe(session,server,'media-3d');await p.screenshot({path:path.join(out,'operation.png')});await writeFile(path.join(out,'report.json'),JSON.stringify({status:'PASS',before,after,boundary:'Actual upstream WebGL renderer and Git-pinned resources; isolated Chromium, not Android hardware.'},null,2));console.log(JSON.stringify({out,status:'PASS'}));
}catch(error){if(session){await session.page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});const diagnostics=await session.page.evaluate(()=>window.GameSceneBridge?.getDiagnostics()).catch(()=>null);await writeFile(path.join(out,'failure.json'),JSON.stringify({message:error.message,diagnostics,logs:session.logs,violations:session.violations,events:server.events},null,2));}throw error;}
finally{if(session)await session.close();await browser.close();await server.close();}
