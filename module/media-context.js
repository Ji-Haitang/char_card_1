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
        if(typeof presentationFlow!=='undefined')presentationFlow.cancel();
        if(typeof speechTurn!=='undefined')speechTurn.cancel();
        if(typeof speechService!=='undefined')speechService.stop();
        if(typeof speechSingleTest!=='undefined')speechSingleTest.close();
        if(typeof speechInlinePlayer!=='undefined')speechInlinePlayer.invalidate();
        if(typeof presentationHost!=='undefined')presentationHost.invalidate();
    }
    function sorted(value){
        if(Array.isArray(value))return value.map(sorted);
        if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(function(k){return [k,sorted(value[k])];}));
        return value;
    }
    async function publicationFingerprint(){
        var state=structuredClone(gameData);delete state.presentationCursor;
        return speechPlan.hash(JSON.stringify(sorted({history:structuredClone(storageService.loadUIConversation()),state:state})));
    }
    return Object.freeze({workspaceId:workspaceId,capture:capture,isCurrent:isCurrent,isBusy:busy,
        pendingChoice:pendingChoice,invalidate:invalidate,publicationFingerprint:publicationFingerprint});
})();
