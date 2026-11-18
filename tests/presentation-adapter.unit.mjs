import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { loadPresentation, plain, read } from './gal/_sandbox.mjs';

const source = Object.fromEntries(await Promise.all(['presentation-adapter','gal-scene-resources','presentation-plan','presentation-view','presentation-actions','presentation-host','presentation-flow','media-context'].map(async name => [name,await read(`module/${name}.js`)])));
function setup(mode=0) {
    let busy=false,choice=false;const saved=[];
    const box=loadPresentation({GameMode:mode,gameData:{},mapLocation:'天山派外堡',currentStoryText:'正文',userLocation:'yanwuchang',currentRandomEvent:null,currentBattleEvent:null,currentSpecialEvent:null,inputEnable:1,npcTurnEmotions:{},storyHistoryOffset:0},{
        structuredClone,TextEncoder,AbortController,window:undefined,
        pipeline:{isBusy:()=>busy,isStreaming:()=>false},
        sideQuestService:{getActive:()=>choice?{pendingInteraction:{kind:'choice',state:'awaiting'}}:null},
        storageService:{loadUIConversation:()=>saved,saveAppState(){}},
        updateStoryDisplay(){},
    });
    box.run(source['media-context']);box.run(source['presentation-adapter']);box.run(source['gal-scene-resources']);box.run(source['presentation-plan']);
    return Object.assign(box,{saved,setBusy:v=>{busy=v;},setChoice:v=>{choice=v;},names:box.get('npcs')});
}
function line(box,text='正文',time='08:00',ids=['A','B']){return `${text}|演武场|${time}|${ids.map(id=>box.names[id].name+':平静').join(';')}|none`;}

test('only the upstream parser/controller exist; projection adds IDs without mutating parser output',()=>{
    const b=setup();const parse=b.get('GalParser').parseFrames,ctx=b.get('buildGalParseContext')(0),text=line(b);
    const before=plain(parse(text,ctx));const frames=plain(b.get('presentationFrames').parseFrames(text,ctx));
    assert.equal(b.get('GalParser').assignStableSlots,undefined);assert.equal(Object.isFrozen(b.get('GalParser')),true);
    assert.deepEqual(plain(parse(text,ctx)),before);assert.equal(before[0].cast[0].id,undefined);
    assert.deepEqual(frames[0].cast.map(a=>[a.id,a.kind,a.anchor]),[['A','npc',30],['B','npc',70]]);
    assert.equal(frames[0].sourceLine,null);assert.equal(frames[0].cgOwnerId,'A');
});

test('projection retains two-NPC and GM1 companion admission instead of importing a local roster',()=>{
    const b=setup(1);b.set('companionNPC',[b.names.A.name]);
    const frames=plain(b.get('presentationFrames').parseFrames(line(b,'正文','08:00',['A','B','C']),b.get('buildGalParseContext')(1)));
    assert.deepEqual(frames[0].cast.map(a=>a.id),['A']);
    b.set('GameMode',0);assert.equal(b.get('presentationFrames').parseFrames(line(b,'正文','08:00',['A','B','C']),b.get('buildGalParseContext')(0))[0].cast.length,2);
});

test('stable seats are deterministic over AB/BA and cast-size changes',()=>{
    const b=setup();const parsed=b.get('presentationFrames').parseFrames([line(b),line(b,'第二段','08:01',['B','A']),line(b,'第三段','08:02',['B']),line(b,'第四段','08:03',['A','B'])].join('\n'),b.get('buildGalParseContext')(0));
    assert.deepEqual(plain(parsed.map(f=>f.cast.map(a=>[a.id,a.anchor]))),[[['A',30],['B',70]],[['B',70],['A',30]],[['B',50]],[['A',70],['B',30]]]);
});

test('SHA256, strict frame/text/hash validation and cursor survive only the captured context',()=>{
    const b=setup(),text=line(b,'第一句。'.repeat(60));b.set('currentStoryText',text);const p=b.get('presentationPlan');
    assert.equal(p.hash('姬侠传🙂'),createHash('sha256').update('姬侠传🙂').digest('hex'));
    const plan=p.captureCurrent(text);assert.deepEqual(plain(p.validate(text,plan)),plain(plan));assert.ok(plan.units.length>1);
    const tampered=structuredClone(plan);tampered.units[0].end++;assert.throws(()=>p.validate(text,tampered),/units/);
    const bad=structuredClone(plan);bad.frames[0].cast[0].kind='player';assert.throws(()=>p.validate(text,bad),/actor/);
    b.saved.push({id:'assistant-1',role:'assistant',content:text,presentationPlan:plan});const context=b.get('mediaContext').capture();
    const request={context,workspaceId:'main',messageId:'assistant-1',sourceHash:plan.sourceHash,planHash:plan.planHash,unitIndex:1};
    p.setCursor(request);assert.equal(p.current().unitIndex,1);b.get('mediaContext').invalidate();assert.throws(()=>p.setCursor(request),/上下文/);
});

test('temporary pipe protection preserves unknown prose and closing quotes stay with their sentence',()=>{
    const b=setup(),p=b.get('presentationPlan'),literal='这里|只是|普通|字面';
    const plan=p.create(literal,{mode:0});assert.equal(plan.frames.map(f=>f.text).join('\n\n'),literal);p.validate(literal,plan);
    const text=line(b,'甲'.repeat(119)+'。”'+'乙'.repeat(20));const quoted=p.create(text,{mode:0});
    assert.ok(quoted.frames[0].text.slice(quoted.units[0].start,quoted.units[0].end).endsWith('。”'));
});

test('current page and event page map only when complete source coverage matches',()=>{
    const b=setup(),p=b.get('presentationPlan'),text=line(b,'第一段')+'\n'+line(b,'第二段');
    const plan=p.create(text,{mode:0,eventText:'事件描述'}),pages=[{text:'第一段'},{text:'第二段'},{text:'事件描述',event:true}];
    assert.equal(p.unitForPage(plan,pages,1),1);assert.equal(p.unitForPage(plan,pages,2),2);assert.equal(p.unitForPage(plan,[{text:'偷换正文'}],0),-1);
});

test('resources inherit closest prior valid clock for clones without changing captured times',()=>{
    const b=setup(),r=b.get('galSceneResources');const frames=[{scene:'演武场',time:'18:00'},{scene:'演武场',time:null}];
    const context={mode:0,seasonStatus:'spring',dayNightStatus:'daytime',locationNames:{yanwuchang:'演武场'},frames,frameIndex:1};
    const result=r.sceneFor(structuredClone(frames[1]),context);assert.match(result.background,/_夜\.webp$/);assert.equal(frames[1].time,null);
    assert.match(r.sceneFor({scene:'none',time:null},{...context,frameIndex:0,frames:[]}).background,/天山派_春_昼\.webp$/);
    assert.match(r.sceneFor(frames[0],{...context,skin:'pixel'}).background,/3D\.ver\/演武场-春-夜\.webp$/);
});

test('resources use the original special-emotion portrait and first-NPC CG paths',()=>{
    const b=setup(),r=b.get('galSceneResources'),a={id:'A',npc:b.names.A.name,emotion:'特殊CG1'};
    assert.match(r.portraitCandidates(a,{basePortrait:'base.webp'})[0],/表情差分\/特殊CG1\.webp$/);
    assert.equal(r.cgFor({cg:'none'},[a],{cgEnabled:true}),null);
    assert.match(r.cgFor({cg:'测试',cgOwnerId:'A'},[a],{cgEnabled:true,cgVariant:2}).url,/测试2\.webp$/);
});

test('GM1 suspend invalidates/drains queued pages; unlease resumes once via the original display',async()=>{
    const b=setup(1);b.set('companionNPC',[b.names.A.name]);b.setFrames(line(b)+'\n'+line(b,'第二段','19:00',['A']));
    const p=b.pres();p.gotoSlg(0,{mode:1});let releaseCover;const firstCover=new Promise(resolve=>{releaseCover=resolve;});
    b.sandbox.GameSceneBridge.playCurtain=(cover)=>cover?firstCover:Promise.resolve();
    const page=p.gotoSlg(1,{mode:1});await Promise.resolve();let redraw=0;b.sandbox.updateStoryDisplay=()=>{redraw++;p.gotoSlg(0,{mode:1});};
    const a=b.get('presentationAdapter'),pending=a.suspend();assert.equal(a.blocksOriginal(),true);assert.equal(p.gotoSlg(0,{mode:1}),false);
    releaseCover();const op=await pending;await page;assert.equal(b.layers().length,0);assert.equal(a.resume(op),true);assert.equal(redraw,1);assert.equal(b.layers().length,1);
});

test('GM0 suspension returns to operation; GM1 stale epoch, mode and same-text gameData replacement never redraw',async()=>{
    const home=setup();home.setFrames(line(home));await home.pres().enter({curtain:false});const a=home.get('presentationAdapter');const op=await a.suspend();let renders=0;home.sandbox.updateStoryDisplay=()=>renders++;a.resume(op);assert.equal(home.pres().isPlaying(),false);assert.equal(renders,0);
    for(const change of ['epoch','mode','state']){const b=setup(1),adapter=b.get('presentationAdapter');let redraw=0;b.sandbox.updateStoryDisplay=()=>redraw++;const token=await adapter.suspend();if(change==='epoch')b.get('mediaContext').invalidate();else if(change==='mode')b.set('GameMode',0);else b.set('gameData',{});assert.equal(adapter.resume(token),false);assert.equal(redraw,0);assert.equal(adapter.blocksOriginal(),false);}
});

test('restoring GM1 re-presents an awaiting choice through its original UI hook without selecting it',()=>{
    const b=setup(1),node={id:'choice-1',options:[]};let rendered=null;
    b.sandbox.sideQuestService={getActive:()=>({pendingInteraction:{kind:'choice',state:'awaiting',nodeId:'choice-1'},nodes:{'choice-1':node}})};
    b.sandbox.displaySideQuestChoice=value=>{rendered=value;};b.get('presentationAdapter').restoreCurrent();assert.equal(rendered,node);assert.equal(b.get('currentPage'),0);
});

test('broader busy prevents restore and action dispatch even when isStreaming is false',async()=>{
    const b=setup(1),a=b.get('presentationAdapter'),token=await a.suspend();b.setBusy(true);assert.equal(a.resume(token),false);
    b.run(source['presentation-actions']);const actions=b.get('presentationActions');const state=actions.getState();assert.equal(state.busy,true);assert.equal(actions.preflight('return',{},state).ok,false);
});

test('actions reject old captured state and pending upstream choices before calling business',()=>{
    const b=setup();b.run(source['presentation-actions']);const a=b.get('presentationActions'),state=a.getState();b.get('mediaContext').invalidate();assert.match(a.preflight('move',{locationId:'huofang'},state).reason,/上下文/);
    const current=a.getState();b.setChoice(true);assert.match(a.preflight('move',{locationId:'huofang'},current).reason,/支线/);
});

test('bridge preserves four-argument seal while fifth-argument lease owns reveal/cancel',async()=>{
    const bridge=await read('module/scene3d-bridge.js'),start=bridge.indexOf('    function playCurtain('),end=bridge.indexOf('    function runPageTurn(',start);
    const calls=[],box=vm.createContext({Promise,calls});vm.runInContext(`let viewport={},turn=null,curtainHeld=false,curtainOwner=null,page={hidden:false};function runPageTurn(...args){calls.push(args);return Promise.resolve();}function cancelPageAnimation(){calls.push('cancel');}${bridge.slice(start,end)};globalThis.api={playCurtain,cancelCurtain,held:()=>curtainHeld};`,box);
    const {api}=box;await api.playCurtain(true,'第一回','','话本');await api.playCurtain(false);assert.equal(calls[0][3],'话本');assert.equal(api.held(),false);
    const lease={};await api.playCurtain(true,'入卷','','话本',lease);const count=calls.length;await api.playCurtain(false);assert.equal(calls.length,count);assert.equal(api.held(),true);api.cancelCurtain({});assert.equal(api.held(),true);api.cancelCurtain(lease);assert.equal(api.held(),false);
});

function hostBox(){
    const b=setup(1),dom=b.dom,observers=[];
    dom.Element.prototype.contains=function(n){for(;n;n=n.parentNode)if(n===this)return true;return false;};
    dom.Element.prototype.focus=function(){dom.document.activeElement=this;};
    Object.defineProperty(dom.Element.prototype,'isConnected',{configurable:true,get(){return dom.body.contains(this);}});
    dom.Element.prototype.getClientRects=function(){return [{}];};
    const story=new dom.Element('div');story.className='story-area';dom.body.appendChild(story);dom.document.activeElement=story;dom.body.classList.add('layout-landscape');
    b.sandbox.MutationObserver=class{constructor(fn){this.fn=fn;this.live=true;observers.push(this);}observe(){}disconnect(){this.live=false;}};
    b.sandbox.getComputedStyle=()=>({visibility:'visible'});b.sandbox.addEventListener=()=>{};
    b.run(source['presentation-view']);b.run(source['presentation-host']);
    const snapshot=b.get('presentationView').captureReading({mode:1,workspaceId:'main',sourceText:'正文',frames:[{text:'正文',cast:[]}],dayNightStatus:'daytime'});
    return Object.assign(b,{snapshot,observers,story,flush(){for(const o of observers)if(o.live)o.fn([]);}});
}

test('host restores original DOM/locks on exit and closes for an asynchronously appearing choice',async()=>{
    const b=hostBox(),host=b.get('presentationHost');let disposed=0,redraw=0;b.sandbox.updateStoryDisplay=()=>redraw++;
    assert.equal(await host.enter({snapshot:b.snapshot,mount(){return()=>disposed++;}}),true);assert.equal(b.story.inert,true);b.setChoice(true);b.flush();assert.equal(host.isActive(),false);assert.equal(disposed,1);assert.equal(b.story.inert,undefined);assert.equal(b.get('presentationAdapter').blocksOriginal(),false);assert.equal(redraw,1);
    b.setChoice(false);await host.enter({snapshot:b.snapshot,mount(){return()=>disposed++;}});await host.exit();assert.equal(disposed,2);assert.equal(redraw,2);assert.equal(host.isActive(),false);assert.deepEqual(b.bridgeCalls.busy.at(-1),['presentation-host',false]);
});

test('host invalidation during opening cannot strand an adapter lease or mount stale content',async()=>{
    const b=hostBox(),host=b.get('presentationHost');let mounted=0;const pending=host.enter({snapshot:b.snapshot,mount(){mounted++;}});host.invalidate();await pending;assert.equal(mounted,0);assert.equal(host.isActive(),false);assert.equal(b.get('presentationAdapter').blocksOriginal(),false);
});

function flowBox(){
    const b=hostBox(),dom=b.dom,timers=[],rafs=[];let opens=0;
    dom.Element.prototype.before=function(n){this.parentNode.insertBefore(n,this);};
    dom.document.createComment=()=>new dom.Element('comment');
    const mask=new dom.Element('div');mask.id='stream-mask';dom.viewport.appendChild(mask);
    const controls=new dom.Element('div');controls.id='stream-controls';b.story.appendChild(controls);
    b.sandbox.performance={now:()=>0};b.sandbox.requestAnimationFrame=fn=>{rafs.push(fn);return rafs.length;};b.sandbox.cancelAnimationFrame=()=>{};
    b.sandbox.setTimeout=fn=>{timers.push(fn);return timers.length;};b.sandbox.clearTimeout=()=>{};
    b.sandbox.presentationOverlays={attach:()=>({hasOpen:()=>false,handleKey:()=>false})};
    b.sandbox.presentationReader={open:async()=>{opens++;return true;}};
    b.run(source['presentation-actions']);b.run(source['presentation-flow']);
    const plan=b.get('presentationPlan').captureCurrent('正文');b.saved.push({id:'reply-1',role:'assistant',content:'正文',presentationPlan:plan});
    return Object.assign(b,{flow:b.get('presentationFlow'),receipt:{workspaceId:'main',messageId:'reply-1',sourceHash:plan.sourceHash},mask,controls,opens:()=>opens,flushTimers(){while(timers.length)timers.shift()();},flushFrame(){rafs.shift()?.();}});
}

test('flow waits for final publication receipt and broader busy before opening, then restores leased controls',async()=>{
    const b=flowBox(),ticket=b.flow.pipelineStart();assert.equal(b.opens(),0);assert.equal(b.controls.parentNode,b.mask);
    b.setBusy(true);b.flow.pipelineEnd(ticket,b.receipt);b.flushTimers();assert.equal(b.opens(),0);
    b.setBusy(false);b.flushFrame();await Promise.resolve();assert.equal(b.opens(),1);assert.equal(b.controls.parentNode,b.story);assert.equal(b.flow.isWaiting(),false);
});

test('flow never auto-opens failed publication, changed context, or asynchronously presented choice',()=>{
    for(const reason of ['failure','context','choice']){const b=flowBox(),ticket=b.flow.pipelineStart();
        if(reason==='context')b.get('mediaContext').invalidate();if(reason==='choice')b.setChoice(true);
        b.flow.pipelineEnd(ticket,reason==='failure'?null:b.receipt);b.flushTimers();assert.equal(b.opens(),0);assert.equal(b.flow.isWaiting(),false);assert.equal(b.controls.parentNode,b.story);
    }
});

test('shared renderer paints a frozen reading frame: snapshot world, anchor seats, no scene tag, missing-asset memory',()=>{
    const b=setup(),pres=b.get('galPresentation'),plan=b.get('presentationPlan').create(line(b,'正文','20:00')+'\n'+line(b,'第二段','21:00',['B']),{mode:0});
    b.set('seasonStatus','summer');b.set('dayNightStatus','daytime');b.set('randIdx',3); // live globals differ from the frozen world on purpose
    const stage=b.dom.document.createElement('div');stage.id='pr-stage';b.dom.viewport.appendChild(stage);
    const frozen={...plan.world,skin:'normal',cgEnabled:true,frames:plan.frames,frameIndex:0},missing=new Set();
    const first=pres.renderLayers(stage,plan.frames[0],{mode:0,context:frozen,missing,sceneTag:false,portraitFallback:true});
    assert.equal(first.querySelector('.slg-scene-layer img').src,'img/location/演武场_夜.webp','frozen clock wins over live dayNightStatus');
    assert.equal(first.querySelector('.slg-scene-tag'),null,'reader draws its own chapter header');
    assert.deepEqual(first.querySelectorAll('.slg-emotion-layer').map(l=>[l.style.left,l.classes.has('slg-cast-left'),l.classes.has('slg-cast-right')]),[['30%',true,false],['70%',false,true]]);
    // Second frame: frozen 21:00 clock (not the live daytime) and the single seat stays centred.
    const second=pres.renderLayers(stage,plan.frames[1],{mode:0,context:{...frozen,frameIndex:1},missing,sceneTag:false});
    assert.equal(second.querySelector('.slg-scene-layer img').src,'img/location/演武场_夜.webp');assert.equal(second.querySelector('.slg-emotion-layer').style.left,'50%');
    // A 404 is remembered: the candidate chain advances and the next paint skips the dead URL instead of re-requesting it.
    const img=second.querySelector('.slg-emotion-layer img'),dead=img.src;img.dispatch('error');assert.equal(missing.has(dead),true);
    const third=pres.renderLayers(stage,plan.frames[1],{mode:0,context:{...frozen,frameIndex:1},missing,sceneTag:false});assert.equal(third.querySelector('.slg-emotion-layer'),null,'no base portrait configured → seat omitted, no broken image');
    // Viewport-level clearing never reaches the reader's nested stage, and clearing the stage never touches viewport layers.
    pres.renderLayers(b.dom.viewport,plan.frames[0],{mode:0});
    pres.clearLayers(b.dom.viewport);assert.equal(stage.querySelectorAll('.slg-layer-container').length,3);assert.equal(b.dom.viewport.children.filter(c=>c.classes.has('slg-layer-container')).length,0);
    pres.clearLayers(stage);assert.equal(stage.children.length,0);
    // Live path is unchanged: no inline seats, scene tag present, live season/clock used.
    const live=pres.renderLayers(b.dom.viewport,{scene:'none',time:null,cast:[{npc:b.names.A.name,emotion:'平静'},{npc:b.names.B.name,emotion:'平静'}]},{mode:0});
    assert.equal(live.querySelector('.slg-scene-layer img').src,'img/location/天山派_夏_昼.webp');assert.ok(live.querySelector('.slg-scene-tag'));assert.deepEqual(live.querySelectorAll('.slg-emotion-layer').map(l=>l.style.left),[undefined,undefined]);
});
