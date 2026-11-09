import path from 'node:path';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {launchBrowser, newGameContext, startGame, json, fixturesRoot} from '../../scene3d/scripts/test-support.mjs';
import {startTestServer} from '../../scene3d/scripts/test-server.mjs';
const output = path.resolve(process.argv[2] || '.scene3d-work/dialog-responsive');
await mkdir(output, {recursive:true});
// Build a synthetic SAVE before newGameContext bootstraps the application.
// Only the trusted, side-effect-free item/skill catalog files are evaluated in Node.
// No runtime inventory, skills or history variables are injected after load.
const catalog=vm.runInNewContext((await readFile('module/item-list.js','utf8'))+';item_list');
const skills=vm.runInNewContext((await readFile('module/skill-list.js','utf8'))+';skillList');
const richPayload=await json(path.join(fixturesRoot,'saves/map.json'));
const itemNames=Object.keys(catalog).slice(0,72);
const pick=type=>Object.keys(catalog).filter(n=>catalog[n].装备类型===type);
const equipped={武器:pick('武器')[0],防具:pick('防具')[0],饰品1:pick('饰品')[0],饰品2:pick('饰品')[1]};
for(const name of Object.values(equipped))if(name&&!itemNames.includes(name))itemNames.push(name);
const skillIds=Object.keys(skills);
const longHistory=Array.from({length:80},(_,i)=>`第${i+1}段合成游历记录：弟子在门派中整理物品、研读典籍并与同门交流。此段用于验证长文本换行与汗青集滚动，不调用模型或改变实际游戏状态。${' 天山风雪渐息，藏经阁灯火长明。'.repeat(4)}`).join('\n\n')+'\n历史末项标记-DIALOG-END';
Object.assign(richPayload.gameData,{inventory:Object.fromEntries(itemNames.map((n,i)=>[n,i+2])),equipment:equipped,learnedSkills:Object.fromEntries(skillIds.map(id=>[id,3])),equippedSkills:Object.fromEntries(skillIds.slice(0,2).map(id=>[id,2])),summary_Small:longHistory,summary_Week:longHistory,summary_Backup:longHistory});
richPayload.gameData.playerStats.学识=200;
richPayload.summaryHistory=Array.from({length:80},(_,i)=>({id:`dialog-summary-${i}`,week:2,gameTime:'合成测试',summaryText:`第${i+1}条摘要：${longHistory.slice(0,160)}`,source:'llm',createdAt:1767225600000+i}));
await writeFile(path.join(output,'rich-save-payload.json'),JSON.stringify(richPayload,null,2));
const server = await startTestServer({gameRoot:process.cwd()});
const browser = await launchBrowser();
const results=[];
const cases = process.env.DIALOG_QUICK ? [[844,390,0,false]] : [
 [390,844,0,false], [390,844,1,true], [844,390,0,true], [844,390,1,false],
 [667,375,0,false], [360,640,1,false], [1440,900,0,true], [1920,1080,1,false]
];
try {
 for(const [width,height,style,scene3d] of cases) {
  const label=`${width}x${height}-${style?'flat':'ancient'}-${scene3d?'3d':'2d'}`;
  const session=await newGameContext(browser,server,{payload:richPayload,channel:label,style,viewport:{width,height,deviceScaleFactor:1,hasTouch:width<1000,isMobile:width<1000},scene3dPreferences:{schema:2,enabled:scene3d,quality:'low'}});
  const {page}=session;
  try {
   await startGame(session,server);
   const loadedFixture=await page.evaluate(()=>({items:Object.keys(inventory).filter(n=>inventory[n]>0&&item_list[n]).length,learned:Object.keys(learnedSkills).length,equipped:Object.values(equipment).filter(Boolean).length,historyLength:summary_Small.length}));
   results.push({label,name:'rich-fixture-loaded',evidence:loadedFixture,pass:loadedFixture.items>=72&&loadedFixture.learned>=8&&loadedFixture.equipped===4&&loadedFixture.historyLength>10000});
   await page.evaluate(landscape=>{closeModal();if(landscape){const t=document.getElementById('gs-layout-toggle');t.checked=true;gsOnLayoutMode(t);}},width>height);
   // schema:2 is explicitly supported by test-support.mjs:134-137 and the bridge.
   // Preference alone is not proof: require a ready, drawn renderer and a real canvas.
   const rendererRecord={label,name:'renderer-evidence'};
   try {
    await page.waitForFunction(enabled=>{
     const d=window.GameSceneBridge?.getDiagnostics();
     if(!d?.started)return false;
     if(!enabled)return !d.preferences.enabled&&!d.renderer;
     const c=document.querySelector('#sect-3d-root canvas');
     return d.preferences.enabled&&d.renderer?.ready&&d.renderer.frames>0&&d.readyScene===d.snapshot?.sceneId&&c?.width>0&&c?.height>0&&document.getElementById('main-viewport').dataset.scene3dReady==='true';
    },{timeout:60000},scene3d);
    rendererRecord.pass=true;
   }catch(e){rendererRecord.pass=false;rendererRecord.error=e.message;}
   rendererRecord.evidence=await page.evaluate(()=>({diagnostics:window.GameSceneBridge?.getDiagnostics(),canvas:[...document.querySelectorAll('#sect-3d-root canvas')].map(c=>{const r=c.getBoundingClientRect();return {width:c.width,height:c.height,cssWidth:r.width,cssHeight:r.height,display:getComputedStyle(c).display};}),ready:document.getElementById('main-viewport')?.dataset.scene3dReady}));
   results.push(rendererRecord);
   await writeFile(path.join(output,`${label}-renderer.json`),JSON.stringify(rendererRecord,null,2));
   await page.screenshot({path:path.join(output,`${label}-scene-evidence.png`)});
   // Inventory's absolute viewport panel is covered separately by inventory.browser.mjs;
   // the equipment viewport panel likewise by equipment-panel.browser.mjs.
   const dialogs=[['difficulty','showDifficultySettings','difficulty-modal'],['cheat','showCheatMode','cheat-modal'],['settings','showGameSettings','game-settings-modal'],['load','showLoadModal','load-modal'],['history','showHistorySummary','history-summary-modal'],['config','showConfigModal','api-config-modal'],['music','showMusicSettings','music-modal'],['font','showFontSettings','font-modal'],['logs','showPipelineLog','pipeline-log-modal'],['last-input','showLastUserInput','last-input-modal']];
   for(const [name,fn,id,arg] of dialogs) {
    const record={label,name,id};
    try {
     await page.evaluate(async ({fn,arg})=>{if(typeof closeAllSpecialModals==='function')closeAllSpecialModals();closeModal();for(const f of ['closeConfigModal','closeLoadModal','closeSaveListModal','closeHistorySummaryModal','closePipelineLogModal','closeGameSettings','closeMusicModal']){if(typeof window[f]==='function')window[f]();}if(document.getElementById('font-modal'))closeFontModal();if(typeof closeLastInputModal==='function')closeLastInputModal();await window[fn](arg);},{fn,arg});
     await new Promise(r=>setTimeout(r,350));
     record.layout=await page.evaluate(id=>{
      const m=document.getElementById(id);if(!m)return {missing:true};
      const panel=m.querySelector('.cfg-panel, .modal-content')||m;
      const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const r=rect(panel);
      const buttons=[...panel.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent.trim().slice(0,30),font:parseFloat(getComputedStyle(e).fontSize),...rect(e)}));
      const footer=panel.querySelector('.game-dialog-footer,.cfg-footer');
       const f=footer?rect(footer):null;
       const inside=x=>!!x&&x.width>0&&x.height>0&&x.left>=r.left-1&&x.top>=r.top-1&&x.right<=r.right+1&&x.bottom<=r.bottom+1&&x.left>=-1&&x.top>=-1&&x.right<=innerWidth+1&&x.bottom<=innerHeight+1;
       const footerButtons=footer?[...footer.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>{const b=rect(e),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return {text:e.textContent.trim(),rect:b,inside:inside(b),hit:hit===e||e.contains(hit),hitElement:hit?.outerHTML.slice(0,180)};}):[];
       const coarse=matchMedia('(pointer: coarse)').matches;
        const touchTargets=m.classList.contains('game-dialog')?[...panel.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent.trim().slice(0,30),minHeight:parseFloat(getComputedStyle(e).minHeight),height:e.getBoundingClientRect().height})):[];
        return {panel:r,footer:f,footerVisible:inside(f)&&footerButtons.length>0&&footerButtons.every(b=>b.inside&&b.hit),footerButtons,display:getComputedStyle(m).display,overflow:panel.scrollWidth>panel.clientWidth+2,buttons,touchTargets,coarse,within:r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};
     },id);
     const touchPass=!record.layout.coarse||record.layout.touchTargets.every(b=>b.minHeight>=44&&b.height>=44);
      record.pass=record.layout.within&&record.layout.footerVisible&&!record.layout.overflow&&record.layout.display!=='none'&&record.layout.buttons.every(b=>b.font<=22)&&touchPass;
     record.scrollCheck=await page.evaluate(id=>{const m=document.getElementById(id),body=m?.querySelector('.game-dialog-body,.cfg-scroll-body'),footer=m?.querySelector('.game-dialog-footer,.cfg-footer');if(!body||!footer)return {pass:false};const before=footer.getBoundingClientRect().bottom;body.scrollTop=body.scrollHeight;const scrolled=body.scrollTop,after=footer.getBoundingClientRect().bottom;body.scrollTop=0;return {pass:Math.abs(after-before)<1,scrolled,scrollRange:body.scrollHeight-body.clientHeight,before,after};},id);
      record.pass=record.pass&&record.scrollCheck.pass;
      await page.screenshot({path:path.join(output,`${label}-${name}.png`)});
      if(['history'].includes(name)) {
       record.longContent=await page.evaluate(({id,name})=>{
        const modal=document.getElementById(id),body=modal.querySelector('.game-dialog-body');body.scrollTop=body.scrollHeight;
        let lastRect,text,count;
        if(name==='history') {
         const content=document.getElementById('history-summary-content'),node=content.firstChild,range=document.createRange();
         const start=node.textContent.lastIndexOf('历史末项标记-DIALOG-END');range.setStart(node,Math.max(0,start));range.setEnd(node,node.textContent.length);lastRect=range.getBoundingClientRect();text=range.toString();count=content.textContent.length;
        } else {const cards=modal.querySelectorAll('.skill-card');const last=cards[cards.length-1];lastRect=last.getBoundingClientRect();text=last.querySelector('.skill-title')?.textContent;count=cards.length;}
        const b=body.getBoundingClientRect();return {count,text,scrollTop:body.scrollTop,scrollRange:body.scrollHeight-body.clientHeight,lastBottom:lastRect.bottom,bodyBottom:b.bottom,pass:body.scrollTop>0&&lastRect.bottom<=b.bottom+1&&lastRect.bottom>=b.top};
       },{id,name});
       record.pass=record.pass&&record.longContent.pass;
       await page.screenshot({path:path.join(output,`${label}-${name}-last.png`)});
       await page.$eval(`#${id} .game-dialog-body`,e=>{e.scrollTop=0;});
      }
      if(['settings'].includes(name)) {
       const before=await page.evaluate(()=>JSON.stringify({actionPoints,currentWeek,playerStats,npcFavorability,inventory,equipment,learnedSkills,equippedSkills}));
       if(name==='inventory') {
        const lastItem=await page.$eval('#inventory-grid .inventory-item:last-child',e=>{e.scrollIntoView({block:'end'});return e.querySelector('.item-name').textContent;});
        const tailVisible=await page.$eval('#inventory-grid .inventory-item:last-child',e=>{const r=e.getBoundingClientRect(),b=e.closest('.game-dialog-body').getBoundingClientRect();return r.top>=b.top-1&&r.bottom<=b.bottom+1;});
        await page.screenshot({path:path.join(output,`${label}-inventory-last.png`)});
        await page.click('#inventory-grid .inventory-item:last-child');
        const detail=await page.$eval('#item-detail-modal',e=>{const r=e.querySelector('.modal-content').getBoundingClientRect(),f=e.querySelector('.game-dialog-footer').getBoundingClientRect();return {name:e.querySelector('#item-name').textContent,visible:getComputedStyle(e).display!=='none',within:r.top>=0&&r.bottom<=innerHeight&&f.bottom<=innerHeight};});
        await page.screenshot({path:path.join(output,`${label}-inventory-detail.png`)});
        await page.click('#item-detail-modal .game-dialog-footer .cancel');
        const detailClosed=await page.$eval('#item-detail-modal',e=>getComputedStyle(e).display==='none');
        await page.click('#inventory-modal .game-dialog-footer button');
        record.interaction={action:'real scroll last item -> detail -> close detail -> close inventory',lastItem,tailVisible,detail,detailClosed,pass:tailVisible&&detail.visible&&detail.within&&detail.name===lastItem&&detailClosed&&await page.$eval('#inventory-modal',e=>getComputedStyle(e).display==='none')};
       } else {
        await page.click('#gs-tabs [data-tab="switches"]');
        record.interaction=await page.evaluate(()=>({action:'real click settings general tab',pass:document.querySelector('#gs-tabs [data-tab="switches"]').classList.contains('active')&&document.getElementById('gs-panel-switches').classList.contains('active')&&getComputedStyle(document.getElementById('gs-panel-switches')).display!=='none'&&document.querySelectorAll('#gs-panel-switches .gs-subhead').length>=3}));
       }
       record.interaction.businessUnchanged=before===await page.evaluate(()=>JSON.stringify({actionPoints,currentWeek,playerStats,npcFavorability,inventory,equipment,learnedSkills,equippedSkills}));
       record.pass=record.pass&&record.interaction.pass&&record.interaction.businessUnchanged;
      }
    }catch(e){record.error=e.stack;record.pass=false;}
    results.push(record);
   }
   // Real settings controls remain interactive; cancel must not persist edits.
   await page.evaluate(()=>{closeAllSpecialModals();closeMusicModal();if(document.getElementById('font-modal'))closeFontModal();showConfigModal();window.__confirms=[];window.confirm=m=>{__confirms.push(m);return true;};});
   await page.type('#api-key-input','temporary-ui-test');
   await new Promise(r=>setTimeout(r,350));
   const cancelHit=await page.$eval('#api-config-modal .cfg-footer button:first-child',e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {button:e.outerHTML,hit:hit?.outerHTML.slice(0,300)};});
   const savedKey=await page.evaluate(()=>apiService.getConfig().apiKey);
   await page.click('#api-config-modal .cfg-footer button:first-child');
   const discard=await page.evaluate(k=>({asked:__confirms.some(m=>/未保存的修改/.test(m)),kept:apiService.getConfig().apiKey===k}),savedKey);
   results.push({label,name:'config-cancel',cancelHit,discard,pass:await page.$('#api-config-modal')===null&&discard.asked&&discard.kept});
   await writeFile(path.join(output,`${label}-errors.json`),JSON.stringify(session.logs.filter(x=>x.type==='pageerror'),null,2));
  } finally {await session.close();}
 }
} finally {await browser.close();await server.close();await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));}
const failed=results.filter(r=>!r.pass);console.log(JSON.stringify({output,total:results.length,failed:failed.map(r=>({label:r.label,name:r.name,error:r.error,layout:r.layout}))},null,2));
if(failed.length)process.exitCode=1;
