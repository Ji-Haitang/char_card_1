import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const env={crypto:webcrypto,TextEncoder,structuredClone,fetch(){throw Error('network forbidden');},apiService:{createClient(){throw Error('extra LLM forbidden');}}};
vm.createContext(env);vm.runInContext(fs.readFileSync(new URL('../module/speech-plan.js',import.meta.url),'utf8'),env);
const p=env.speechPlan,chars=[{id:'D',name:'萧白瑚'},{id:'M',name:'玄天青'}];
const parse=s=>p.fromMainText(s,chars),plain=x=>JSON.parse(JSON.stringify(x));
test('one NPC yields existing TTS plan fields, exact text and emotion',async()=>{
 const x=await parse('回来了？【D；欣喜】');assert.equal(x.source,'回来了？');assert.equal(x.units[0].speakerId,'D');assert.equal(x.units[0].emotion,'欣喜');assert.equal(x.units[0].text,'回来了？');assert.equal(x.units[0].id,'b0:0-4');assert.equal(x.issues.length,0);assert.equal(p.speakable(x,{D:{speakerId:'test'}}).length,1);
 assert.equal(x.sourceHash,createHash('sha256').update(x.source).digest('hex'));
});
test('five original fields and their spacing are retained',async()=>{
 const s=' 你好。 【M；低声、紧张】  |伙房|18:00|玄天青:平静|none';const x=await parse(s);
 assert.equal(x.source,' 你好。   |伙房|18:00|玄天青:平静|none');assert.equal(x.rawSource,s);assert.equal(x.units[0].start,1);assert.equal(x.units[0].end,4);
 const b=p.documentFor(x.source).blocks[0];assert.equal(b.text.slice(x.units[0].start,x.units[0].end),x.units[0].text);
});
test('old prose and old five-field lines remain silent and unchanged',async()=>{
 const s='普通旁白。\n旧台词。|山门|09:00|萧白瑚:平静|none';const x=await parse(s);assert.equal(x.source,s);assert.equal(x.units.length,0);assert.equal(x.issues.length,0);
});
test('USER, narration, unknown and unbound NPC never gain NPC playback eligibility',async()=>{
 const x=await parse('我回来了。【USER；平静】\n风停了。【NARRATOR；平静】\n谁在那里？【UNKNOWN；紧张】\n好。【M；平静】');
 assert.equal(x.units.length,4);assert.equal(p.speakable(x,{D:{},USER:{}}).length,0);assert.equal(p.requiresDecision(x,{}),true);assert.equal(x.units[1].kind,'narration');
});
test('duplicate words on different lines retain separate source identity',async()=>{
 const x=await parse('好。【D；欣喜】\n\n好。【M；平静】');assert.deepEqual(plain(x.units.map(u=>[u.id,u.sourceLine,u.speakerId])),[['b0:0-2',0,'D'],['b2:0-2',2,'M']]);
});
test('emoji offsets use UTF-16 and match cleaned source exactly',async()=>{
 const x=await parse('🙂好。【D；开心】');assert.equal(x.units[0].end,4);assert.equal(x.source.slice(0,4),x.units[0].text);
});
for(const [name,s] of [
 ['unknown ID','好。【Z；欣喜】'],['empty emotion','好。【D； 】'],['missing closer','好。【D；欣喜'],
 ['two segments on one line','好。【D；欣喜】再见。【M；平静】'],['ASCII delimiter','好。【D;欣喜】'],
 ['no spoken text','【D；平静】'],['unsupported extra column','好。【D；平静】|a|b|c|d|e'],
 ['HTML emotion','好。【D；<b>】'],['overlong emotion','好。【D；'+ '喜'.repeat(25)+'】']]){
 test(name+' retains original text, reports an issue and makes no speech',async()=>{const x=await parse(s);assert.equal(x.source,s);assert.equal(x.units.length,0);assert.ok(x.issues.length);});
}
test('escaped marker is literal and is not spoken or erased',async()=>{
 const s='书中写着\\【D；欣喜】';const x=await parse(s);assert.equal(x.source,s);assert.equal(x.units.length,0);assert.equal(x.issues.length,0);
});
test('CR and br normalization matches existing documentFor but raw source is retained',async()=>{
 const s='一。【D；平静】\r\n<br>二。【M；紧张】';const x=await parse(s);assert.equal(x.rawSource,s);assert.equal(x.source,'一。\n\n二。');assert.equal(x.units[1].sourceLine,2);
});
test('explicit transport truncation rejects even a complete-looking marker',async()=>{
 for(const finishReason of ['length','MAX_TOKENS'])await assert.rejects(p.fromMainText('好。【D；欣喜】',chars,{finishReason}),/截断/);
});
test('an invalid row does not rewrite a valid row or issue model repair',async()=>{
 const x=await parse('好。【D；欣喜】\n错。【Z；平静】');assert.equal(x.source,'好。\n错。【Z；平静】');assert.equal(x.units.length,1);assert.equal(p.requiresDecision(x,{D:{}}),true);
});
