import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,newGameContext,startGame,json,fixturesRoot} from '../../scene3d/scripts/test-support.mjs';
import {startTestServer} from '../../scene3d/scripts/test-server.mjs';
const output=path.resolve(process.argv[2]||'.scene3d-work/settings-dialogs');
await mkdir(output,{recursive:true});
const server=await startTestServer({gameRoot:process.cwd()});const browser=await launchBrowser();const results=[];
const settle=()=>new Promise(r=>setTimeout(r,400));
try{for(const [width,height] of [[390,844],[844,390],[667,375],[844,240],[1440,900]])for(const style of [0,1]){
 const label=`${width}x${height}-${style?'flat':'ancient'}`;
 const s=await newGameContext(browser,server,{payload:await json(path.join(fixturesRoot,'saves/map.json')),channel:label,style,viewport:{width,height,deviceScaleFactor:1,hasTouch:width<1000,isMobile:width<1000},scene3dPreferences:{schema:2,enabled:false,quality:'low'}});const p=s.page;
 try{await startGame(s,server);await p.evaluate(()=>{closeModal();showConfigModal();});await settle();
 const inspect=async(id,footer)=>p.evaluate(({id,footer})=>{const modal=document.querySelector(id),panel=modal.querySelector('.cfg-panel'),f=modal.querySelector(footer),r=panel.getBoundingClientRect(),b=f.getBoundingClientRect();return {within:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,footerVisible:b.top>=r.top&&b.bottom<=r.bottom+1,overflow:panel.scrollWidth>panel.clientWidth+2,background:getComputedStyle(panel).backgroundColor};},{id,footer});
 let layout=await inspect('#api-config-modal','.cfg-footer');assert.ok(layout.within&&layout.footerVisible&&!layout.overflow,JSON.stringify(layout));
 await p.screenshot({path:path.join(output,`${label}-api.png`)});
 const before=await p.evaluate(()=>JSON.stringify(apiService.getConfig()));await p.evaluate(()=>{window.__confirms=[];window.confirm=m=>{__confirms.push(m);return true;};});await p.type('#api-endpoint-input','cancel-test');await p.click('#api-config-modal .cfg-footer button:first-child');assert.equal(await p.$('#api-config-modal'),null);assert.match((await p.evaluate(()=>__confirms.join('|'))),/主 API 有未保存的修改/);assert.equal(await p.evaluate(()=>JSON.stringify(apiService.getConfig())),before);
 await p.evaluate(()=>showConfigModal());await settle();await p.focus('#api-max-tokens-input');await p.keyboard.down('Control');await p.keyboard.press('A');await p.keyboard.up('Control');await p.keyboard.press('Backspace');await p.type('#api-max-tokens-input','4096');await p.click('#cfg-primary-save-btn');assert.equal(await p.evaluate(()=>apiService.getConfig().maxOutputTokens),4096);assert.match(await p.$eval('#cfg-primary-save-status',e=>e.textContent),/已保存/);await p.click('#api-config-modal .cfg-footer button:first-child');assert.equal(await p.$('#api-config-modal'),null);
 await p.evaluate(()=>promptManagerModal.open('INFO_TONE'));await settle();layout=await inspect('#prompt-editor-modal','.modal-buttons');assert.ok(layout.within&&layout.footerVisible&&!layout.overflow,JSON.stringify(layout));
 await p.screenshot({path:path.join(output,`${label}-prompt.png`)});await p.click('#prompt-editor-modal button[onclick*="_close"]');assert.equal(await p.$('#prompt-editor-modal'),null);
 await p.goto(`${server.origin}/start-screen-noST.html`,{waitUntil:'load'});await p.evaluate(()=>showConfigModal());await settle();const startLayout=await inspect('#api-config-modal','.cfg-footer');assert.ok(startLayout.within&&startLayout.footerVisible&&!startLayout.overflow,JSON.stringify(startLayout));await p.screenshot({path:path.join(output,`${label}-start-api.png`)});await p.click('#api-config-modal .cfg-footer button:first-child');assert.equal(await p.$('#api-config-modal'),null);
 results.push({label,pass:true,layout,startLayout});
 }catch(e){results.push({label,pass:false,error:e.stack});await p.screenshot({path:path.join(output,`${label}-failure.png`)});}finally{await s.close();}
}}finally{await browser.close();await server.close();await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
