import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompileLifecycle,renderPixelRatio} from '../../scene3d/src/runtime.js';
import {HOTSPOTS} from '../../scene3d/src/interactive-hotspots.js';
test('targeted compile preserves target scene lights without invoking compileAsync',async()=>{
 const room={},camera={},lights={},calls=[];
 const renderer={compile(...args){calls.push(args);return new Set()},compileAsync(){throw Error('forbidden')},extensions:{get:()=>null},getContext:()=>({isContextLost:()=>false})};
 const compiler=createCompileLifecycle(renderer,{setTimeout(){throw Error('no polling expected')},clearTimeout(){}});
 assert.equal(await compiler.compile(room,camera,()=>true,lights),true);assert.deepEqual(calls,[[room,camera,lights]]);
 assert.equal(compiler.snapshot().timers,0);compiler.dispose();
});
test('pixel budget caps both low and balanced without quality promotion',()=>{
 assert.equal(renderPixelRatio('low',3,390,844),1);assert.equal(renderPixelRatio('balanced',3,390,844),1.25);
 for(const quality of ['low','balanced'])for(const [w,h]of [[3840,2160],[7680,4320],[1280,900]]){
  const dpr=renderPixelRatio(quality,2,w,h);assert.ok(w*h*dpr*dpr<=4500000.01);assert.ok(dpr<=(quality==='low'?1:1.25));
 }
});
test('seventeen display-only labels map to eleven existing business rooms',()=>{
 assert.equal(Object.keys(HOTSPOTS).length,11);assert.equal(Object.values(HOTSPOTS).flat().length,17);
 assert.deepEqual(HOTSPOTS.council,[['sand_table','汇报'],['bounty_board','悬赏任务'],['archive','打探传闻']]);
 assert.deepEqual(HOTSPOTS.library,[['desk','学习'],['shelf_classics','技能习得']]);assert.equal(HOTSPOTS.guest_quarters,undefined);
});
