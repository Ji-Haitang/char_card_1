import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {startTestServer} from '../scene3d/scripts/test-server.mjs';
import {artifact,workspace,launchBrowser,newGameContext,startGame,json,fixturesRoot} from '../scene3d/scripts/test-support.mjs';
const dir=path.resolve(process.argv[2]);await mkdir(dir,{recursive:true});
const server=await startTestServer({gameRoot:workspace}), browser=await launchBrowser();let session;
const report=[];
try {
 for(const [width,height] of [[1280,720],[844,390],[1024,768]]){
    session=await newGameContext(browser,server,{payload:await json(path.join(fixturesRoot,'saves/map.json')),channel:'story-'+width,viewport:{width,height},scene3dPreferences:{schema:2,enabled:false}});
    const page=session.page;page.setDefaultTimeout(5000);await startGame(session,server);
    await page.evaluate(()=>{
        closeModal();applyLayoutMode(1);GameMode=gameData.GameMode=1;inputEnable=1;newWeek=0;isStoryExpanded=false;currentPage=0;currentRandomEvent=currentBattleEvent=null;
        mapLocation='天山派外堡';companionNPC=['萧白瑚','玄天青'];cgContentEnabled=true;
        // Neutral landscape plate for full-CG visual inspection; renderer still resolves the actual CG slot.
        const resolve=_assetUrl;_assetUrl=p=>resolve(p.includes('/色图/')?'img/location/天山派_春_昼.webp':p);
        updateStoryText(['她回头：“谁？！”门开了。【D；惊讶】|商铺|12:30|萧白瑚:平静;玄天青:平静|none','灯火映着窗纸，她终于笑了。【M；温柔】|客房|20:00|玄天青:微笑|none',`她展开一幅画。【NARRATOR；平静】|客房|20:00|玄天青:平静|${slgCGOptions.find(x=>x!=='none'&&x!=='无')}`].join('\n'));
    });
    await page.evaluate(w=>applyUIStyle(uiStyle=w===844?1:0),width);
    const shot=async key=>{await page.waitForFunction(()=>[...document.querySelectorAll('.stage-story-layers img')].every(i=>i.complete&&i.naturalWidth));await page.screenshot({path:path.join(dir,`${width}-${key}.png`)});};
    await page.waitForSelector('.stage-bubble');
    const line=()=>page.$eval('.stage-line p',e=>e.textContent);assert.equal(await line(),'她回头：“谁？！”');
    const geom=await page.$eval('#main-viewport',e=>e.getBoundingClientRect().toJSON());
    assert.equal(await page.$$eval('#main-viewport > .slg-layer-container',n=>n.length),1);
    await shot('double');await page.evaluate(()=>window.firstStage=document.querySelector('.stage-story-layers'));
    const copy=await page.$eval('.stage-line p',e=>e.getBoundingClientRect().toJSON());
    await page.mouse.click(copy.right-5,copy.y+8);assert.equal(await line(),'门开了。');
    await page.mouse.click(copy.left+5,copy.y+8);assert.equal(await line(),'她回头：“谁？！”');
    await page.click('.stage-line button:last-child');assert.equal(await line(),'门开了。');assert.ok(await page.evaluate(()=>window.firstStage===document.querySelector('.stage-story-layers')));
    await page.click('.stage-line button:last-child');assert.equal(await line(),'灯火映着窗纸，她终于笑了。');await shot('single');
    await page.click('.stage-line button:last-child');await page.waitForSelector('.stage-story-layers .slg-cg-layer img');await shot('cg');await page.mouse.click(copy.right-5,copy.y+8);assert.equal(await page.evaluate(()=>stageStory.reading()),true);assert.ok(await page.$eval('.stage-line button:last-child',e=>e.disabled));
    const cg=await page.$eval('.slg-cg-layer img',e=>({width:e.naturalWidth,height:e.naturalHeight,fit:getComputedStyle(e).objectFit,backdrop:getComputedStyle(e.parentElement).backdropFilter}));
    await page.evaluate(()=>{cgContentEnabled=false;updateStoryDisplay();});assert.equal(await page.$('.stage-story-layers .slg-cg-layer'),null);await page.evaluate(()=>{cgContentEnabled=true;updateStoryDisplay();});await page.waitForSelector('.stage-story-layers .slg-cg-layer');await page.click('.stage-line button:first-child');assert.equal(await page.$('.stage-story-layers .slg-cg-layer'),null);
    await page.evaluate(()=>{storageService.appendUIConversation({id:'stage-prev',role:'assistant',content:'旧日驿站，故人相逢。'});storageService.appendUIConversation({id:'stage-live',role:'assistant',content:currentStoryText});updateSLGReturnButton();});
    await page.click('#stage-full');await page.click('#story-prev-btn');assert.match(await page.$eval('#story-text',e=>e.innerText),/旧日驿站/);assert.ok(await page.$eval('#stage-input',e=>e.disabled));
    await page.click('#story-next-btn');await page.click('#viewport-dock-gear');await page.locator('#viewport-dock-menu .be-seal-system').click();await page.evaluate(()=>Promise.all(document.querySelector('#viewport-dock-menu').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));await shot('menu');await page.click('#system-dropdown button:first-child');await page.waitForSelector('#game-settings-modal',{visible:true});await page.click('#game-settings-modal button.cancel');
    await page.click('#viewport-task-btn');await page.waitForSelector('#task-info-modal',{visible:true});await page.click('#task-info-modal [data-dialog-close]');
    await page.evaluate(()=>toggleViewportDock(false));await page.click('#stage-full');assert.match(await line(),/灯火/);
    await page.click('#stage-view');await page.waitForSelector('.stage-bubble',{hidden:true});await page.click('#stage-backdrop');assert.match(await line(),/灯火/);
    // Exercise the real return-to-sect handler; intercept only its outgoing narrative (no API call).
    await page.evaluate(()=>{window.originalInput=document.getElementById('free-action-input');handleMessageOutput=async msg=>{window.stageReturnMessage=msg;return false;};});
    await page.click('#viewport-dock-gear');await page.waitForFunction(()=>{const e=document.querySelector('#slg-return-btn'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});await page.locator('#slg-return-btn').click();await page.waitForFunction(()=>GameMode===0 && !!window.stageReturnMessage && document.querySelector('#map-scene.active'));
    await page.evaluate(()=>{gameData.GameMode=0;updateStoryText('晨钟响了。她推开门。|伙房|07:00|玄天青:平静|none');});
    await page.click('.stage-line button:last-child');const tools=await page.$eval('#stage-tools',e=>e.getBoundingClientRect().toJSON());
    for(const y of [tools.top-8,tools.top+tools.height/2,tools.bottom+3]){await page.mouse.click(tools.right-90,y);assert.equal(await page.evaluate(()=>stageStory.reading()),true);assert.equal(await line(),'她推开门。');}
    await page.click('.stage-line button:last-child');await page.waitForSelector('#stage-book',{visible:true});await page.click('#stage-book');assert.equal(await line(),'她推开门。');
    await page.mouse.click(geom.x+geom.width/2,geom.y+geom.height/3);await page.click('#stage-book');assert.equal(await line(),'她推开门。');
    await page.click('#stage-full');await page.click('#stage-operation');await page.waitForSelector('#stage-book',{visible:true});await shot('book');
    // Click a point on the kitchen artwork, independently of the SVG's transform.
    await page.mouse.click(geom.x+geom.width*970/1500,geom.y+geom.height/2+geom.width*110/1500);await page.waitForSelector('#location-info-popup.show .location-go-btn',{visible:true});assert.match(await page.$eval('.location-info-name',e=>e.textContent),/伙房/);await page.click('.location-go-btn');await page.waitForSelector('#huofang-scene.active');await shot('location');if(width===844){await page.evaluate(()=>{for(const k of Object.keys(currentNpcLocations))if(currentNpcLocations[k]==='huofang')currentNpcLocations[k]='none';Object.assign(currentNpcLocations,{A:'huofang',B:'huofang',D:'huofang'});displayNpcs('huofang');});await page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('#huofang-npcs .npc-portrait img')];return imgs.length===3 && imgs.every(i=>i.naturalWidth);});await shot('operation-three');}assert.equal(await page.$('#main-viewport > .slg-layer-container'),null);await page.click('#stage-book');await page.waitForSelector('.stage-full');await page.click('#stage-full');assert.equal(await line(),'她推开门。');
    await page.evaluate(()=>updateStoryText(Array.from({length:30},(_,i)=>`山门周报第${i+1}条。`).join('\n')));await page.waitForSelector('.stage-full');assert.equal(await page.$('.stage-story-layers'),null);await shot('no-frame');await page.click('#story-prev-btn');assert.match(await page.$eval('#story-text',e=>e.innerText),/门开了/);await page.click('#story-next-btn');
    await page.$eval('.story-content-wrapper',e=>e.scrollTop=e.scrollHeight);const at=await page.$eval('.story-content-wrapper',e=>e.scrollTop);assert.ok(at>0);await page.click('#stage-operation');await page.click('#stage-book');assert.equal(await page.$eval('.story-content-wrapper',e=>e.scrollTop),at);
    await page.click('#stage-input');await page.keyboard.sendCharacter('去山门看看');await page.setViewport({width,height:220});await page.waitForFunction(()=>visualViewport.height<=220);await shot('input-reduced');for(const sel of ['#free-action-send-btn','#regenerate-btn']) {const hit=await page.$eval(sel,e=>{const r=e.getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {target:e.id,id:el?.closest('button')?.id,cls:el?.className,disabled:e.disabled,box:r.toJSON()};});assert.ok(hit.box.width>0 && hit.box.height>0 && (hit.disabled || hit.id===hit.target),JSON.stringify(hit));}await page.click('#stage-input');await page.setViewport({width,height});await page.click('#stage-input');assert.equal(await page.$eval('#free-action-input',e=>e.value),'去山门看看');assert.ok(await page.evaluate(()=>window.originalInput===document.getElementById('free-action-input')));
    await page.evaluate(()=>applyLayoutMode(0));assert.equal(await page.$('.stage-bubble'),null);assert.ok(await page.$eval('.container > .story-area #free-action-input',e=>e.checkVisibility()));assert.equal(await page.$$eval('#main-viewport > #viewport-dock-layer',n=>n.length),1);
    const errors=session.logs.filter(l=>l.type==='pageerror');assert.deepEqual(errors,[]);report.push({width,height,stage:geom,cg,errors});
    await session.close();session=null;
 }
 await artifact(dir,'report.json',report);console.log(report);
} catch(error){if(session){await session.page.screenshot({path:path.join(dir,'failure.png')});await artifact(dir,'failure.json',{error:String(error),logs:session.logs.slice(-30)});}throw error;}
finally{if(session)await session.close();await browser.close();await server.close();}
