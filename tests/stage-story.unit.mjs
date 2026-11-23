import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const contains = vm.runInNewContext((await readFile(new URL('../module/stage-story-media.js',import.meta.url),'utf8'))+'\nstageStoryMedia.contains');
test('cached voice must belong to this sentence, even when the same words occur elsewhere',()=>{
    const blocks=[{sourceLine:2,text:'  回来。回来。 '},{sourceLine:4,text:'回来。'}],frames=blocks.map(b=>({text:b.text.trim()}));
    const page={frameIndex:0,start:3,end:6},unit={sourceLine:2,start:5,end:8,text:'回来。'};
    assert.ok(contains(blocks,frames,page,unit));
    assert.ok(!contains(blocks,frames,page,{...unit,start:2,end:5}));
    assert.ok(!contains(blocks,frames,page,{sourceLine:4,start:0,end:3,text:'回来。'}));
    const both={sourceLine:2,start:2,end:8,text:'回来。回来。'};
    assert.ok(!contains(blocks,frames,page,both));assert.ok(contains(blocks,frames,null,both));
});
const pages = vm.runInNewContext((await readFile(new URL('../module/stage-story.js',import.meta.url),'utf8'))+'\nstageStory.pagesFor');
test('sentence ranges preserve source, quoted endings and visual frame identity',()=>{
    const frames=[
        {text:'她回头：“谁？！”门开了。<br/>下一句。'},
        {text:'「阿弥陀佛，」呼延显双手合十，「第一句。第二句。」他说着抄起巨斧「开山」劈了过去。'}
    ];
    const result=Array.from(pages(frames));
    for(const [i,{text}] of frames.entries()){
        const strings=result.filter(p=>p.frameIndex===i).map(p=>text.slice(p.start,p.end));
        assert.equal(strings.join(''),text);
        assert.ok(strings.every(s=>s.isWellFormed()));
        if(i===0)assert.deepEqual(strings,['她回头：“谁？！”','门开了。<br/>','下一句。']);
        else assert.deepEqual(strings,['「阿弥陀佛，」','呼延显双手合十，「第一句。第二句。」','他说着抄起巨斧「开山」劈了过去。']);
    }
});

test('PROMPT_CORE_110 renders GAL script rules, permanent 【ID；情绪】 markers and 2h conditional time rule',async()=>{
    const ctx={window:{}};ctx.window=ctx;
    vm.createContext(ctx);
    vm.runInContext(await readFile(new URL('../module/prompt-data-core.js',import.meta.url),'utf8'),ctx);
    vm.runInContext(await readFile(new URL('../module/template-engine.js',import.meta.url),'utf8'),ctx);
    for(const [label,gd] of [
        ['gm0',{GameMode:0,newWeek:0,randomEvent:0,battleEvent:0,haveEvent:0}],
        ['gm1',{GameMode:1,newWeek:0,randomEvent:0,battleEvent:0,haveEvent:0}],
        ['gm1-random',{GameMode:1,newWeek:0,randomEvent:1,battleEvent:0,haveEvent:1}],
        ['gm1-battle',{GameMode:1,newWeek:0,randomEvent:0,battleEvent:1,haveEvent:1}],
    ]){
        const rendered=ctx.templateEngine.renderPromptTemplate(ctx.PROMPT_CORE_110,{user:'少侠',gameData:gd});
        assert.ok(!rendered.includes('保持不变'),label);
        assert.ok(rendered.includes('{{string: 叙述行或「」包裹的角色台词行。叙述行每行50-150字；台词行每行10-80字}}【{{enum: 说话人ID；情绪}}】'),label);
        assert.ok(rendered.includes('台词行只写「」包裹的角色口头台词，不能有旁白叙述'),label);
        assert.ok(rendered.includes('禁止输出类似"xx说："、"xx顿了一下，继续说，"、"xx心想"等承接或引导台词的语句'),label);
        assert.ok(rendered.includes('正文总计: 1500-2500字'),label);
        assert.ok(rendered.includes('台词行总字数占<MAIN_TEXT>正文总字数的比例大于50%'),label);
        assert.ok(rendered.includes('标记顺序: 段落正文【ID；情绪】|场景名|时间|NPC名:表情;NPC名:表情|NSFW行为'),label);
        assert.ok(rendered.includes('用户输入中没有明确时间跨度描述时，默认本回合首段到末段的时间跨度不超过2小时'),label);
        assert.ok(rendered.includes('<SUMMARY>') && rendered.includes('<SIDE_NOTE>'),label);
    }
    const weekly=ctx.templateEngine.renderPromptTemplate(ctx.PROMPT_CORE_110,{user:'少侠',gameData:{GameMode:0,newWeek:1,randomEvent:0,battleEvent:0,haveEvent:0}});
    assert.ok(!weekly.includes('【ID；情绪】'));
});

test('stripInlineSpeechMarkers strips line-end 【ID；情绪】 on non-TTS display without touching escaped or invalid shapes',async()=>{
    const uiSrc=await readFile(new URL('../module/game-ui.js',import.meta.url),'utf8');
    const m=/const INLINE_SPEECH_MARKER_RE[\s\S]*?^function _buildHistoryPages/m.exec(uiSrc);
    assert.ok(m,'stripInlineSpeechMarkers helper present in game-ui.js');
    const strip=vm.runInNewContext(m[0].replace(/\nfunction _buildHistoryPages$/,'')+'\nstripInlineSpeechMarkers');
    const raw=[
        '山风拂过石阶，檐角铜铃轻响。【NARRATOR；平静】|山门|08:00|萧白瑚:平静|none',
        '「早课快迟了，还不快走？」【D；轻快】|山门|08:05|萧白瑚:微笑|none',
        '「这就来。」【USER；温和】|山门|08:06|萧白瑚:微笑|none',
        '纯正文行也带标记。【M;低声】',
        '书中写着\\【D；欣喜】|山门|08:10|萧白瑚:平静|none',
    ].join('\n');
    assert.equal(strip(raw),[
        '山风拂过石阶，檐角铜铃轻响。|山门|08:00|萧白瑚:平静|none',
        '「早课快迟了，还不快走？」|山门|08:05|萧白瑚:微笑|none',
        '「这就来。」|山门|08:06|萧白瑚:微笑|none',
        '纯正文行也带标记。',
        '书中写着\\【D；欣喜】|山门|08:10|萧白瑚:平静|none',
    ].join('\n'));
    assert.equal(strip('「先别急。」【D；轻', {streaming:true}),'「先别急。」');
    assert.equal(strip('「先别急。」【NARR', {streaming:true}),'「先别急。」');
    assert.equal(strip('普通书名【天山剑谱】', {streaming:true}),'普通书名【天山剑谱】');
});
