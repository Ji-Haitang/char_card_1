import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,newGameContext,startGame,json,fixturesRoot} from '../../scene3d/scripts/test-support.mjs';
import {startTestServer} from '../../scene3d/scripts/test-server.mjs';
const output=path.resolve(process.argv[2] || '.scene3d-work/relationship-feedback');
await mkdir(output,{recursive:true});
const server=await startTestServer({gameRoot:process.cwd()});
const browser=await launchBrowser();
const results=[];
try {
 for(const [width,height,style] of [[390,844,0],[390,844,1],[844,390,0],[844,390,1],[1440,900,0],[1440,900,1]]) {
  const label=`${width}x${height}-${style?'flat':'ancient'}`;
  const payload=await json(path.join(fixturesRoot,'saves/map.json'));
  const session=await newGameContext(browser,server,{payload,channel:label,style,viewport:{width,height,deviceScaleFactor:1,hasTouch:true,isMobile:true},scene3dPreferences:{schema:2,enabled:false,quality:'low'}});
  const {page}=session;
  try {
   await startGame(session,server);
   await page.evaluate(landscape=>{
    closeModal();
    if(landscape){const t=document.getElementById('gs-layout-toggle');t.checked=true;gsOnLayoutMode(t);}
    const ids=Object.keys(npcs);npcFavorability[ids[0]]=-100;npcFavorability[ids[1]]=100;
    npcs[ids[0]].description='长介绍验证：山间风雪，同门相伴。'.repeat(100)+'介绍末尾';
    showRelationships();
   },width>height);
   await page.waitForSelector('#relationships-scene',{visible:true});
   await page.waitForFunction(()=>[...document.querySelectorAll('.folio-npc img')].every(i=>i.complete&&i.naturalWidth));
   const columns=await page.$eval('#relationship-grid',e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
   assert.equal(columns,width>height?2:1);
   await page.screenshot({path:path.join(output,label+'-cards.png')});
   const texts=await page.$$eval('.folio-npc small',es=>es.slice(0,2).map(e=>e.textContent));
   assert.deepEqual(texts,['好感度：-100','好感度：100']);
   const check='.folio-card:first-child input';const before=await page.$eval(check,e=>e.checked);await page.tap(check);
   assert.equal(await page.evaluate(()=>npcVisibility[Object.keys(npcs)[0]]),!before);
   assert.ok(await page.$eval('#folio-bio',e=>e.hidden));
   await page.tap('.folio-npc');
   const bounds=await page.$eval('#folio-bio',e=>{const a=e.getBoundingClientRect(),b=document.querySelector('#main-viewport').getBoundingClientRect();return a.left>=b.left&&a.top>=b.top&&a.right<=b.right&&a.bottom<=b.bottom;});assert.ok(bounds);
   const scroll=await page.$eval('#folio-bio .dialog-detail-body',e=>{e.scrollTop=e.scrollHeight;return e.scrollTop;});assert.ok(scroll>0);
   await page.tap('#folio-list-back');
   await page.$eval('#relationship-grid',e=>e.scrollTop=e.scrollHeight);const offset=await page.$eval('#relationship-grid',e=>e.scrollTop);
   await page.tap('.folio-card:last-child button');await page.tap('#folio-list-back');assert.equal(await page.$eval('#relationship-grid',e=>e.scrollTop),offset);
   await page.tap('#relationships-scene [data-dialog-close]');
   await page.evaluate(()=>{playerStats.武学=100;showPlayerStats();});
   await page.screenshot({path:path.join(output,label+'-attributes.png')});
   await page.tap('[data-page="combat"]');const points=await page.$eval('#remaining-points-value',e=>Number(e.textContent));assert.ok(points>0);
   await page.tap('#add-attack-btn');await page.tap('#modal-buttons button:first-child');await page.waitForFunction(()=>document.querySelector('#modal-text').textContent.includes('攻击力提升至'));await page.tap('#modal-buttons button:first-child');assert.equal(await page.$eval('#remaining-points-value',e=>Number(e.textContent)),points-1);
   await page.tap('#folio-combat .folio-foot button');await page.tap('#modal-buttons .cancel');assert.equal(await page.$eval('#remaining-points-value',e=>Number(e.textContent)),points-1);
   await page.tap('#folio-combat .folio-foot button');await page.tap('#modal-buttons button:first-child');assert.equal(await page.$eval('#remaining-points-value',e=>Number(e.textContent)),points);
   results.push({label,pass:true,columns,scroll,offset,points});
  } catch(e) {results.push({label,pass:false,error:e.stack});await page.screenshot({path:path.join(output,`${label}-failure.png`)});}
  finally {await session.close();}
 }
} finally {await browser.close();await server.close();await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify(results,null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
