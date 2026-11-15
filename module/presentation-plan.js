/** Portable local reading plan. Synchronous SHA-256 keeps capture inside the existing commit section. */
var presentationPlan = (function () {
    'use strict';
    var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function rotate(v,n){return(v>>>n)|(v<<(32-n));}
    function hash(text){
        var bytes=new TextEncoder().encode(String(text)),size=Math.ceil((bytes.length+9)/64)*64;
        var padded=new Uint8Array(size);padded.set(bytes);padded[bytes.length]=0x80;var data=new DataView(padded.buffer);
        data.setUint32(size-8,Math.floor(bytes.length/0x20000000));data.setUint32(size-4,bytes.length<<3);
        var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64);
        for(var offset=0;offset<size;offset+=64){
            for(var i=0;i<16;i++)w[i]=data.getUint32(offset+i*4);
            for(i=16;i<64;i++){var x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+w[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0;}
            var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],q=h[7];
            for(i=0;i<64;i++){var t1=(q+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0;
                var t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;q=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
            var block=[a,b,c,d,e,f,g,q];for(i=0;i<8;i++)h[i]=(h[i]+block[i])>>>0;
        }
        return h.map(function(n){return n.toString(16).padStart(8,'0');}).join('');
    }
    function actor(a){return{id:a.id,npc:a.npc,kind:a.kind,emotion:a.emotion||'none',anchor:a.anchor};}
    function frame(f,event){return{text:String(f.text||''),scene:String(f.scene||'none'),time:f.time||null,cast:(f.cast||[]).map(actor),cg:String(f.cg||'none'),cgOwnerId:f.cgOwnerId||null,sourceLine:Number.isInteger(f.sourceLine)?f.sourceLine:null,event:!!event};}
    function world(v){return{mode:v.mode,mapLocation:String(v.mapLocation||''),seasonStatus:v.seasonStatus||'winter',dayNightStatus:v.dayNightStatus==='night'?'night':'daytime',cgVariant:[1,2,3,4].includes(v.cgVariant)?v.cgVariant:1};}
    // Only recognize the known four-field legacy layout; do not strip arbitrary pipe prose.
    function legacyFour(p){
        if(p.length!==4)return false;
        var roster=typeof npcs==='undefined'?[]:Object.keys(npcs).flatMap(function(id){return[id,npcs[id].name];});
        var scenes=['none','无'].concat(typeof locationNames==='undefined'?[]:Object.values(locationNames),typeof legacySceneOptions==='undefined'?[]:legacySceneOptions,typeof slgSceneOptions==='undefined'?[]:slgSceneOptions);
        var moods=['none','无'].concat(typeof slgEmotionOptions==='undefined'?[]:slgEmotionOptions,typeof slgEmotionExtras==='undefined'?[]:slgEmotionExtras);
        return !!p[0].trim()&&roster.concat(['none','无']).includes(p[1].trim())&&scenes.includes(p[2].trim())&&(moods.includes(p[3].trim())||/^特殊CG\d+$/.test(p[3].trim()));
    }
    function readingSource(source,schema){var text=source.replace(/\r\n?/g,'\n');return schema===1?text:text.split('\n').map(function(line){return legacyFour(line.split('|'))?line+'|none':line;}).join('\n');}
    function sourceEntries(source,schema){return readingSource(source,schema).split('\n').map(function(line,index){var p=line.split('|');var ambiguous=schema===2&&p.length===5&&!legacyFour(p.slice(0,4))&&legacyFour(p.slice(1));return{line:index,text:(p.length===5&&!ambiguous?p[0]:line).trim()};}).filter(function(e){return !!e.text;});}
    function sourceBodies(source,schema){return sourceEntries(source,schema).map(function(e){return e.text;});}
    function splitUnits(frames,schema){
        var units=[];frames.forEach(function(f,index){var chars=Array.from(f.text),at=0,offset=0;
            while(at<chars.length){var end=Math.min(at+120,chars.length),found=false;
                if(end<chars.length)for(var n=end-1;n>=at+60;n--){if(/[。！？；\n]/.test(chars[n])){end=n+1;found=true;break;}}
                if(schema===2&&!found&&end<chars.length)for(n=end-1;n>=at;n--){if(/[。！？；\n]/.test(chars[n])){end=n+1;break;}}
                if(schema===2&&end<chars.length){var limit=Math.min(end+8,chars.length);while(end<limit&&/[」』”’）)\]】》〉〕〗〙〛]/.test(chars[end]))end++;while(end>at+1&&/[「『“‘（(\[【《〈〔〖〘〚]/.test(chars[end-1]))end--;}
                var text=chars.slice(at,end).join('');units.push({frameIndex:index,start:offset,end:offset+text.length,kind:'unclassified',speakerId:null});offset+=text.length;at=end;
            }});return units;
    }
    function readingFrames(source,context){
        var text=readingSource(source,2),entries=sourceEntries(source,2),bodies=new Map(entries.map(function(e){return[e.line,e.text];}));
        var sequence=0,marker='\uE000READ_PIPE\uE001';while(source.includes(marker))marker='\uE000READ_PIPE_'+(++sequence)+'\uE001';
        var input=text.split('\n').map(function(line,index){return line.includes('|')&&bodies.get(index)===line.trim()?line.split('|').join(marker):line;}).join('\n');
        return presentationFrames.parseFrames(input,context).filter(function(f){return f.text.length;}).map(function(f){return frame(Object.assign({},f,{text:f.text.split(marker).join('|')}),false);});
    }
    function create(source,options){
        options=options||{};if(typeof source!=='string'||![0,1].includes(options.mode))throw new Error('阅读计划缺少原文或合法模式');
        var context=Object.assign({},options.parseContext||buildGalParseContext(options.mode),{gameMode:options.mode});
        var frames=readingFrames(source,context),bodies=sourceBodies(source,2),layout='legacy';
        if(frames.every(function(f){return f.scene==='none'&&!f.cast.length;})&&bodies.some(function(text){return text.includes('|');}))layout='plain-fallback';
        if(layout==='plain-fallback'||frames.map(function(f){return f.text;}).join('\n\n')!==bodies.join('\n\n')){layout='plain-fallback';frames=bodies.map(function(text){return frame({text:text,cast:[]},false);});}
        var eventText=typeof options.eventText==='string'?options.eventText:'';
        if(eventText)frames.push(frame(Object.assign({},frames[frames.length-1]||{},{text:eventText,sourceLine:null}),true));
        var plan={schema:2,origin:options.origin==='initial-state'?'initial-state':'committed',layout:layout,sourceHash:hash(source),world:world(options),eventText:eventText,frames:frames,units:splitUnits(frames,2)};
        plan.planHash=hash(JSON.stringify(plan));return plan;
    }
    function keys(value,names){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(function(n){return Object.prototype.hasOwnProperty.call(value,n);});}
    function bad(reason){throw new Error('阅读计划无效：'+reason);}
    function safeName(value){return typeof value==='string'&&!/[\\/<>%\u0000-\u001f]/.test(value)&&!value.includes('..');}
    function validate(source,value){
        if(typeof source!=='string'||!keys(value,['schema','origin','layout','sourceHash','world','eventText','frames','units','planHash'])||![1,2].includes(value.schema)||!['committed','initial-state'].includes(value.origin)||!['legacy','plain-fallback'].includes(value.layout))bad('schema');
        if(value.sourceHash!==hash(source))bad('source-hash');var w=value.world;
        if(!keys(w,['mode','mapLocation','seasonStatus','dayNightStatus','cgVariant'])||![0,1].includes(w.mode)||!safeName(w.mapLocation)||!['spring','summer','autumn','winter'].includes(w.seasonStatus)||!['daytime','night'].includes(w.dayNightStatus)||![1,2,3,4].includes(w.cgVariant))bad('world');
        var lineCount=source.split(/\r\n?|\n/).length;
        if(typeof value.eventText!=='string'||!Array.isArray(value.frames)||value.frames.length>lineCount+1)bad('frames');
        var frames=value.frames.map(function(f,index){
            if(!keys(f,['text','scene','time','cast','cg','cgOwnerId','sourceLine','event'])||typeof f.text!=='string'||!f.text.length||!safeName(f.scene)||!safeName(f.cg)||(f.time!==null&&GalParser.parseTime(f.time)!==f.time)||!Array.isArray(f.cast)||f.cast.length>2||(f.sourceLine!==null&&(!Number.isInteger(f.sourceLine)||f.sourceLine<0||f.sourceLine>=lineCount))||typeof f.event!=='boolean'||(f.event&&index!==value.frames.length-1))bad('frame');
            var seen=new Set();f.cast.forEach(function(a){if(!keys(a,['id','npc','kind','emotion','anchor'])||seen.has(a.id)||![30,50,70].includes(a.anchor)||!safeName(a.emotion)||typeof npcs==='undefined'||!Object.prototype.hasOwnProperty.call(npcs,a.id)||npcs[a.id].name!==a.npc||a.kind!=='npc')bad('actor');seen.add(a.id);});
            if(f.cgOwnerId!==null&&!f.cast.some(function(a){return a.id===f.cgOwnerId;}))bad('cg-owner');return frame(f,f.event);
        });
        var events=frames.filter(function(f){return f.event;});if(events.length!==(value.eventText?1:0)||(events.length&&events[0].text!==value.eventText))bad('event-text');
        if(frames.filter(function(f){return !f.event;}).map(function(f){return f.text;}).join('\n\n')!==sourceBodies(source,value.schema).join('\n\n'))bad('text-coverage');
        var units=splitUnits(frames,value.schema);if(!Array.isArray(value.units)||value.units.length!==units.length||value.units.some(function(u,index){return !keys(u,['frameIndex','start','end','kind','speakerId'])||Object.keys(units[index]).some(function(k){return u[k]!==units[index][k];});}))bad('units');
        var normalized={schema:value.schema,origin:value.origin,layout:value.layout,sourceHash:value.sourceHash,world:world(w),eventText:value.eventText,frames:frames,units:units};
        if(value.planHash!==hash(JSON.stringify(normalized)))bad('plan-hash');normalized.planHash=value.planHash;return normalized;
    }
    function captureCurrent(source,origin,eventDescription){
        var event=(typeof currentBattleEvent!=='undefined'&&currentBattleEvent)||(typeof currentRandomEvent!=='undefined'&&currentRandomEvent);
        return create(source,{origin:origin,mode:GameMode,mapLocation:mapLocation,seasonStatus:seasonStatus,dayNightStatus:dayNightStatus,cgVariant:typeof randIdx==='undefined'?1:randIdx,parseContext:buildGalParseContext(GameMode),eventText:typeof eventDescription==='string'?eventDescription:(event&&typeof event.事件描述==='string'?event.事件描述:'')});
    }
    function withCurrentWorld(source,prepared){
        var plan=validate(source,prepared);
        plan.world=world({mode:GameMode,mapLocation:mapLocation,seasonStatus:seasonStatus,dayNightStatus:dayNightStatus,cgVariant:typeof randIdx==='undefined'?1:randIdx});
        delete plan.planHash;plan.planHash=hash(JSON.stringify(plan));
        return validate(source,plan);
    }
    function hasCursor(message,plan,cursor){return cursor&&keys(cursor,['schema','messageId','sourceHash','planHash','unitIndex'])&&cursor.schema===1&&cursor.messageId===message.id&&cursor.sourceHash===plan.sourceHash&&cursor.planHash===plan.planHash&&Number.isInteger(cursor.unitIndex)&&cursor.unitIndex>=0&&cursor.unitIndex<plan.units.length;}
    function cursorIndex(message,plan,cursor){return hasCursor(message,plan,cursor)?cursor.unitIndex:0;}
    function current(){
        var message=storageService.loadUIConversation().slice().reverse().find(function(m){return m&&m.role==='assistant';});
        if(!message||typeof message.id!=='string'||!message.id||message.content!==currentStoryText)return{status:'untracked'};
        if(!message.presentationPlan)return{status:'legacy',messageId:message.id,source:message.content};
        try{var plan=validate(message.content,message.presentationPlan);return{status:'ready',workspaceId:mediaContext.workspaceId(),messageId:message.id,source:message.content,plan:plan,unitIndex:cursorIndex(message,plan,gameData.presentationCursor)};}
        catch(error){return{status:'invalid',messageId:message.id,reason:error.message};}
    }
    function setCursor(request){
        if(!request||request.workspaceId!==mediaContext.workspaceId()||(request.context&&!mediaContext.isCurrent(request.context)))throw new Error('游标不属于当前游戏上下文');
        if(typeof request.messageId!=='string'||!request.messageId)throw new Error('游标缺少稳定消息ID');
        var matches=storageService.loadUIConversation().filter(function(m){return m&&m.role==='assistant'&&m.id===request.messageId;});
        if(matches.length!==1)throw new Error('游标正文不存在或ID不唯一');var message=matches[0],plan=validate(message.content,message.presentationPlan);
        if(message.content!==currentStoryText||plan.sourceHash!==request.sourceHash||plan.planHash!==request.planHash||!Number.isInteger(request.unitIndex)||request.unitIndex<0||request.unitIndex>=plan.units.length)throw new Error('游标来源或段序号已失效');
        var cursor={schema:1,messageId:message.id,sourceHash:plan.sourceHash,planHash:plan.planHash,unitIndex:request.unitIndex};gameData.presentationCursor=cursor;storageService.saveAppState({gameData:gameData});return structuredClone(cursor);
    }
    function unitForPage(plan,pages,pageIndex){
        if(!plan||!Array.isArray(plan.frames)||!Array.isArray(plan.units)||!Array.isArray(pages)||!Number.isInteger(pageIndex)||!pages[pageIndex])return -1;
        function text(v){return String(v||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/\r\n?/g,'\n');}
        var target=pages[pageIndex];if(target.event){var eventFrame=plan.frames.findIndex(function(f){return f.event&&text(f.text)===text(target.text);});return plan.units.findIndex(function(u){return u.frameIndex===eventFrame;});}
        if(pages.filter(function(p){return !p.event;}).map(function(p){return text(p.text);}).join('\n')!==plan.frames.filter(function(f){return !f.event;}).map(function(f){return text(f.text);}).join('\n'))return -1;
        var at=0;for(var i=0;i<pageIndex;i++)if(!pages[i].event)at+=text(pages[i].text).length+1;
        var starts=[],offset=0;plan.frames.forEach(function(f,i){starts[i]=offset;if(!f.event)offset+=text(f.text).length+1;});
        return plan.units.findIndex(function(u){var f=plan.frames[u.frameIndex];return !f.event&&starts[u.frameIndex]+text(f.text.slice(0,u.start)).length<=at&&at<starts[u.frameIndex]+text(f.text.slice(0,u.end)).length;});
    }
    return{hash:hash,create:create,validate:validate,captureCurrent:captureCurrent,withCurrentWorld:withCurrentWorld,cursorIndex:cursorIndex,current:current,setCursor:setCursor,unitForPage:unitForPage};
})();
