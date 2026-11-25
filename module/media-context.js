/** Active game context shared by speech and presentation. Persistent media uses one namespace. */
var mediaContext = (function () {
    'use strict';
    var epoch=0;
    function workspaceId(){return 'main';}
    function capture(){return {epoch:epoch,state:typeof gameData==='undefined'?null:gameData};}
    function isCurrent(ticket){return !!ticket&&ticket.epoch===epoch&&ticket.state===(typeof gameData==='undefined'?null:gameData);}
    function busy(){return typeof pipeline!=='undefined'&&(typeof pipeline.isBusy==='function'?pipeline.isBusy():pipeline.isStreaming());}
    function pendingChoice(){
        try{var active=typeof sideQuestService!=='undefined'&&sideQuestService.getActive();var p=active&&active.pendingInteraction;
            return !!(p&&p.kind==='choice'&&p.state==='awaiting');}catch(_){return false;}
    }
    function invalidate(){
        epoch++;
        if(typeof stageStory!=='undefined')stageStory.reset();
        if(typeof speechService!=='undefined')speechService.cancelTurn();
        if(typeof speechService!=='undefined')speechService.stop();
        if(typeof speechUI!=='undefined')speechUI.closeSingle();
        if(typeof speechPlaybackUI!=='undefined')speechPlaybackUI.invalidate();
    }
    function sorted(value){
        if(Array.isArray(value))return value.map(sorted);
        if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(function(k){return [k,sorted(value[k])];}));
        return value;
    }
    async function publicationFingerprint(version=2){
        var state=structuredClone(gameData);delete state.presentationCursor;
        if(version===2)for(const key of ['uiStyle','layoutMode','storyFontFamily','textFontLevel','galPortraitStyle'])delete state[key];
        else if(version!==1)throw new Error('不支持此待办的进度校验版本');
        return speechService.hash(JSON.stringify(sorted({history:structuredClone(storageService.loadUIConversation()),state:state})));
    }
    return Object.freeze({workspaceId:workspaceId,capture:capture,isCurrent:isCurrent,isBusy:busy,
        pendingChoice:pendingChoice,invalidate:invalidate,publicationFingerprint:publicationFingerprint});
})();
