// Actual game controllers/DOM/IndexedDB with public fixtures and isolated Chromium; no real model/TTS or device claim.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {launchBrowser,newGameContext,startGame,json,fixturesRoot,workspace,assertSessionSafe,exportJson,importJsonFile} from '../scene3d/scripts/test-support.mjs';
import {startTestServer} from '../scene3d/scripts/test-server.mjs';

const out=path.resolve(process.argv[2]||path.join(workspace,'.scene3d-work','media-lifecycle-'+Date.now()));
await mkdir(out,{recursive:true});
const bytes=Array.from(await readFile(new URL('./scene3d/fixtures/audio/silence.mp3',import.meta.url)));
const server=await startTestServer({gameRoot:workspace}),browser=await launchBrowser(),checks=[];
let session;
async function setup(name,mode=0){
    session=await newGameContext(browser,server,{payload:await json(path.join(fixturesRoot,'saves/map.json')),channel:'media-life-'+name,scene3dPreferences:{schema:2,enabled:false},viewport:{width:1280,height:720}});
    const p=session.page;p.setDefaultTimeout(20000);await startGame(session,server);
    await p.evaluate(async({mode,bytes})=>{
        closeModal();mediaContext.invalidate();GameMode=mode;gameData.GameMode=mode;inputEnable=1;newWeek=0;gameData.newWeek=0;
        currentRandomEvent=currentBattleEvent=currentSpecialEvent=null;randomEvent=battleEvent=0;companionNPC=['D','M'];mapLocation=mode===1?'沙州':'天山派';
        gameData.mapLocation=mapLocation;gameData.companionNPC=companionNPC;actionPoints=3;isStoryExpanded=false;currentPage=0;currentGameTime='09:00';
        gameData.sideQuest={active:null,history:[],lastRefreshWeek:0,pendingTree:null,judgeDisabled:false};gameData.sideQuestConfig={enabled:true,confidenceThreshold:0.7,deadlineWeeks:10};
        applyLayoutMode(1);
        const scene=mode===1?'街道':'山门';
        const source='公开第一段。|'+scene+'|09:00|萧白瑚:平静|none\n公开第二段。|'+scene+'|19:00|玄天青:平静|none\n公开第三段。|'+scene+'|20:00|萧白瑚:平静|none';
        renderMainText(source);const plan=presentationPlan.captureCurrent(source,'committed','');
        storageService.replaceUIConversation([{id:'public-lifecycle-source',role:'assistant',content:source,createdAt:1,presentationPlan:plan}]);gameData.presentationCursor=null;
        syncGameDataFromVariables();document.getElementById('free-action-input').value='公开生命周期草稿';
        apiService.updateConfig({type:'openai',endpoint:'https://model.example/v1',apiKey:'PUBLIC_LIFECYCLE_MODEL_KEY',model:'fixture-model',streamMode:'non-stream',corsProxyEnabled:true,corsProxyUrl:'https://proxy.example/'});
        window.__life={source,requests:[],voiceHold:false,releaseVoice:null,mainReply:'',speechDone:false,speechError:null,readerDone:false};
        const nativeFetch=window.fetch;
        window.fetch=async function(url,options){
            const parsed=new URL(String(url),location.href);if(parsed.origin!=='https://proxy.example')return nativeFetch.call(this,url,options);
            const target=parsed.searchParams.get('target'),body=JSON.parse(options.body);
            if(target==='https://api.fish.audio/v1/tts'){
                __life.requests.push({kind:'voice',text:body.text});if(__life.voiceHold)await new Promise(resolve=>__life.releaseVoice=resolve);
                return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'audio/mpeg'}});
            }
            if(target==='https://model.example/v1/chat/completions'){
                const judge=String(body.messages[0]?.content||'').includes('SIDE_QUEST_CHECK');__life.requests.push({kind:judge?'judge':'main'});
                const content=judge?'<SIDE_QUEST_CHECK>{"result":"continue","confidence":1,"reason":"公开夹具继续"}</SIDE_QUEST_CHECK>':__life.mainReply;
                if(!content)throw Error('Unexpected fixture model request');
                return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage:{total_tokens:1}}),{headers:{'Content-Type':'application/json'}});
            }
            throw Error('Unexpected fixture target');
        };
        await speechService.saveConfig({enabled:false,provider:{kind:'fish-drama3',apiKey:'PUBLIC_LIFECYCLE_FISH_KEY',speed:1},voices:{D:{kind:'fish-drama3',speakerId:'public-lifecycle-D',version:'1'},M:{kind:'fish-drama3',speakerId:'public-lifecycle-M',version:'1'}}});
        await speechRound.savePreferences({enabled:false});
        await speechStore.setSetting('single-test:main',{provider:'fish-drama3',enabled:false,targetNpcId:'D'});
    },{mode,bytes});
    return p;
}
async function runCase(name,mode,operation){
    try{
        const p=await setup(name,mode);const state=await operation(p);
        await p.screenshot({path:path.join(out,name+'.png')});assertSessionSafe(session,server,'media-life-'+name);
        checks.push({name,status:'PASS',state});
    }catch(error){
        const state=session?await session.page.evaluate(()=>({host:typeof presentationHost==='undefined'?null:presentationHost.getDiagnostics(),flow:typeof presentationFlow==='undefined'?null:presentationFlow.getDiagnostics(),mode:typeof GameMode==='undefined'?null:GameMode,text:typeof currentStoryText==='undefined'?null:currentStoryText,
            life:window.__life?{requests:__life.requests,speechDone:__life.speechDone,speechError:__life.speechError,readerDone:__life.readerDone}:null,
            layers:document.querySelectorAll('.slg-layer-container').length,choice:document.getElementById('sidequest-interaction-container')?.outerHTML,
            bridge:window.GameSceneBridge?.getDiagnostics()})).catch(()=>null):null;
        checks.push({name,status:'FAIL',message:error.message,state});
        if(session){await session.page.screenshot({path:path.join(out,name+'-failure.png')}).catch(()=>{});await writeFile(path.join(out,name+'-failure.json'),JSON.stringify({message:error.message,state,logs:session.logs,network:session.network,violations:session.violations},null,2));}
    }finally{if(session){await session.close();session=null;}}
}

try{
    await runCase('same-text-snapshot',0,async p=>{
        await p.evaluate(async()=>{await storageService.saveFullSnapshot();window.__oldMedia=mediaContext.capture();window.__oldState=gameData;window.__originalRow=document.querySelector('.free-action-row');window.__originalParent=__originalRow.parentElement;});
        await p.click('.story-content-wrapper');await p.waitForFunction(()=>presentationHost.getDiagnostics().phase==='open');
        await p.evaluate(async()=>{
            const raw='公开同文恢复语音。【D；平静】';const plan=await speechPlan.fromMainText(raw,speechRound.characters());__life.voiceHold=true;
            __life.speechPromise=speechService.prepare({workspaceId:'main',turnId:'public-snapshot-audio',sourceHash:plan.sourceHash,createdAt:1},plan,{manual:true})
                .then(()=>{__life.speechDone=true;__life.speechError='unexpected-success';},error=>{__life.speechDone=true;__life.speechError=error.name;});
        });
        await p.waitForFunction(()=>typeof __life.releaseVoice==='function');
        assert.equal(await p.evaluate(()=>storageService.restoreFromSnapshot()),true);
        await p.waitForFunction(()=>!presentationHost.isActive()&&__life.speechDone&&!speechService.isBusy());
        await p.evaluate(async()=>{__life.releaseVoice();await __life.speechPromise;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
        const state=await p.evaluate(async()=>({sameText:currentStoryText===__life.source,newReference:gameData!==__oldState,oldContextValid:mediaContext.isCurrent(__oldMedia),host:presentationHost.getDiagnostics().phase,
            speechError:__life.speechError,voiceCalls:__life.requests.filter(r=>r.kind==='voice').length,clips:(await speechStore.listTurns('main')).length,
            sameRow:document.querySelector('.free-action-row')===__originalRow,sameParent:__originalRow.parentElement===__originalParent,draft:document.getElementById('free-action-input').value}));
        assert.deepEqual(state,{sameText:true,newReference:true,oldContextValid:false,host:'closed',speechError:'AbortError',voiceCalls:1,clips:0,sameRow:true,sameParent:true,draft:'公开生命周期草稿'});return state;
    });

    await runCase('async-upstream-choice',1,async p=>{
        await p.click('.story-content-wrapper');await p.waitForFunction(()=>presentationHost.getDiagnostics().phase==='open');
        await p.evaluate(()=>{
            // Public serialized quest state, not a replacement of applyChoice/runner/pipeline.
            gameData.sideQuest.active={questId:'public-choice',title:'公开抉择',background:'公开测试',playerGoal:'问明去向',difficulty:'普通',acceptedWeek:currentWeek,deadlineWeek:currentWeek+10,
                relatedLocations:['沙州'],relatedNpcs:['D'],rootNodeId:'choice',currentNodeId:'choice',nodes:{
                    choice:{type:'stage',title:'公开选择去向',interaction:'choice',options:[{id:'ask',label:'公开选择问路',narrative:'先问清前路。',next:'next'},{id:'wait',label:'公开选择等候',next:'next'}]},
                    next:{type:'stage',title:'公开后续阶段',hiddenGoal:'继续查明',interaction:'free',onSuccess:'end'},end:{type:'ending',title:'公开结束',endingType:'success',epilogue:'公开收束',rewards:{}}},
                pendingInteraction:null,turnsInNode:0,log:[],progressNotes:'',status:'active',started:true,pendingEpilogue:false,lastJudgedUiIndex:-1};
            __life.mainReply='<MAIN_TEXT>公开选择已经推进。|街道|20:00|萧白瑚:平静|none</MAIN_TEXT><SUMMARY>公开抉择测试摘要。</SUMMARY><SIDE_NOTE>{"时间":"20:00","用户":{"位置变动":"none"}}</SIDE_NOTE>';
            setTimeout(()=>{const active=sideQuestService.getActive();active.pendingInteraction={kind:'choice',nodeId:'choice',state:'awaiting'};displaySideQuestChoice(active.nodes.choice);},0);
        });
        await p.waitForFunction(()=>!presentationHost.isActive()&&mediaContext.pendingChoice());
        const button=await p.waitForSelector('#sidequest-choice-options button',{visible:true});assert.equal(await button.evaluate(el=>!!el.closest('[inert]')),false);
        assert.equal(await p.evaluate(()=>presentationReader.resumeFromOperation()),false,'waiting choice cannot be covered by reentry');
        await button.click();
        await p.waitForFunction(()=>!pipeline.isBusy()&&sideQuestService.getActive()?.currentNodeId==='next'&&__life.requests.some(r=>r.kind==='judge'));
        const state=await p.evaluate(()=>{const active=sideQuestService.getActive(),rows=storageService.loadUIConversation();return{node:active.currentNodeId,pending:active.pendingInteraction,choiceLogs:active.log.filter(e=>e.result==='choice').length,turns:active.turnsInNode,
            main:__life.requests.filter(r=>r.kind==='main').length,judge:__life.requests.filter(r=>r.kind==='judge').length,userChoice:rows.filter(m=>m.role==='user').some(m=>m.content.includes('公开选择问路')),last:rows.filter(m=>m.role==='assistant').at(-1)?.content};});
        assert.deepEqual(state,{node:'next',pending:null,choiceLogs:1,turns:1,main:1,judge:1,userChoice:true,last:'公开选择已经推进。|街道|20:00|萧白瑚:平静|none'});return state;
    });

    await runCase('gm1-queue-orientation',1,async p=>{
        await p.evaluate(()=>{
            const sentinel=document.createElement('div');sentinel.id='public-inert-sentinel';sentinel.inert=true;document.getElementById('main-viewport').appendChild(sentinel);
            GameSceneBridge.setBusy('public-independent-lock',true);
            __life.queueDone=false;Promise.all([galPresentation.gotoSlg(1,_slgLayerOptsGm1()),galPresentation.gotoSlg(2,_slgLayerOptsGm1())]).then(()=>__life.queueDone=true);
        });
        await p.waitForFunction(()=>{const sheet=document.querySelector('.scene3d-page-turn');return sheet&&!sheet.hidden&&!__life.queueDone;});
        await p.evaluate(()=>{presentationReader.open().then(ok=>__life.readerDone=ok);});
        await p.waitForFunction(()=>__life.readerDone&&__life.queueDone&&presentationHost.getDiagnostics().phase==='open');
        assert.equal(await p.$$eval('.slg-layer-container',nodes=>nodes.length),0,'drained old queue cannot repaint behind the reader');
        await p.click('#pr-touch-operation');await p.waitForFunction(()=>!presentationHost.isActive()&&!!document.querySelector('.slg-layer-container'));
        const exited=await p.evaluate(()=>({mode:GameMode,layers:document.querySelectorAll('.slg-layer-container').length,masks:document.querySelectorAll('.slg-interaction-mask').length,inert:document.getElementById('public-inert-sentinel').inert,lock:GameSceneBridge.getDiagnostics().snapshot.blockReasons.includes('generation:public-independent-lock')}));
        assert.deepEqual(exited,{mode:1,layers:1,masks:1,inert:true,lock:true});
        assert.deepEqual(await p.evaluate(()=>({index:window.__lastValidSlgIndex,day:decodeURIComponent(document.querySelector('.slg-scene-layer img').src).includes('/昼/')})),{index:0,day:true},'restore uses the original page, not a stale queued night frame');
        await p.click('.story-content-wrapper');await p.waitForFunction(()=>presentationHost.getDiagnostics().phase==='open');
        await p.evaluate(()=>applyLayoutMode(0));await p.waitForFunction(()=>!presentationHost.isActive());
        // The original GM1 image/mask must be restored automatically, not by a test updateStoryDisplay call.
        await p.waitForFunction(()=>!!document.querySelector('.slg-layer-container'),{timeout:5000});
        const portrait=await p.evaluate(()=>({mode:GameMode,portrait:document.body.classList.contains('layout-portrait'),layers:document.querySelectorAll('.slg-layer-container').length,masks:document.querySelectorAll('.slg-interaction-mask').length,inert:document.getElementById('public-inert-sentinel').inert,lock:GameSceneBridge.getDiagnostics().snapshot.blockReasons.includes('generation:public-independent-lock'),lease:presentationAdapter.blocksOriginal()}));
        assert.deepEqual(portrait,{mode:1,portrait:true,layers:1,masks:1,inert:true,lock:true,lease:false});
        await p.evaluate(()=>GameSceneBridge.setBusy('public-independent-lock',false));return{exited,portrait};
    });

    await runCase('metadata-save-roundtrip',0,async p=>{
        const expected=await p.evaluate(async()=>{
            const raw='公开存档对白。【D；轻声】|山门|09:00|萧白瑚:平静|none';const single=await speechPlan.fromMainText(raw,speechRound.characters());const reading=presentationPlan.captureCurrent(single.source,'committed','');
            const plan=await speechRoundPlan.compile(raw,speechRound.characters(),{finishReason:'stop',readingPlan:reading});
            const round=speechRound.record({id:'public-export-draft',input:{rawSource:raw},plan,finishReason:'stop',silent:true,renderVersion:'drama3-v1'});
            const row={id:'public-export-message',role:'assistant',content:single.source,createdAt:1,presentationPlan:reading,singleSpeech:{...single,targetNpcId:'D',finishReason:'stop',renderVersion:'drama3-v1'},roundSpeech:round};
            renderMainText(single.source);storageService.replaceUIConversation([row]);presentationPlan.setCursor({workspaceId:'main',messageId:row.id,sourceHash:reading.sourceHash,planHash:reading.planHash,unitIndex:0});
            await saveGame();closeModal();if(document.getElementById('system-dropdown')?.classList.contains('show'))toggleDropdown('system-dropdown');
            const saved=storageService.loadSave(storageService.listSaves().find(s=>s.id!=='scene3d-fixture').id);
            return{row,cursor:gameData.presentationCursor,savedRow:saved.uiConversation[0],savedCursor:saved.gameData.presentationCursor};
        });
        assert.deepEqual(expected.savedRow,expected.row);assert.deepEqual(expected.savedCursor,expected.cursor);
        const exported=await exportJson(p),serialized=JSON.stringify(exported);assert.ok(!serialized.includes('PUBLIC_LIFECYCLE_FISH_KEY'));assert.ok(!serialized.includes('PUBLIC_LIFECYCLE_MODEL_KEY'));assert.equal(exported.speechConfig,undefined);
        assert.deepEqual(exported.uiConversation[0],expected.row);assert.deepEqual(exported.gameData.presentationCursor,expected.cursor);
        const filename=path.join(out,'public-media-roundtrip.json');await writeFile(filename,JSON.stringify(exported,null,2));
        await p.evaluate(async()=>{storageService.replaceUIConversation([]);gameData.presentationCursor=null;await speechStore.setSetting('config:main',null);});
        await importJsonFile(p,filename);
        const restored=await p.evaluate(async()=>({row:storageService.loadUIConversation()[0],cursor:gameData.presentationCursor,key:(await speechService.getConfig()).provider.apiKey,planStatus:presentationPlan.current().status}));
        assert.deepEqual(restored.row,expected.row);assert.deepEqual(restored.cursor,expected.cursor);assert.equal(restored.key,'');assert.equal(restored.planStatus,'ready');
        return{saved:true,exported:true,imported:true,planStatus:restored.planStatus,roundStatus:restored.row.roundSpeech.status,credentialsExported:false};
    });
    const report={status:checks.every(c=>c.status==='PASS')?'PASS':'FAIL',checks,boundary:'Isolated desktop Chromium; real DOM/controllers/storage/save/import and deterministic HTTP responses. No real account, external API, deployed Worker, APK or physical device.'};
    await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,status:report.status,checks:checks.map(c=>({name:c.name,status:c.status,message:c.message}))}));
    assert.equal(report.status,'PASS','See lifecycle report for each independently executed case');
}finally{if(session)await session.close();await browser.close();await server.close();}
