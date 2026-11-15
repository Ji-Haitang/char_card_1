// Real cross-module media contracts. No legacy provider, independent LLM, real account or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, deferred, flush, audioResponse, FAKE_KEY, mp3 } from './media-speech-fixture.mjs';

test('real media/config/service/round share only main and reject foreign dispatch',async()=>{
    const h=harness();await h.configure(true);assert.equal(h.get('mediaContext').workspaceId(),'main');assert.equal(h.get('speechService').workspaceId(),'main');
    assert.deepEqual([...h.settings.keys()].sort(),['config:main','round-speech:main']);
    const plan=await h.plan();await assert.rejects(h.get('speechService').prepare({...h.turnFor(plan),workspaceId:'foreign'},plan),/不属于/);
    await assert.rejects(h.get('speechRound').withLease('foreign',()=>assert.fail('foreign lease')),e=>e.name==='AbortError');assert.equal(h.requests.length,0);
});

test('two real NPC units prepare once, then reuse the exact cached blobs without extra POSTs',async()=>{
    const h=harness();await h.configure(true);const round=h.get('speechRound');
    await round.withLease('main',async()=>{
        const draft=await h.createDraft();const first=await round.prepare(draft);assert.equal(first.phase,'ready');assert.equal(h.requests.length,2);assert.equal(h.clips.size,2);
        const fingerprints=[...h.clips.values()].map(c=>c.cacheKey);const second=await round.prepare(first);assert.equal(second.phase,'ready');assert.equal(h.requests.length,2);assert.deepEqual([...h.clips.values()].map(c=>c.cacheKey),fingerprints);
        assert.equal(h.turns.size,1);for(const t of h.turns.values()){assert.equal(t.workspaceId,'main');assert.equal(t.units.length,2);assert.equal(t.renderVersion,'drama3-v1');assert.match(t.renderHash,/^[a-f0-9]{64}$/);}
        for(const c of h.clips.values())assert.deepEqual(Buffer.from(await c.blob.arrayBuffer()),mp3);
    });
    assert.equal(h.decoded.length,2,'service metadata validation only for fresh audio');
    assert.deepEqual(h.requests.map(r=>r.body.text),['[轻声、稍慢] 第一句公开对白。','[平静] 第二句公开对白。']);
    for(const r of h.requests){assert.equal(new URL(r.url).hostname,'proxy.example');assert.equal(r.options.headers.get('model'),'drama-3');assert.equal(r.options.credentials,'omit');}
});

for(const kind of ['epoch','reference'])test('same-text '+kind+' restore during config read prevents dispatch',async()=>{
    const h=harness();await h.configure();const plan=await h.plan(),gate=h.pause('getSetting','config:main');
    const pending=h.get('speechService').prepare(h.turnFor(plan),plan),rejected=assert.rejects(pending,e=>e.name==='AbortError');
    await gate.entered;const before=h.get('currentStoryText');h.restore(kind);assert.equal(h.get('currentStoryText'),before);gate.release();await rejected;assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.equal(h.get('speechService').isBusy(),false);
});

for(const kind of ['epoch','reference'])test('same-text '+kind+' restore after cache lookup starts still dispatches zero requests',async()=>{
    const h=harness();await h.configure();const plan=await h.plan(),turn=h.turnFor(plan),clipId=plan.units[0].id+'/0',gate=h.pause('getClip',JSON.stringify(['main',turn.turnId,clipId]));
    const pending=h.get('speechService').prepare(turn,plan),rejected=assert.rejects(pending,e=>e.name==='AbortError');
    await gate.entered;h.restore(kind);gate.release();await rejected;assert.equal(h.requests.length,0);assert.equal(h.clips.size,0);assert.equal(h.get('speechService').isBusy(),false);
});

for(const kind of ['epoch','reference'])test('same-text '+kind+' restore discards late audio before decoding or cache write',async()=>{
    const h=harness();await h.configure();const plan=await h.plan(),started=deferred(),late=deferred();h.state.fetchHandler=()=>{started.resolve();return late.promise;};
    const pending=h.get('speechService').prepare(h.turnFor(plan),plan),rejected=assert.rejects(pending,e=>e.name==='AbortError');await started.promise;h.restore(kind);late.resolve(audioResponse());await rejected;await flush();
    assert.equal(h.requests.length,1,'the second unit is never dispatched');assert.equal(h.decoded.length,0);assert.equal(h.clips.size,0);assert.equal(h.turns.size,0);assert.equal(h.writes.length,0);assert.equal(h.get('speechService').isBusy(),false);
});

test('changing direction preserves text identity but changes render hash and forbids old-ID overwrite',async()=>{
    const h=harness();await h.configure();const first=await h.plan(),second=await h.plan(h.raw(['压着怒气、稍慢','平静'])),service=h.get('speechService'),speechPlan=h.get('speechPlan');
    assert.equal(first.sourceHash,second.sourceHash);assert.equal(first.source,second.source);assert.notEqual(await speechPlan.renderHash(first.units),await speechPlan.renderHash(second.units));
    await service.prepare(h.turnFor(first,'same-id'),first);const original=[...h.clips.values()].map(c=>c.cacheKey);assert.equal(h.requests.length,2);
    await assert.rejects(service.prepare(h.turnFor(second,'same-id'),second),/表现描述|旧提供商/);assert.equal(h.requests.length,2);assert.deepEqual([...h.clips.values()].map(c=>c.cacheKey),original);
    await service.prepare(h.turnFor(second,'new-id'),second);assert.equal(h.requests.length,4);assert.equal(h.requests[2].body.text,'[压着怒气、稍慢] 第一句公开对白。');
    const changed=h.clips.get(JSON.stringify(['main','new-id',second.units[0].id+'/0']));assert.notEqual(changed.cacheKey,original[0]);
});

test('route changes require the exact current settings fingerprint before round preparation',async()=>{
    const h=harness();await h.configure(true);const round=h.get('speechRound');
    await round.withLease('main',async()=>{
        const draft=await h.createDraft();h.route.corsProxyUrl='https://second-proxy.example/voice';
        await assert.rejects(round.prepare(draft),/连接或声线已经改变/);assert.equal(h.requests.length,0);assert.equal((await round.load()).phase,'draft');
        await assert.rejects(round.prepare(draft,{adoptSettings:draft.settingsFingerprint}),/连接或声线已经改变/);assert.equal(h.requests.length,0);
        const current=await round.settings('main');assert.notEqual(current.fingerprint,draft.settingsFingerprint);
        const prepared=await round.prepare(draft,{adoptSettings:current.fingerprint});assert.equal(prepared.settingsFingerprint,current.fingerprint);assert.equal(h.requests.length,2);
        assert.ok(h.requests.every(r=>new URL(r.url).hostname==='second-proxy.example'));
    });
});

test('one preparation captures its route; changing global config during first POST cannot reroute the second',async()=>{
    const h=harness();await h.configure();const plan=await h.plan(),started=deferred(),late=deferred();
    h.state.fetchHandler=()=>{if(h.requests.length===1){started.resolve();return late.promise;}return audioResponse();};
    const pending=h.get('speechService').prepare(h.turnFor(plan),plan);await started.promise;h.route.corsProxyUrl='https://different.example';late.resolve(audioResponse());await pending;
    assert.equal(h.requests.length,2);assert.ok(h.requests.every(r=>new URL(r.url).hostname==='proxy.example'));
});

for(const kind of ['epoch','reference'])test('config save waiting on storage rejects '+kind+' restore without writing',async()=>{
    const h=harness();await h.configure();const original=structuredClone(h.settings.get('config:main')),gate=h.pause('getSetting','config:main');
    const pending=h.get('speechConfig').save({provider:{kind:'fish-drama3',speed:1.25}}),rejected=assert.rejects(pending,e=>e.name==='AbortError');await gate.entered;h.restore(kind);gate.release();await rejected;
    assert.equal(h.writes.length,0);assert.deepEqual(h.settings.get('config:main'),original);assert.equal(h.requests.length,0);
});

test('round/turn final publication happens once after both clips, with replay remaining local',async()=>{
    const h=harness();await h.configure(true);assert.equal(await h.finishTurn(),true);assert.equal(h.requests.length,2);assert.equal(h.commits.length,1);
    const round=h.get('speechRound'),draft=await round.load();assert.equal(draft.phase,'published');assert.equal(h.history[0].roundSpeech.status,'ready');
    assert.ok(!JSON.stringify(draft).includes(FAKE_KEY));assert.ok(!JSON.stringify([...h.turns.values()]).includes(FAKE_KEY));
    const message=h.history[0],binding=await round.replay(message,message.presentationPlan,0);assert.ok(binding);assert.equal(binding.workspaceId,'main');assert.ok(binding.units.length);
    const blob=await round.clip(binding,binding.units[0]);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),mp3);assert.equal(h.requests.length,2,'replay never generates');
    assert.equal(await h.get('speechTurn').resume(draft.id,{},h.commit),true);assert.equal(h.commits.length,1,'existing evidence prevents a second commit');assert.equal(h.requests.length,2);
});

for(const kind of ['epoch','reference'])test('restoring '+kind+' during real round preparation cancels publication and ignores late result',async()=>{
    const h=harness();await h.configure(true);const started=deferred(),late=deferred();h.state.fetchHandler=()=>{started.resolve();return late.promise;};
    const pending=h.finishTurn();await started.promise;h.restore(kind);late.resolve(audioResponse());assert.equal(await pending,false);await flush();
    assert.equal(h.commits.length,0);assert.equal(h.history.length,0);assert.equal(h.clips.size,0);assert.equal(h.requests.length,1);assert.equal(h.get('speechService').isBusy(),false);assert.equal(h.get('speechTurn').active(),false);assert.equal(h.heldLocks.size,0);
    assert.notEqual((await h.get('speechRound').load()).phase,'published');
});

test('unknown committing state is never retried, silently published, or discarded',async()=>{
    const h=harness();await h.configure(true);const round=h.get('speechRound');let draft;
    await round.withLease('main',async()=>{draft=await h.createDraft();draft=await round.update(draft,{phase:'committing'});});
    await assert.rejects(h.get('speechTurn').resume(draft.id,{},h.commit),/待核对|重复结算/);
    await assert.rejects(h.get('speechTurn').resume(draft.id,{silent:true},h.commit),/待核对|重复结算/);
    await assert.rejects(round.discard(draft.id),/待核对/);await assert.rejects(h.get('speechTurn').begin(),/待发布|待办/);
    assert.equal(h.requests.length,0);assert.equal(h.commits.length,0);assert.equal((await round.load()).phase,'committing');assert.equal(h.heldLocks.size,0);
});

test('commit callback failure leaves committing evidence uncertain and resume never submits again',async()=>{
    const h=harness();await h.configure(true);let commits=0;
    await assert.rejects(h.finishTurn(h.raw(),()=>{commits++;throw Error('synthetic commit uncertainty');}),/synthetic commit uncertainty/);
    const draft=await h.get('speechRound').load();assert.equal(draft.phase,'committing');assert.equal(h.requests.length,2);
    await assert.rejects(h.get('speechTurn').resume(draft.id,{},()=>{commits++;return true;}),/待核对|重复结算/);assert.equal(commits,1);assert.equal(h.requests.length,2);
});

test('audio-store failure retains default text capability without synthesizing',async()=>{
    const h=harness();h.failures.set('getSetting:round-draft:main',new Error('synthetic IDB unavailable'));
    assert.equal(await h.get('speechTurn').begin(),null);assert.equal(await h.finishTurn(),true);assert.equal(h.commits.length,1);assert.equal(h.commits[0].media,undefined);assert.equal(h.requests.length,0);
});

test('unreadable single setting is disabled rather than breaking ordinary text',async()=>{
    const h=harness();h.failures.set('getSetting:single-test:main',new Error('synthetic setting failure'));
    assert.equal(await h.get('speechTurn').begin(),null);assert.equal(await h.finishTurn(),true);assert.equal(h.requests.length,0);
});

for(const kind of ['epoch','reference'])test('store failure after '+kind+' restore does not authorize the old text request',async()=>{
    const h=harness(),gate=h.pause('getSetting','round-draft:main');h.failures.set('getSetting:round-draft:main',new Error('synthetic IDB unavailable'));
    const pending=h.get('speechTurn').begin(),rejected=assert.rejects(pending,e=>e.name==='AbortError');await gate.entered;h.restore(kind);gate.release();await rejected;
    assert.equal(h.requests.length,0);assert.equal(h.commits.length,0);assert.equal(h.get('speechTurn').active(),false);
});
