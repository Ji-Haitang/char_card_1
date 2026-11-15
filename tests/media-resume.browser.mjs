// Persistent M3 resume through the original settings UI. Reload never rewrites gameData, fingerprints or IndexedDB.
// Isolated desktop Chromium, public state and deterministic HTTP boundary only; no real credentials or external API.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {launchBrowser,newGameContext,startGame,json,fixturesRoot,workspace,assertSessionSafe,diff} from '../scene3d/scripts/test-support.mjs';
import {startTestServer} from '../scene3d/scripts/test-server.mjs';
const out=path.resolve(process.argv[2]||path.join(workspace,'.scene3d-work','media-resume-'+Date.now()));await mkdir(out,{recursive:true});
const bytes=Array.from(await readFile(new URL('./scene3d/fixtures/audio/silence.mp3',import.meta.url)));
const plain='第一句公开续配对白。|山门|12:30|萧白瑚:平静;玄天青:平静|none\n第二句公开续配对白。|山门|12:30|萧白瑚:平静;玄天青:平静|none';
const marked='第一句公开续配对白。【D；轻声】|山门|12:30|萧白瑚:平静;玄天青:平静|none\n第二句公开续配对白。【M；平静】|山门|12:30|萧白瑚:平静;玄天青:平静|none';
const reply='<MAIN_TEXT>'+marked+'</MAIN_TEXT><SUMMARY>公开续配测试摘要。</SUMMARY><SIDE_NOTE>{"时间":"12:30","用户":{"位置变动":"none"}}</SIDE_NOTE>';
const server=await startTestServer({gameRoot:workspace}),browser=await launchBrowser(),checks=[];let session;

async function installBoundary(p,phase){
    await p.evaluate(({phase,bytes,reply})=>{
        window.__resumeNet={phase,main:0,voice:[],side:0};
        const originalFetch=window.fetch;
        window.fetch=async function(url,options){
            const parsed=new URL(String(url),location.href);if(parsed.origin!=='https://proxy.example')return originalFetch.call(this,url,options);
            const target=parsed.searchParams.get('target'),headers=new Headers(options.headers),body=JSON.parse(options.body);
            if(target==='https://model.example/v1/chat/completions'){
                __resumeNet.main++;
                if(phase!=='before')throw Error('Resume must not request the main model again');
                return new Response(JSON.stringify({choices:[{message:{content:reply},finish_reason:'stop'}],usage:{total_tokens:1}}),{headers:{'Content-Type':'application/json'}});
            }
            if(target==='https://api.fish.audio/v1/tts'){
                __resumeNet.voice.push({text:body.text,voice:body.reference_id,model:headers.get('model'),keyOK:headers.get('Authorization')==='Bearer PUBLIC_RESUME_FISH_KEY'});
                if(phase==='before'&&__resumeNet.voice.length===2)return new Response('{"error":"public second-clip failure"}',{status:500,headers:{'Content-Type':'application/json'}});
                return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'audio/mpeg'}});
            }
            throw Error('Unexpected resume fixture target');
        };
        // Observe the real afterCommit call, without changing its arguments, result or scheduling.
        const originalAfterCommit=sideQuestRunner.afterCommit;
        sideQuestRunner.afterCommit=function(...args){__resumeNet.side++;return originalAfterCommit.apply(this,args);};
    },{phase,bytes,reply});
}
async function probe(p){return p.evaluate(async()=>{
    const draft=await speechRound.load(),turn=draft?await speechStore.getTurn('main','m3:'+draft.id):null,clips=[];
    if(turn)for(const unit of turn.units){const clip=await speechStore.getClip('main',turn.turnId,unit.id);if(clip)clips.push({unitId:clip.unitId,cacheKey:clip.cacheKey,bytes:clip.bytes,speakerId:clip.speakerId});}
    const config=await speechService.getConfig();return{draft,turn,clips,gameData:structuredClone(gameData),history:storageService.loadUIConversation(),source:currentStoryText,
        fingerprint:await mediaContext.publicationFingerprint(),config:{keyOK:config.provider.apiKey==='PUBLIC_RESUME_FISH_KEY',D:config.voices.D?.speakerId,M:config.voices.M?.speakerId,round:(await speechRound.preferences()).enabled},
        net:window.__resumeNet||null,busy:pipeline.isBusy(),status:document.getElementById('sr-status')?.textContent||'',modal:document.getElementById('modal-text')?.textContent||''};
});}
async function clickReady(p,selector){
    for(let attempt=0;attempt<5;attempt++){
        const element=await p.waitForSelector(selector,{visible:true});await element.scrollIntoView();
        const result=await p.waitForFunction(selector=>{
            function ready(b){const r=b?.getBoundingClientRect();return b&&!b.disabled&&!b.closest('[inert]')&&r.width>0&&r.height>0&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}
            if(document.getAnimations().some(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)&&(a.pending||a.playState==='running')))return false;
            if(ready(document.querySelector(selector)))return 'target';
            if(ready(document.querySelector('#modal button[onclick="closeModal()"]')))return 'notice';
            return false;
        },{timeout:15000},selector);
        if(await result.jsonValue()==='target'){await element.click();return;}
        // Dismiss only the real host notice by its original button; no state or fingerprint repair.
        await p.click('#modal button[onclick="closeModal()"]');
    }
    throw Error('Original notices prevented clicking '+selector);
}
async function settings(p){
    await clickReady(p,'#viewport-dock-gear');
    await clickReady(p,'#viewport-dock-menu button[onclick="toggleDropdown(\'system-dropdown\')"]');
    await clickReady(p,'#system-dropdown button[onclick="showGameSettings()"]');
    await clickReady(p,'.gs-tab[data-tab="speech"]');
    await p.waitForSelector('#sr-resume',{visible:true});
}

try{
    for(const mode of ['continue','silent']){
        let baseline,paused,reloaded;
        try{
            const channel='media-resume-'+mode;
            const payload=await json(path.join(fixturesRoot,'saves/map.json'));
            payload.gameData.layoutMode=1; // Initial public save preference matches this landscape viewport; never patched after reload.
            session=await newGameContext(browser,server,{payload,channel,scene3dPreferences:{schema:2,enabled:false},viewport:{width:1280,height:720}});
            const p=session.page;p.setDefaultTimeout(20000);await startGame(session,server);
            // Prepare only explicit user settings. The initial game/save/history remains the public fixture as loaded.
            await p.evaluate(async()=>{
                closeModal();apiService.updateConfig({type:'openai',endpoint:'https://model.example/v1',apiKey:'PUBLIC_RESUME_MODEL_KEY',model:'fixture-model',streamMode:'non-stream',corsProxyEnabled:true,corsProxyUrl:'https://proxy.example/'});
                await speechService.saveConfig({provider:{kind:'fish-drama3',apiKey:'PUBLIC_RESUME_FISH_KEY',speed:1},voices:{D:{kind:'fish-drama3',speakerId:'public-resume-D',version:'1'},M:{kind:'fish-drama3',speakerId:'public-resume-M',version:'1'}}});
                await speechRound.savePreferences({enabled:true});await speechStore.setSetting('single-test:main',{provider:'fish-drama3',enabled:false,targetNpcId:'D'});
            });
            baseline=await probe(p);await installBoundary(p,'before');
            await p.type('#free-action-input','公开暂停后续配行动');await clickReady(p,'#free-action-send-btn');
            await p.waitForSelector('#srd-pause',{visible:true});
            assert.equal(await p.evaluate(()=>__resumeNet.voice.length),2);
            await clickReady(p,'#srd-pause');await p.waitForFunction(()=>!pipeline.isBusy()&&!speechService.isBusy());
            paused=await probe(p);
            assert.equal(paused.draft.phase,'paused');assert.equal(paused.clips.length,1);assert.equal(paused.clips[0].speakerId,'D');assert.equal(paused.clips[0].bytes,bytes.length);assert.equal(paused.net.main,1);assert.equal(paused.net.side,0);
            assert.equal(paused.source,baseline.source);assert.deepEqual(paused.history,baseline.history,'pausing cannot publish user/assistant history');
            assert.equal(paused.fingerprint,paused.draft.baseFingerprint,'the original draft starts from the actual current publication baseline');
            await p.screenshot({path:path.join(out,mode+'-paused.png')});
            // startGame removed the load intent. A genuine reload resumes the persisted app state, not the seed save.
            assert.equal(new URL(p.url()).search,'');
            await p.reload({waitUntil:'load',timeout:45000});
            await p.waitForFunction(()=>__scene3dTest?.initDone||__scene3dTest?.initError,{timeout:30000});
            assert.equal(await p.evaluate(()=>__scene3dTest.initError),null);
            await installBoundary(p,'after'); // No state, storage or fingerprint repair is permitted here.
            reloaded=await probe(p);
            assert.equal(reloaded.draft.id,paused.draft.id);assert.equal(reloaded.draft.phase,'paused');assert.deepEqual(reloaded.clips,paused.clips);assert.deepEqual(reloaded.config,paused.config);
            await settings(p);await clickReady(p,mode==='continue'?'#sr-resume':'#sr-silent');
            await p.waitForFunction(async()=>{const d=await speechRound.load();return !pipeline.isBusy()&&(d?.phase==='published'||!!document.getElementById('sr-status')?.textContent);},{timeout:20000});
            const completed=await probe(p);
            assert.equal(completed.draft.phase,'published',JSON.stringify({status:completed.status,modal:completed.modal,beforeFingerprint:paused.draft.baseFingerprint,reloadedFingerprint:reloaded.fingerprint,gameDataChanges:diff(reloaded.gameData,paused.gameData).map(e=>e.path)}));
            assert.equal(reloaded.fingerprint,paused.draft.baseFingerprint,'reload must not silently change the pending publication baseline');
            assert.equal(completed.net.main,0);assert.equal(completed.net.side,1);assert.equal(completed.history.filter(m=>m.role==='user').length,baseline.history.filter(m=>m.role==='user').length+1);
            const assistant=completed.history.filter(m=>m.role==='assistant');assert.equal(assistant.length,baseline.history.filter(m=>m.role==='assistant').length+1);assert.equal(assistant.at(-1).content,plain);
            assert.equal(assistant.at(-1).roundSpeech.draftId,paused.draft.id);assert.equal(assistant.at(-1).roundSpeech.status,mode==='continue'?'ready':'silent');
            assert.equal(completed.clips.length,mode==='continue'?2:1);assert.equal(completed.net.voice.length,mode==='continue'?1:0);assert.equal(completed.clips.find(c=>c.speakerId==='D').cacheKey,paused.clips[0].cacheKey);
            if(mode==='continue')assert.deepEqual(completed.net.voice,[{text:'[平静] 第二句公开续配对白。',voice:'public-resume-M',model:'drama-3',keyOK:true}]);
            assertSessionSafe(session,server,channel);await p.screenshot({path:path.join(out,mode+'-published.png')});
            checks.push({mode,status:'PASS',mainRequests:paused.net.main+completed.net.main,voiceRequests:paused.net.voice.length+completed.net.voice.length,clips:completed.clips.length,afterCommitCalls:completed.net.side,phase:completed.draft.phase});
        }catch(error){
            const current=session?await probe(session.page).catch(()=>null):null;
            const changes=paused&&reloaded?diff(reloaded.gameData,paused.gameData).map(e=>({path:e.path,actual:typeof e.actual==='string'?e.actual.slice(0,300):e.actual,expected:typeof e.expected==='string'?e.expected.slice(0,300):e.expected})):[];
            checks.push({mode,status:'FAIL',message:error.message,gameDataChanges:changes.map(e=>e.path)});
            await writeFile(path.join(out,mode+'-failure.json'),JSON.stringify({message:error.message,baseline,paused,reloaded,current,gameDataChanges:changes,logs:session?.logs,network:session?.network,violations:session?.violations},null,2));
            if(session)await session.page.screenshot({path:path.join(out,mode+'-failure.png')}).catch(()=>{});
        }finally{if(session){await session.close();session=null;}}
    }
    const status=checks.every(c=>c.status==='PASS')?'PASS':'FAIL';await writeFile(path.join(out,'report.json'),JSON.stringify({status,checks,boundary:'Desktop Chromium + real IDB/service/decoder/controllers and original pause/settings/resume actions; HTTP boundary is simulated. Reload preserves BrowserContext and never rewrites gameData/DB or pending fingerprint. No true cloud/device/push verification.'},null,2));
    console.log(JSON.stringify({out,status,checks}));assert.equal(status,'PASS','See persistent resume report');
}finally{if(session)await session.close();await browser.close();await server.close();}
