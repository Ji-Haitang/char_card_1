import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { loadPresentation, plain, read } from './gal/_sandbox.mjs';

const source = Object.fromEntries(await Promise.all(['presentation-adapter','gal-scene-resources','presentation-plan','media-context'].map(async name => [name,await read(`module/${name}.js`)])));
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

test('restoring GM1 re-presents an awaiting choice through its original UI hook without selecting it',()=>{
    const b=setup(1),node={id:'choice-1',options:[]};let rendered=null;
    b.sandbox.sideQuestService={getActive:()=>({pendingInteraction:{kind:'choice',state:'awaiting',nodeId:'choice-1'},nodes:{'choice-1':node}})};
    b.sandbox.displaySideQuestChoice=value=>{rendered=value;};b.get('presentationAdapter').restoreCurrent();assert.equal(rendered,node);assert.equal(b.get('currentPage'),0);
});

test('native GAL curtain releases the sheet after reveal and retains its seal',async()=>{
    const bridge=await read('module/scene3d-bridge.js'),start=bridge.indexOf('    function playCurtain('),end=bridge.indexOf('    function runPageTurn(',start);
    const calls=[],box=vm.createContext({Promise,calls});vm.runInContext(`let viewport={},turn=null,curtainHeld=false;function runPageTurn(...args){calls.push(args);return Promise.resolve();}${bridge.slice(start,end)};globalThis.api={playCurtain,held:()=>curtainHeld};`,box);
    const {api}=box;await api.playCurtain(true,'第一回','','话本');await api.playCurtain(false);assert.equal(calls[0][3],'话本');assert.equal(api.held(),false);
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
