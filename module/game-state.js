/**
 * game-state.js - 游戏状态管理
 * 
 * 文件概述：
 * 管理游戏的所有运行时状态，包括玩家属性、NPC状态、游戏进度等。
 * 提供状态的读取、保存和同步功能，支持SillyTavern变量存储。
 * 
 * 主要功能：
 * 1. 定义和管理所有游戏状态变量
 * 2. 提供游戏数据的持久化存储（通过SillyTavern变量）
 * 3. 同步游戏数据对象与独立变量
 * 
 * 对外暴露的主要变量：
 * - gameData: 完整的游戏数据对象
 * - userLocation: 用户当前位置
 * - playerTalents: 玩家天赋属性（根骨、悟性、心性、魅力）
 * - playerStats: 玩家数值（武学、学识、声望、金钱）
 * - combatStats: 战斗数值（攻击力、生命值）
 * - playerMood: 玩家心情值
 * - martialArts: 已学武功列表
 * - npcFavorability: NPC好感度
 * - actionPoints: 当前行动点
 * - currentWeek: 当前周数
 * - currentNpcLocations: NPC当前位置
 * - 各种临时状态变量（currentInteractionNpc等）
 * 
 * 对外暴露的主要函数：
 * - loadOrInitGameData(): 加载或初始化游戏数据
 * - saveGameData(): 保存游戏数据到SillyTavern变量
 * - syncVariablesFromGameData(): 从gameData同步到独立变量
 * - syncGameDataFromVariables(): 从独立变量同步到gameData
 * 
 * 依赖关系：
 * - 依赖 game-config.js 中的 defaultGameData
 * - 依赖 game-utils.js 中的渲染环境检测函数
 */

// 游戏数据
let gameData = structuredClone(defaultGameData);
let currentNpcLocations = {};

// 游戏状态变量
let userLocation = "houshan";
let playerTalents = { "根骨": 25, "悟性": 25, "心性": 25, "魅力": 25 };
let playerStats = { "武学": 20, "学识": 20, "声望": 20, "金钱": 500 };
let combatStats = { "攻击力": 20, "生命值": 50 };
let playerMood = 100;
let martialArts = {
    "太白仙迹": 0, "岱宗如何": 0, "掠风窃尘": 0, "流云飞袖": 0,
    "惊鸿照影": 0, "踏雪无痕": 0, "醉卧沙场": 0, "万剑归宗": 0
};
let npcFavorability = { "A": 0,"B": 0,"C": 0,"D": 0,"E": 0,"F": 0,"G": 0,"H":0,"I":0,"J":0,"K":0,"L":0 };
let actionPoints = 3;
let currentWeek = 1;
let GameMode = 0;  // 新增：游戏模式变量
let npcVisibility = { "A": true,"B": true,"C": true,"D": true,"E": true,"F": true,"G": true,"H": true,"I": true,"J": true,"K": true,"L": true};
let npcGiftGiven = { "A": false,"B": false,"C": false,"D": false,"E": false,"F": false,"G": false,"H": false,"I": false,"J": false,"K": false,"L": false};
let npcSparred = { "A": false,"B": false,"C": false,"D": false,"E": false,"F": false,"G": false,"H": false,"I": false,"J": false,"K": false,"L": false};

// 独立的NPC位置变量
let npcLocationA = "none";
let npcLocationB = "yishiting";
let npcLocationC = "yishiting";
let npcLocationD = "shanmen";
let npcLocationE = "nvdizi";
let npcLocationF = "cangjingge";
let npcLocationG = "yanwuchang";
let npcLocationH = "houshan";
let npcLocationI = "huofang";
let npcLocationJ = "tiejiangpu";
let npcLocationK = "nvdizi";
let npcLocationL = "none";

// 临时状态变量
let currentInteractionNpc = null;
let currentInteractionLocation = null;
let currentRandomEvent = null;
let currentBattleEvent = null;
let currentBattleType = null;
let currentBattleReward = null;
let currentBattleNpcName = null;
let currentStoryText = "";
let previousScene = 'map';  // 记录进入属性/关系界面前的场景
let wasInSLGMode = false;   // 记录是否从SLG模式进入
let currentBattleNpcId = null;  // 记录当前战斗的NPC ID
// let storyPages = [];  // 存储分页后的文本
// let currentPage = 0;  // 当前页码
// let isStoryExpanded = false;  // 是否展开显示全文

// 流式版本的本地状态
let localState = {
    turnUpdateApplied: false
};

// 重置流式状态
function resetLocalState() {
    localState.turnUpdateApplied = false;
}

// 获取流式状态
function getLocalState() {
    return localState;
}

// 修改 syncVariablesFromGameData 函数
function syncVariablesFromGameData() {
    ({ userLocation,
    playerTalents,
    playerStats,
    combatStats,
    playerMood,
    martialArts,
    npcFavorability,
    actionPoints,
    currentWeek,
    npcLocations: currentNpcLocations,
    GameMode,
    npcVisibility,
    npcGiftGiven,
    npcSparred } = gameData);  // 添加新变量

    npcLocationA = currentNpcLocations.A;
    npcLocationB = currentNpcLocations.B;
    npcLocationC = currentNpcLocations.C;
    npcLocationD = currentNpcLocations.D;
    npcLocationE = currentNpcLocations.E;
    npcLocationF = currentNpcLocations.F;
    npcLocationG = currentNpcLocations.G;
    npcLocationH = currentNpcLocations.H;
    npcLocationI = currentNpcLocations.I;
    npcLocationJ = currentNpcLocations.J;
    npcLocationK = currentNpcLocations.K;
    npcLocationL = currentNpcLocations.L;
}

// 修改 syncGameDataFromVariables 函数
function syncGameDataFromVariables() {
    gameData.userLocation = userLocation;
    gameData.playerTalents = playerTalents;
    gameData.playerStats = playerStats;
    gameData.combatStats = combatStats;
    gameData.playerMood = playerMood;
    gameData.martialArts = martialArts;
    gameData.npcFavorability = npcFavorability;
    gameData.actionPoints = actionPoints;
    gameData.currentWeek = currentWeek;
    gameData.npcLocations = currentNpcLocations;
    gameData.GameMode = GameMode;
    gameData.npcVisibility = npcVisibility;
    gameData.npcGiftGiven = npcGiftGiven;
    gameData.npcSparred = npcSparred;    // 添加npcSparred
}

// 深度合并函数
function mergeWithDefaults(loadedData, defaultData) {
    // 如果加载的数据是null或undefined，直接返回默认数据
    if (loadedData === null || loadedData === undefined) {
        return structuredClone(defaultData);
    }
    // 如果默认数据不是对象，直接返回加载的数据
    if (typeof defaultData !== 'object' || defaultData === null || Array.isArray(defaultData)) {
        return loadedData;
    }
    // 如果加载的数据不是对象，返回默认数据
    if (typeof loadedData !== 'object' || Array.isArray(loadedData)) {
        return structuredClone(defaultData);
    }
    // 创建结果对象，先复制加载的数据
    const result = {...loadedData};
    // 遍历默认数据的所有key
    for (const key in defaultData) {
        if (defaultData.hasOwnProperty(key)) {
            if (!(key in result)) {
                // 如果key在加载的数据中不存在，添加默认值
                console.log(`版本更新：添加缺失的字段 "${key}"`);
                result[key] = structuredClone(defaultData[key]);
            } else if (typeof defaultData[key] === 'object' && 
                       defaultData[key] !== null && 
                       !Array.isArray(defaultData[key])) {
                // 如果是嵌套对象，递归合并
                result[key] = mergeWithDefaults(result[key], defaultData[key]);
            }
            // 如果key存在且不是对象，保持原值不变
        }
    }
    return result;
}
// 修改后的 loadOrInitGameData 函数
async function loadOrInitGameData() {
    const renderFunc = getRenderFunction();
    if (!renderFunc) {
        syncVariablesFromGameData();
        return;
    }
    const probe = await renderFunc('/getvar gameData');
    if (!probe) {
        await renderFunc('/setvar key=gameData ' + JSON.stringify(defaultGameData) +
                    ' | /echo ✅ 游戏数据初始化完成！');
        gameData = structuredClone(defaultGameData);
    } else {
        const renderer = getCurrentRenderer();
        let loadedData;
        if (renderer === 'xiaobaiX') {
            loadedData = probe;
        } else {
            try {
                loadedData = typeof probe === 'string' ? JSON.parse(probe) : probe;
            } catch (e) {
                console.error('JSON解析失败:', e);
                loadedData = null;
            }
        }
        // 使用mergeWithDefaults确保所有必要的字段都存在
        gameData = mergeWithDefaults(loadedData, defaultGameData);
        // 如果有字段被添加，保存更新后的数据
        if (JSON.stringify(loadedData) !== JSON.stringify(gameData)) {
            console.log('检测到版本更新，正在保存补充后的游戏数据...');
            await renderFunc('/setvar key=gameData ' + JSON.stringify(gameData));
        }
    }
    syncVariablesFromGameData();
}

async function saveGameData() {
    const renderFunc = getRenderFunction();
    if (!renderFunc) return;
    syncGameDataFromVariables();
    await renderFunc('/setvar key=gameData ' + JSON.stringify(gameData));
}
