/**
 * sync-utils.js - variableSystem <-> gameData 双向同步工具
 * 依赖：variable-system.js, game-state.js
 */

function syncGameDataFromVariableSystem() {
    var snapshot = variableSystem.exportSession();

    if ('userLocation' in snapshot) gameData.userLocation = snapshot.userLocation;
    if ('playerTalents' in snapshot) gameData.playerTalents = snapshot.playerTalents;
    if ('playerStats' in snapshot) gameData.playerStats = snapshot.playerStats;
    if ('combatStats' in snapshot) gameData.combatStats = snapshot.combatStats;
    if ('equipStats' in snapshot) gameData.equipStats = snapshot.equipStats;
    if ('userBackground' in snapshot) gameData.userBackground = snapshot.userBackground;
    if ('playerMood' in snapshot) gameData.playerMood = snapshot.playerMood;
    if ('martialArts' in snapshot) gameData.martialArts = snapshot.martialArts;
    if ('npcFavorability' in snapshot) gameData.npcFavorability = snapshot.npcFavorability;
    if ('weekStartFavorability' in snapshot) gameData.weekStartFavorability = snapshot.weekStartFavorability;
    if ('actionPoints' in snapshot) gameData.actionPoints = snapshot.actionPoints;
    if ('currentWeek' in snapshot) gameData.currentWeek = snapshot.currentWeek;
    if ('npcLocations' in snapshot) gameData.npcLocations = snapshot.npcLocations;
    if ('GameMode' in snapshot) gameData.GameMode = snapshot.GameMode;
    if ('difficulty' in snapshot) gameData.difficulty = snapshot.difficulty;
    if ('npcVisibility' in snapshot) gameData.npcVisibility = snapshot.npcVisibility;
    if ('npcGiftGiven' in snapshot) gameData.npcGiftGiven = snapshot.npcGiftGiven;
    if ('textFontLevel' in snapshot) gameData.textFontLevel = snapshot.textFontLevel;
    if ('npcSparred' in snapshot) gameData.npcSparred = snapshot.npcSparred;
    if ('lastFarmWeek' in snapshot) gameData.lastFarmWeek = snapshot.lastFarmWeek;
    if ('farmGrid' in snapshot) gameData.farmGrid = snapshot.farmGrid;
    if ('inventory' in snapshot) gameData.inventory = snapshot.inventory;
    if ('equipment' in snapshot) gameData.equipment = snapshot.equipment;
    if ('learnedSkills' in snapshot) gameData.learnedSkills = snapshot.learnedSkills;
    if ('equippedSkills' in snapshot) gameData.equippedSkills = snapshot.equippedSkills;
    if ('dayNightStatus' in snapshot) gameData.dayNightStatus = snapshot.dayNightStatus;
    if ('seasonStatus' in snapshot) gameData.seasonStatus = snapshot.seasonStatus;
    if ('lastUserMessage' in snapshot) gameData.lastUserMessage = snapshot.lastUserMessage;
    if ('summary_Small' in snapshot) gameData.summary_Small = snapshot.summary_Small;
    if ('summary_Week' in snapshot) gameData.summary_Week = snapshot.summary_Week;
    if ('summary_Backup' in snapshot) gameData.summary_Backup = snapshot.summary_Backup;
    if ('newWeek' in snapshot) gameData.newWeek = snapshot.newWeek;
    if ('randomEvent' in snapshot) gameData.randomEvent = snapshot.randomEvent;
    if ('battleEvent' in snapshot) gameData.battleEvent = snapshot.battleEvent;
    if ('companionNPC' in snapshot) gameData.companionNPC = snapshot.companionNPC;
    if ('mapLocation' in snapshot) gameData.mapLocation = snapshot.mapLocation;
    if ('cgContentEnabled' in snapshot) gameData.cgContentEnabled = snapshot.cgContentEnabled;
    if ('compressSummary' in snapshot) gameData.compressSummary = snapshot.compressSummary;
    if ('haveEvent' in snapshot) gameData.haveEvent = snapshot.haveEvent;
    if ('uiStyle' in snapshot) gameData.uiStyle = snapshot.uiStyle;
    if ('alchemyDone' in snapshot) gameData.alchemyDone = snapshot.alchemyDone;
    if ('triggeredEvents' in snapshot) gameData.triggeredEvents = snapshot.triggeredEvents;
    if ('currentSpecialEvent' in snapshot) gameData.currentSpecialEvent = snapshot.currentSpecialEvent;
    if ('inputEnable' in snapshot) gameData.inputEnable = snapshot.inputEnable;
    if ('enamor' in snapshot) gameData.enamor = snapshot.enamor;
    if ('playerName' in snapshot) gameData.playerName = snapshot.playerName;
    if ('markWeek' in snapshot) gameData.markWeek = snapshot.markWeek;

    syncVariablesFromGameData();
}

/**
 * 将当前全局 JS 变量同步到 variableSystem 的 turn scope。
 * 在 pipeline 提交阶段中，_applyParsedSideNote 之后、commitTurn 之前调用。
 * 这样 commitTurn 会把最新的全局变量值合并到 session，
 * rollbackTurn 也能从 _preCommitSnapshot 正确恢复。
 */
function syncGlobalsToTurnVars() {
    variableSystem.set('userLocation', userLocation, 'turn');
    variableSystem.set('playerTalents', playerTalents, 'turn');
    variableSystem.set('playerStats', playerStats, 'turn');
    variableSystem.set('combatStats', combatStats, 'turn');
    variableSystem.set('equipStats', equipStats, 'turn');
    variableSystem.set('userBackground', userBackground, 'turn');
    variableSystem.set('playerMood', playerMood, 'turn');
    variableSystem.set('martialArts', martialArts, 'turn');
    variableSystem.set('npcFavorability', npcFavorability, 'turn');
    variableSystem.set('weekStartFavorability', weekStartFavorability, 'turn');
    variableSystem.set('actionPoints', actionPoints, 'turn');
    variableSystem.set('currentWeek', currentWeek, 'turn');
    variableSystem.set('npcLocations', currentNpcLocations, 'turn');
    variableSystem.set('GameMode', GameMode, 'turn');
    variableSystem.set('difficulty', difficulty, 'turn');
    variableSystem.set('npcVisibility', npcVisibility, 'turn');
    variableSystem.set('npcGiftGiven', npcGiftGiven, 'turn');
    variableSystem.set('textFontLevel', textFontLevel, 'turn');
    variableSystem.set('npcSparred', npcSparred, 'turn');
    variableSystem.set('lastFarmWeek', lastFarmWeek, 'turn');
    variableSystem.set('farmGrid', farmGrid, 'turn');
    variableSystem.set('inventory', inventory, 'turn');
    variableSystem.set('equipment', equipment, 'turn');
    variableSystem.set('learnedSkills', learnedSkills, 'turn');
    variableSystem.set('equippedSkills', equippedSkills, 'turn');
    variableSystem.set('dayNightStatus', dayNightStatus, 'turn');
    variableSystem.set('seasonStatus', seasonStatus, 'turn');
    variableSystem.set('lastUserMessage', lastUserMessage, 'turn');
    variableSystem.set('summary_Small', summary_Small, 'turn');
    variableSystem.set('summary_Week', summary_Week, 'turn');
    variableSystem.set('summary_Backup', summary_Backup, 'turn');
    variableSystem.set('newWeek', newWeek, 'turn');
    variableSystem.set('randomEvent', randomEvent, 'turn');
    variableSystem.set('battleEvent', battleEvent, 'turn');
    variableSystem.set('companionNPC', companionNPC, 'turn');
    variableSystem.set('mapLocation', mapLocation, 'turn');
    variableSystem.set('cgContentEnabled', cgContentEnabled, 'turn');
    variableSystem.set('compressSummary', compressSummary, 'turn');
    variableSystem.set('haveEvent', haveEvent, 'turn');
    variableSystem.set('uiStyle', uiStyle, 'turn');
    variableSystem.set('alchemyDone', alchemyDone, 'turn');
    variableSystem.set('triggeredEvents', triggeredEvents, 'turn');
    variableSystem.set('currentSpecialEvent', currentSpecialEvent, 'turn');
    variableSystem.set('inputEnable', inputEnable, 'turn');
    variableSystem.set('enamor', enamor, 'turn');
    variableSystem.set('playerName', playerName, 'turn');
    variableSystem.set('markWeek', markWeek, 'turn');
}

function hydrateVariableSystemFromGameData(data) {
    variableSystem.init(data || gameData);
}
