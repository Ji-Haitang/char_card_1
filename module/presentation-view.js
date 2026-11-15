/** Frozen reading state and live operational state are deliberately separate projections. */
var presentationView = (function () {
    'use strict';
    function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
    function identity(id,mode){if(typeof id!=='string'||!id||![0,1].includes(mode))throw new Error('演出视图缺少合法上下文');}
    function world(v){return{mode:v.mode,mapLocation:String(v.mapLocation||''),seasonStatus:String(v.seasonStatus||'winter'),dayNightStatus:v.dayNightStatus==='night'?'night':'daytime'};}
    function captureReading(input){
        identity(input.workspaceId,input.mode);if(typeof input.sourceText!=='string'||!Array.isArray(input.frames))throw new Error('阅读快照缺少原文或帧');
        var frames=structuredClone(input.frames);if(frames.some(function(f){return !f||typeof f.text!=='string'||!Array.isArray(f.cast)||f.cast.length>2;}))throw new Error('阅读帧不符合上游双人结构');
        return freeze({schema:1,kind:'reading-snapshot',workspaceId:input.workspaceId,sourceText:input.sourceText,contextOrigin:input.contextOrigin==='recorded'?'recorded':'capture-time',world:world(input),frames:frames});
    }
    function readingFrame(snapshot,index,id){if(!snapshot||snapshot.schema!==1||snapshot.kind!=='reading-snapshot'||snapshot.workspaceId!==id||!Number.isInteger(index)||index<0||index>=snapshot.frames.length)throw new Error('阅读快照或帧序号已失效');return{kind:'reading',workspaceId:id,contextOrigin:snapshot.contextOrigin,index:index,frame:structuredClone(snapshot.frames[index]),world:structuredClone(snapshot.world)};}
    function currentLocation(input){
        if(input.kind!=='live-input')throw new Error('当前地点只能读取实时状态');identity(input.workspaceId,input.mode);
        var seen=new Set(),roster=[];(input.residents||[]).forEach(function(r){if(!r||typeof r.id!=='string'||!r.name||seen.has(r.id))return;seen.add(r.id);
            var mood=input.mode===0?(input.emotions?.[r.name]||'平静'):'平静';if(mood==='none'||/^特殊CG\d+$/.test(mood))mood='平静';roster.push({id:r.id,npc:r.name,kind:'npc',emotion:mood});});
        var selected=(input.visibleIds||[]).filter(function(id,i,ids){return seen.has(id)&&ids.indexOf(id)===i;});
        var cast=(selected.length?selected:roster.map(function(r){return r.id;})).slice(0,2).map(function(id){return Object.assign({},roster.find(function(r){return r.id===id;}));});
        cast.forEach(function(a,i){a.anchor=cast.length===1?50:[30,70][i];});var scene=input.mode===0?String(input.locationName||'天山派'):'none';
        return{kind:'current-location',workspaceId:input.workspaceId,world:world(input),locationId:input.mode===0?String(input.locationId||''):null,locationName:input.mode===0?scene:String(input.mapLocation||''),rosterKind:input.mode===0?'residents':'companions',roster:roster,cast:cast,frame:{text:'',scene:scene,time:input.time||null,cast:structuredClone(cast),cg:'none',cgOwnerId:null},inputEnabled:input.inputEnabled===true,generating:input.generating===true};
    }
    function liveWorld(){return{mode:GameMode,mapLocation:mapLocation,seasonStatus:seasonStatus,dayNightStatus:dayNightStatus};}
    function captureCurrentReading(){var source=String(currentStoryText||'');return captureReading(Object.assign(liveWorld(),{workspaceId:mediaContext.workspaceId(),sourceText:source,contextOrigin:'capture-time',frames:presentationFrames.parseFrames(source,buildGalParseContext(GameMode))}));}
    function currentFromGame(){
        var residents=[],visible=[];if(GameMode===0){residents=getNpcsAtLocation(userLocation);var container=document.getElementById(userLocation+'-npcs');if(container)visible=Array.from(container.querySelectorAll('.npc-portrait[data-npc-id]')).map(function(e){return e.dataset.npcId;});}
        else(companionNPC||[]).forEach(function(value){var key=typeof value==='string'?value:value&&(value.id||value.name);var id=Object.prototype.hasOwnProperty.call(npcs,key)?key:npcNameToId[key];if(id&&npcs[id])residents.push({id:id,name:npcs[id].name});});
        return currentLocation(Object.assign(liveWorld(),{kind:'live-input',workspaceId:mediaContext.workspaceId(),residents:residents,visibleIds:visible,emotions:npcTurnEmotions,locationId:userLocation,locationName:locationNames[userLocation],time:currentGameTime,inputEnabled:inputEnable!==0,generating:mediaContext.isBusy()}));
    }
    return{captureReading:captureReading,readingFrame:readingFrame,currentLocation:currentLocation,captureCurrentReading:captureCurrentReading,currentFromGame:currentFromGame};
})();
