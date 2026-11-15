import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './media-speech-fixture.mjs';

test('new-action gate waits for initial pending load without changing isBusy or blocking config reads',async()=>{
    const h=harness(),round=h.get('speechRound'),turn=h.get('speechTurn');
    assert.equal(round.pendingState().ready,false);assert.equal(turn.guardProgress(),false);assert.equal(h.get('mediaContext').isBusy(),false);
    assert.equal((await h.get('speechConfig').get()).enabled,false);await round.load();
    assert.equal(round.pendingState().ready,true);assert.equal(turn.guardProgress(),true);
});

test('known pending survives storage read failure and direct begin cannot fall back to text',async()=>{
    const h=harness();await h.configure(true);const round=h.get('speechRound'),turn=h.get('speechTurn');
    await round.withLease('main',async()=>{await h.createDraft();});assert.equal(round.pendingState().pending,true);
    h.failures.set('getSetting:round-draft:main',new Error('synthetic IDB unavailable'));
    await assert.rejects(round.load(),/synthetic/);assert.equal(round.pendingState().pending,true);assert.equal(turn.guardProgress(),false);
    await assert.rejects(turn.begin(),/先处理声音待办/);assert.equal(h.requests.length,0);assert.equal(h.commits.length,0);
});

test('unseen optional audio-store failure still permits default-off text capability',async()=>{
    const h=harness();h.failures.set('getSetting:round-draft:main',new Error('synthetic IDB unavailable'));
    assert.equal(await h.get('speechTurn').begin(),null);assert.equal(h.get('speechRound').pendingState().ready,true);assert.equal(h.get('speechTurn').guardProgress(),true);
});

test('completed discard clears the synchronous gate only after persistence',async()=>{
    const h=harness();await h.configure(true);const round=h.get('speechRound');let draft;
    await round.withLease('main',async()=>{draft=await h.createDraft();});assert.equal(h.get('speechTurn').guardProgress(),false);
    const gate=h.pause('setSetting','round-draft:main'),pending=round.discard(draft.id);await gate.entered;
    assert.equal(round.pendingState().pending,true);gate.release();await pending;
    assert.equal(round.pendingState().phase,'discarded');assert.equal(h.get('speechTurn').guardProgress(),true);
});

test('an older in-flight null read cannot overwrite a successfully persisted pending observation',async()=>{
    const h=harness();await h.configure(true);const round=h.get('speechRound'),gate=h.pause('getSetting','round-draft:main');
    const stale=round.load();await gate.entered;
    await round.withLease('main',async()=>{await h.createDraft();});const expected=round.pendingState();
    gate.release();assert.equal(await stale,null);assert.deepEqual(round.pendingState(),expected);assert.equal(h.get('speechTurn').guardProgress(),false);
});

test('failed terminal write retains pending while committing remains a distinct inspection-only warning',async()=>{
    const h=harness();await h.configure(true);const round=h.get('speechRound');let draft;
    await round.withLease('main',async()=>{draft=await h.createDraft();draft=await round.update(draft,{phase:'committing'});});
    assert.match(h.get('speechTurn').progressReason(),/提交状态待核对/);
    h.failures.set('setSetting:round-draft:main',new Error('synthetic persistence failure'));
    await assert.rejects(round.update(draft,{phase:'published'}),/synthetic/);assert.equal(round.pendingState().pending,true);assert.equal(round.pendingState().phase,'committing');
});
