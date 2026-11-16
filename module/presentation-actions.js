/** Fixed routes into the existing game. Validate current context before invoking, never duplicate settlement. */
var presentationActions=(function(){
    'use strict';var dispatching=false;
    var places=[['yanwuchang','演武场','练武'],['cangjingge','藏经阁','学习'],['huofang','伙房','打杂'],['houshan','后山','探索','秘密赌场'],['yishiting','议事厅','汇报'],['tiejiangpu','铁匠铺','打铁'],['nandizi','男弟子房','休息'],['nvdizi','女弟子房','拜访'],['shanmen','山门'],['gongtian','公田','耕种'],['danfang','丹房','炼丹']];
    function getState(){return{workspaceId:mediaContext.workspaceId(),context:mediaContext.capture(),mode:GameMode,location:GameMode===0?userLocation:mapLocation,inputEnabled:inputEnable!==0,busy:!!(mediaContext.isBusy()||(typeof speechService!=='undefined'&&speechService.isBusy())),eventKind:mediaContext.pendingChoice()?'sidequest':currentBattleEvent?'battle':currentRandomEvent?'random':(typeof currentSpecialEvent!=='undefined'&&currentSpecialEvent?'special':'none')};}
    function residents(s){return s.mode===0?getNpcsAtLocation(s.location).map(function(n){return{id:n.id,name:n.name};}):[];}
    function locals(s){var p=s.mode===0&&places.find(function(p){return p[0]===s.location;});return p?p.slice(2).map(function(a){return{action:a,label:a};}):[];}
    function describe(){var s=getState();return{state:s,places:s.mode===0?places.map(function(p){return{id:p[0],label:p[1]};}):[],locals:locals(s),residents:residents(s)};}
    function require(v,reason){if(!v)throw new Error(reason);}
    function fields(args,names){require(args&&typeof args==='object'&&!Array.isArray(args)&&Reflect.ownKeys(args).length===names.length&&names.every(function(n){return Object.prototype.hasOwnProperty.call(args,n); }),'动作参数不合法');}
    function route(id,args,s){var home=s.mode===0;
        switch(id){
        case'move':fields(args,['locationId']);require(home&&places.some(function(p){return p[0]===args.locationId;}),'不能前往该地点');return function(){return goToLocation(args.locationId);};
        case'local':fields(args,['action']);require(locals(s).some(function(a){return a.action===args.action;}),'当前地点没有此行动');return function(){return performAction(args.action,s.location);};
        case'trade':fields(args,['type']);require(home&&((s.location==='huofang'&&args.type==='food')||(s.location==='tiejiangpu'&&args.type==='equipment')),'当前地点不能交易');return function(){return showTrading(args.type);};
        case'npc-interact':case'npc-spar':case'gift':fields(args,['npcId']);require(typeof args.npcId==='string'&&residents(s).some(function(n){return n.id===args.npcId;}),'人物不在当前地点');return function(){return id==='gift'?giveGift(args.npcId):npcAction(args.npcId,id==='npc-interact'?'互动':'切磋');};
        case'event-option':fields(args,['index','event']);require(currentRandomEvent&&!currentBattleEvent&&args.event===currentRandomEvent&&Number.isInteger(args.index)&&args.index>=1&&args.index<=3,'事件或选项已失效');var option=currentRandomEvent[['选项一','选项二','选项三'][args.index-1]];require(option,'事件选项不存在');return function(){return handleEventOption(args.index,option);};
        case'battle-start':case'battle-flee':fields(args,['event']);require(currentBattleEvent&&args.event===currentBattleEvent,'战斗事件已失效');return function(){return id==='battle-start'?startBattle():fleeBattle();};
        default:fields(args,[]);switch(id){
            case'map':require(home,'下山时不能返回门内地图');return function(){return backToMap();};
            case'skills':require(home&&s.location==='cangjingge','请前往藏经阁');return function(){return showSkillLibrary();};
            case'inventory':return function(){return showInventory();};case'equipment':return function(){return showEquipment();};case'skill-equipment':return function(){return showSkillEquipment();};
            case'settings':return function(){return showGameSettings();};case'config':return function(){return showConfigModal();};case'stats':return function(){return showPlayerStats();};case'relationships':return function(){return showRelationships();};
            case'saves':return function(){return showLoadModal();};case'history':return function(){return showHistorySummary();};case'logs':return function(){return showPipelineLog();};
            case'bounty':require(home&&s.location==='yishiting','请前往议事厅');return function(){return showBountyModal();};
            case'world-map':require(!home||s.location==='shanmen','请前往山门');return function(){return showWorldMap();};case'return':require(!home,'当前不在下山模式');return function(){return returnFromSLG();};
            case'free':case'regenerate':var button=document.getElementById(id==='free'?'free-action-send-btn':'regenerate-btn');require(button&&!button.disabled,'原操作按钮不可用');return function(){return id==='free'?sendFreeAction():handleRegenerate();};
            default:throw new Error('未知动作');
        }}
    }
    function checked(id,args,expected,s){require(expected&&expected.workspaceId===s.workspaceId&&mediaContext.isCurrent(expected.context)&&expected.mode===s.mode&&expected.location===s.location,'游戏上下文、模式或地点已改变');require(!dispatching,'动作正在派发');require(!s.busy,'当前操作尚未结束');require(!mediaContext.pendingChoice(),'请先在原界面处理支线抉择');require(!(typeof presentationHost!=='undefined'&&presentationHost.hasOverlay()),'请先关闭当前弹窗');
        if(!['skills','inventory','equipment','skill-equipment','settings','config','stats','relationships','saves','history','logs','bounty','trade'].includes(id)&&typeof speechService!=='undefined'){
            var reason=speechService.progressReason();require(!reason,reason);
        }
        var eventAction=['event-option','battle-start','battle-flee'].includes(id);if(!eventAction&&id!=='regenerate'){require(!currentRandomEvent&&!currentBattleEvent,'请先处理当前事件');require(s.inputEnabled,'当前不能行动');}return route(id,args,s);}
    function preflight(id,args,expected){var s=getState();try{checked(id,args,expected,s);return{ok:true,reason:'',state:s};}catch(error){return{ok:false,reason:error.message,state:s};}}
    function run(id,args,expected){var invoke=checked(id,args,expected,getState());dispatching=true;try{return Promise.resolve(invoke()).finally(function(){dispatching=false;});}catch(error){dispatching=false;throw error;}}
    return{getState:getState,describe:describe,preflight:preflight,run:run,isDispatching:function(){return dispatching;}};
})();
