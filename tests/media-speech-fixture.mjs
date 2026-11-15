// Offline platform boundaries only: cloned storage, fetch, Web Locks and Audio metadata events.
// Real media context, parser, plan, config, SDK, transport, service, round and turn modules execute unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { makeSandbox, parserSlice, read } from './gal/_sandbox.mjs';
export const FAKE_KEY='media-public-fixture-not-a-real-key';
export const mp3=fs.readFileSync(new URL('./scene3d/fixtures/audio/silence.mp3',import.meta.url));
export const sourceFiles=['media-context','speech-plan','speech-msgpack','speech-drama3','speech-transport','speech-config','speech-service','speech-round-plan','presentation-adapter','presentation-plan','speech-round','response-parser','speech-turn'];
const sources=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,await read('module/'+name+'.js')])));
export const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
export const flush=()=>new Promise(resolve=>setImmediate(resolve));
export const audioResponse=()=>new Response(mp3,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(mp3.length)}});

export function harness(){
    const settings=new Map(),turns=new Map(),clips=new Map(),holds=new Map(),failures=new Map(),writes=[],requests=[],locks=[],heldLocks=new Set(),history=[],commits=[],statuses=[],decoded=[];
    const route={corsProxyEnabled:true,corsProxyUrl:'https://proxy.example/speech'};
    const state={fetchHandler:()=>audioResponse()};
    function pause(method,key){const entered=deferred(),gate=deferred();holds.set(method+':'+key,{entered,gate});return{entered:entered.promise,release:gate.resolve,reject:gate.reject};}
    async function checkpoint(method,key){const id=method+':'+key,hold=holds.get(id);if(hold){holds.delete(id);hold.entered.resolve();await hold.gate.promise;}if(failures.has(id))throw failures.get(id);}
    const clone=v=>v===undefined?null:structuredClone(v);
    const speechStore={limit:10,
        async getSetting(key){const value=clone(settings.get(key));await checkpoint('getSetting',key);return value;},
        async setSetting(key,value){await checkpoint('setSetting',key);settings.set(key,clone(value));writes.push(['setting',key]);},
        async listTurns(owner){await checkpoint('listTurns',owner);return [...turns.values()].filter(t=>t.workspaceId===owner).sort((a,b)=>b.createdAt-a.createdAt).map(clone);},
        async getTurn(owner,id){const key=JSON.stringify([owner,id]);await checkpoint('getTurn',key);return clone(turns.get(key));},
        async getClip(owner,id,unit){const key=JSON.stringify([owner,id,unit]);await checkpoint('getClip',key);return clone(clips.get(key));},
        async putClip(turn,clip){
            const turnKey=JSON.stringify([turn.workspaceId,turn.turnId]),clipKey=JSON.stringify([turn.workspaceId,turn.turnId,clip.unitId]);await checkpoint('putClip',clipKey);
            assert.equal(turn.workspaceId,'main');assert.ok(clip.blob instanceof Blob);assert.equal(clip.blob.type,'audio/mpeg');assert.ok(clip.blob.size);
            const prior=turns.get(turnKey);if(prior)for(const name of ['sourceHash','planHash','renderVersion','renderHash'])assert.equal(prior[name],turn[name],'storage identity invariant');
            turns.set(turnKey,clone({id:turnKey,workspaceId:turn.workspaceId,turnId:turn.turnId,sourceHash:turn.sourceHash,planHash:turn.planHash,createdAt:turn.createdAt,renderVersion:turn.renderVersion,renderHash:turn.renderHash,
                units:turn.units.map(u=>({id:u.id,text:u.text,speakerId:u.speakerId,sourceLine:u.sourceLine,start:u.start,end:u.end}))}));
            clips.set(clipKey,clone({id:clipKey,turnKey,unitId:clip.unitId,cacheKey:clip.cacheKey,speakerId:clip.speakerId,blob:clip.blob,bytes:clip.blob.size}));writes.push(['clip',clipKey]);return{retained:true,removedTurnIds:[]};
        }
    };
    class MetadataAudio{
        load(){if(this.src){decoded.push(this.src);queueMicrotask(()=>this.onloadedmetadata?.());}}
        removeAttribute(name){if(name==='src')this.src='';}
    }
    const navigator={locks:{async request(name,options,callback){locks.push(name);await checkpoint('lock',name);if(heldLocks.has(name))return callback(null);heldLocks.add(name);try{return await callback({name});}finally{heldLocks.delete(name);}}}};
    const b=makeSandbox({GameMode:0,gameData:{playerName:'公开测试角色',revision:1},currentStoryText:'同一段正文',mapLocation:'天山派',userLocation:'yanwuchang',currentRandomEvent:null,currentBattleEvent:null},{
        Blob,URL,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,Headers,Response,ReadableStream,AbortController,DOMException,crypto:webcrypto,structuredClone,navigator,Audio:MetadataAudio,
        speechStore,storageService:{loadUIConversation:()=>clone(history)},apiService:{getConfig:()=>({...route})},
        fetch:async(url,options)=>{requests.push({url,options,body:typeof options.body==='string'?JSON.parse(options.body):options.body});return state.fetchHandler(url,options);}
    });
    b.run(parserSlice());for(const name of sourceFiles)b.run(sources[name]);
    const names=b.get('npcs');
    function raw(directions=['轻声、稍慢','平静']){return `第一句公开对白。【A；${directions[0]}】|演武场|08:00|${names.A.name}:平静|none\n第二句公开对白。【B；${directions[1]}】|演武场|08:01|${names.B.name}:平静|none`;}
    async function configure(round=false){
        await b.get('speechConfig').save({enabled:true,provider:{kind:'fish-drama3',apiKey:FAKE_KEY,speed:1},voices:{A:{kind:'fish-drama3',speakerId:'public-fixture-a',version:'1'},B:{kind:'fish-drama3',speakerId:'public-fixture-b',version:'1'}}});
        if(round)await b.get('speechRound').savePreferences({enabled:true});writes.length=0;
    }
    async function plan(text=raw()){return b.get('speechPlan').fromMainText(text,b.get('speechRound').characters());}
    const turnFor=(plan,id='test-turn')=>({workspaceId:'main',turnId:id,sourceHash:plan.sourceHash,createdAt:Date.now()});
    function restore(kind){if(kind==='epoch')b.get('mediaContext').invalidate();else if(kind==='reference')b.setGameData(clone(b.get('gameData')));else throw Error('unknown restore fixture');}
    b.setGameData=value=>{b.sandbox.__nextGameData=value;b.run('gameData=__nextGameData');};
    function commit(preprocessed,rawText,isRegenerate,media){commits.push({preprocessed,rawText,isRegenerate,media});if(media)history.push({id:'assistant-'+commits.length,role:'assistant',content:media.mainText,roundSpeech:media.roundSpeech,presentationPlan:media.readingPlan});return true;}
    const envelope=text=>`<MAIN_TEXT>${text}</MAIN_TEXT>\n<SUMMARY>公开夹具总结。</SUMMARY>\n<SIDE_NOTE>{}</SIDE_NOTE>`;
    async function createDraft(text=raw()){
        const round=b.get('speechRound'),ctx=await round.context('main');assert.ok(ctx);ctx.finishReason='stop';
        const clean=await plan(text),reading=b.get('presentationPlan').captureCurrent(clean.source,'committed','');
        const compiled=await b.get('speechRoundPlan').compile(text,round.characters(),{finishReason:'stop',readingPlan:reading});assert.equal(compiled.issues.length,0);
        return round.create({preprocessed:{publicFixture:true},rawText:envelope(text),rawSource:text,mainText:compiled.source,isRegenerate:false,readingPlan:reading,plan:compiled},ctx);
    }
    async function finishTurn(text=raw(),callback=commit){
        const coordinator=b.get('speechTurn'),ctx=await coordinator.begin();coordinator.setCompletion(ctx,{finishReason:'stop'});
        try{return ctx&&ctx.kind==='round'?await b.get('speechRound').withLease('main',()=>coordinator.finish(ctx,{publicFixture:true},envelope(text),false,callback,t=>statuses.push(t))):await coordinator.finish(ctx,{publicFixture:true},envelope(text),false,callback);}
        finally{coordinator.release(ctx);}
    }
    return Object.assign(b,{settings,turns,clips,writes,requests,locks,heldLocks,history,commits,statuses,decoded,route,state,pause,failures,configure,plan,raw,turnFor,restore,commit,envelope,createDraft,finishTurn});
}
