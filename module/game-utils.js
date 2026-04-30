/**
 * game-utils.js - 工具函数库
 * 
 * 文件概述：
 * 提供游戏中常用的工具函数，包括渲染环境检测、数值计算、范围限制、模糊匹配等。
 * 这些函数被其他模块广泛使用。
 * 
 * 主要功能：
 * 1. 渲染环境检测（检测是否在SillyTavern等环境中）
 * 2. 数值范围限制和检查
 * 3. 武学等级与点数计算系统
 * 4. 模糊匹配系统（用于SLG模式文本解析）
 * 
 * 对外暴露的主要函数：
 * - isInRenderEnvironment(): 检测是否在渲染环境中（如SillyTavern）
 * - getRenderFunction(): 获取可用的渲染函数（STscript或triggerSlash）
 * - getCurrentRenderer(): 获取当前渲染器类型（xiaobaiX或otherRenderer）
 * - clampValue(value, min, max): 将数值限制在指定范围内
 * - checkAllValueRanges(): 检查并修正所有游戏数值，确保在合法范围内
 * - calculateLevelFromWuxue(wuxue): 根据武学值计算可获得的等级点数
 * - calculateWuxueForLevel(level): 计算达到某等级需要的武学值
 * - calculateRemainingPoints(): 计算剩余可分配的属性点（仅人物基础属性）
 * - levenshteinDistance(a, b): 计算两个字符串的编辑距离
 * - stringSimilarity(a, b): 计算两个字符串的相似度（0-1）
 * - fuzzyMatch(input, options, synonyms, threshold): 通用模糊匹配函数
 * - matchScene(sceneName): 模糊匹配场景名称
 * - matchEmotion(emotionName): 模糊匹配表情名称
 * - matchNPC(npcName): 模糊匹配NPC名称
 * - matchCG(cgName): 模糊匹配CG名称
 * 
 * 依赖关系：
 * - 依赖 game-config.js 中的 valueRanges、slgEmotionOptions、slgCGOptions 等
 * - 依赖全局状态变量（playerTalents, playerStats, combatStats, equipment等）
 */

// 渲染环境检测
function isInRenderEnvironment() {
    return (typeof STscript === 'function') || (typeof triggerSlash === 'function');
}

function getRenderFunction() {
    if (typeof STscript === 'function') return STscript;
    if (typeof triggerSlash === 'function') return triggerSlash;
    return null;
}

function getCurrentRenderer() {
    if (window.apiService) return 'standalone';
    if (window._originalRenderer && window._originalRenderer.hasSTscript && !window._originalRenderer.hasTriggerSlash) {
        return 'xiaobaiX';
    } else if (window._originalRenderer && !window._originalRenderer.hasSTscript && window._originalRenderer.hasTriggerSlash) {
        return 'otherRenderer';
    } else if (window._originalRenderer && window._originalRenderer.hasSTscript && window._originalRenderer.hasTriggerSlash) {
        return 'xiaobaiX';
    }
    return 'none';
}

// 数值范围限制
function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function checkAllValueRanges() {
    if (!combatStats || typeof combatStats !== 'object') {
        combatStats = {};
    }
    if (!equipStats || typeof equipStats !== 'object') {
        equipStats = getEmptyEquipStats();
    }

    // 检查天赋属性（仅确保为数值，不做范围夹紧）
    for (let key in playerTalents) {
        if (typeof playerTalents[key] !== 'number') {
            const fallback = (defaultGameData && defaultGameData.playerTalents && typeof defaultGameData.playerTalents[key] === 'number')
                ? defaultGameData.playerTalents[key]
                : 0;
            playerTalents[key] = fallback;
        }
    }
    
    // 检查人物数值
    for (let key in playerStats) {
        const range = valueRanges.playerStats[key];
        playerStats[key] = clampValue(playerStats[key], range.min, range.max);
    }
    
    // 检查战斗基础数值（仅保证为合法数值，不做范围夹紧）
    for (let key in valueRanges.combatStats) {
        if (typeof combatStats[key] !== 'number') {
            const fallback = (defaultGameData && defaultGameData.combatStats && typeof defaultGameData.combatStats[key] === 'number')
                ? defaultGameData.combatStats[key]
                : 0;
            combatStats[key] = fallback;
        }
    }
    
    playerMood = clampValue(playerMood, valueRanges.playerMood.min, valueRanges.playerMood.max);
    
    for (let npcId in npcFavorability) {
        npcFavorability[npcId] = clampValue(npcFavorability[npcId], valueRanges.npcFavorability.min, valueRanges.npcFavorability.max);
    }
    
    actionPoints = clampValue(actionPoints, valueRanges.actionPoints.min, valueRanges.actionPoints.max);
    currentWeek = clampValue(currentWeek, valueRanges.currentWeek.min, valueRanges.currentWeek.max);
}

function getEmptyEquipStats() {
    return {
        "攻击力": 0,
        "生命值": 0,
        "暴击率": 0,
        "暴击伤害": 0,
        "格挡": 0,
        "穿甲": 0,
        "回转": 0,
        "吸血": 0,
        "反伤": 0,
        "根骨": 0,
        "悟性": 0,
        "心性": 0,
        "魅力": 0
    };
}

function calculateEquipStatsFromEquipment(equipmentData) {
    const totals = getEmptyEquipStats();
    if (!equipmentData) return totals;
    for (const itemName of Object.values(equipmentData)) {
        if (!itemName) continue;
        const item = item_list[itemName];
        if (!item || !item.装备属性 || typeof item.装备属性 !== 'object') continue;
        for (const [attr, value] of Object.entries(item.装备属性)) {
            if (totals.hasOwnProperty(attr)) {
                totals[attr] += Number(value) || 0;
            }
        }
    }
    return totals;
}

function refreshEquipStatsFromEquipment() {
    equipStats = calculateEquipStatsFromEquipment(equipment);
    checkAllValueRanges();
}

function getTotalCombatStats() {
    const totals = {};
    for (let key in valueRanges.combatStats) {
        const baseValue = (combatStats && typeof combatStats === 'object') ? (combatStats[key] || 0) : 0;
        const equipValue = (equipStats && typeof equipStats === 'object') ? (equipStats[key] || 0) : 0;
        const range = valueRanges.combatStats[key];
        totals[key] = clampValue(baseValue + equipValue, range.min, range.max);
    }
    return totals;
}

function getTotalTalents() {
    const totals = {
        "根骨": playerTalents.根骨 + (equipStats?.根骨 || 0),
        "悟性": playerTalents.悟性 + (equipStats?.悟性 || 0),
        "心性": playerTalents.心性 + (equipStats?.心性 || 0),
        "魅力": playerTalents.魅力 + (equipStats?.魅力 || 0)
    };

    for (let key in valueRanges.playerTalents) {
        const range = valueRanges.playerTalents[key];
        if (typeof totals[key] !== 'number') {
            totals[key] = range.min;
        }
        totals[key] = clampValue(totals[key], range.min, range.max);
    }

    return totals;
}

// 计算每周单个NPC好感度增加上限
// 公式：基础5点 + 魅力每20点增加1点上限
function getWeeklyFavorabilityLimit() {
    const totalTalents = getTotalTalents();
    return 5 + Math.floor(totalTalents.魅力 / 20);
}

// 检查并限制好感度增加值
// 返回实际可增加的值（考虑周上限）
function clampFavorabilityGain(npcId, changeValue) {
    // 只限制正向增加，下降不限制
    if (changeValue <= 0) {
        return changeValue;
    }
    
    // 计算本周已增加的好感度
    const startValue = weekStartFavorability[npcId] || 0;
    const currentValue = npcFavorability[npcId] || 0;
    const alreadyGained = currentValue - startValue;
    
    // 计算上限
    const weeklyLimit = getWeeklyFavorabilityLimit();
    
    // 计算还可以增加多少
    const remainingAllowance = weeklyLimit - alreadyGained;
    
    // 如果已达上限，不再增加
    if (remainingAllowance <= 0) {
        console.log(`[好感度上限] ${npcId} 本周已达上限(${weeklyLimit})，不再增加`);
        return 0;
    }
    
    // 如果新增值超过剩余额度，截断
    if (changeValue > remainingAllowance) {
        console.log(`[好感度上限] ${npcId} 增加被截断: ${changeValue} -> ${remainingAllowance}`);
        return remainingAllowance;
    }
    
    return changeValue;
}

// 武学等级计算
function calculateLevelFromWuxue(wuxue) {
    let totalWuxue = 0;
    let level = 0;
    
    for (let i = 1; i <= 30; i++) {
        const requiredWuxue = Math.ceil(2 + i / 2);
        if (totalWuxue + requiredWuxue <= wuxue) {
            totalWuxue += requiredWuxue;
            level = i;
        } else {
            break;
        }
    }
    
    return level;
}

function calculateWuxueForLevel(level) {
    let totalWuxue = 0;
    for (let i = 1; i <= level; i++) {
        totalWuxue += Math.ceil(2 + i / 2);
    }
    return totalWuxue;
}

function calculateMemorySlots(xueshi) {
    let totalCost = 0;
    let slots = 0;

    for (let i = 1; i <= 10; i++) {
        totalCost += 8 + 4 * i;
        if (xueshi >= totalCost) {
            slots = i;
        } else {
            break;
        }
    }

    return slots;
}

function getMaxMemorySlots() {
    return calculateMemorySlots(playerStats?.学识 || 0);
}

function getSkillMemorySlots(skillId) {
    const skill = skillList?.[skillId];
    if (!skill) return 0;

    if (typeof skill.memorySlots === 'number') {
        return Number(skill.memorySlots) || 0;
    }

    const firstLevelData = Array.isArray(skill.levels) ? skill.levels[0] : null;
    return Number(firstLevelData?.memorySlots) || 0;
}

function getUsedMemorySlots() {
    let used = 0;

    for (const skillId of Object.keys(equippedSkills || {})) {
        used += getSkillMemorySlots(skillId);
    }

    return used;
}

function getSkillLevelData(skillId, level) {
    const skill = skillList?.[skillId];
    if (!skill || !Array.isArray(skill.levels)) return null;

    const index = Number(level) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= skill.levels.length) {
        return null;
    }

    return skill.levels[index] || null;
}

function getValueByPathForSkill(path) {
    if (!path || typeof path !== 'string') return undefined;

    const parts = path.split('.');
    const rootValueMap = {
        playerTalents,
        playerStats,
        combatStats,
        equipStats,
        npcFavorability,
        weekStartFavorability,
        inventory,
        equipment,
        learnedSkills,
        equippedSkills,
        currentWeek,
        actionPoints,
        playerMood,
        GameMode,
        difficulty,
        mapLocation,
        companionNPC,
        randomEvent,
        battleEvent,
        haveEvent,
        enamor,
        inputEnable
    };

    let current = rootValueMap[parts[0]];
    if (typeof current === 'undefined') {
        return undefined;
    }

    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (current == null || typeof current !== 'object' || !(part in current)) {
            return undefined;
        }
        current = current[part];
    }

    return current;
}

function checkSkillRequirementCondition(value, condition) {
    if (!condition || typeof condition !== 'object') return true;

    if (Object.prototype.hasOwnProperty.call(condition, 'min') && !(value >= condition.min)) {
        return false;
    }
    if (Object.prototype.hasOwnProperty.call(condition, 'max') && !(value <= condition.max)) {
        return false;
    }
    if (Object.prototype.hasOwnProperty.call(condition, 'equals') && value !== condition.equals) {
        return false;
    }
    if (Array.isArray(condition.in) && !condition.in.includes(value)) {
        return false;
    }

    return true;
}

function checkSkillRequirements(skillId, level) {
    const levelData = getSkillLevelData(skillId, level);
    if (!levelData) {
        return { ok: false, failed: ['技能等级数据不存在'] };
    }

    const failed = [];
    const requires = levelData.requires || {};

    for (const [path, condition] of Object.entries(requires)) {
        const value = getValueByPathForSkill(path);
        if (!checkSkillRequirementCondition(value, condition)) {
            failed.push(path);
        }
    }

    return {
        ok: failed.length === 0,
        failed
    };
}

// ==================== 模糊匹配系统 ====================

/**
 * 计算两个字符串的编辑距离（Levenshtein Distance）
 * @param {string} a 字符串A
 * @param {string} b 字符串B
 * @returns {number} 编辑距离
 */
function levenshteinDistance(a, b) {
    if (!a || !b) return Math.max((a || '').length, (b || '').length);
    if (a === b) return 0;
    
    const matrix = [];
    const aLen = a.length;
    const bLen = b.length;
    
    // 初始化矩阵
    for (let i = 0; i <= bLen; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= aLen; j++) {
        matrix[0][j] = j;
    }
    
    // 填充矩阵
    for (let i = 1; i <= bLen; i++) {
        for (let j = 1; j <= aLen; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // 替换
                    matrix[i][j - 1] + 1,     // 插入
                    matrix[i - 1][j] + 1      // 删除
                );
            }
        }
    }
    
    return matrix[bLen][aLen];
}

/**
 * 计算字符串相似度（0-1之间，1为完全相同）
 * @param {string} a 字符串A
 * @param {string} b 字符串B
 * @returns {number} 相似度
 */
function stringSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    
    const distance = levenshteinDistance(a, b);
    return 1 - distance / maxLen;
}

/**
 * 模糊匹配函数 - 在候选列表中找到最接近的匹配项
 * @param {string} input 输入的字符串（如LLM输出的场景名）
 * @param {string[]} options 候选选项列表
 * @param {Object} synonyms 同义词映射表（可选）
 * @param {number} threshold 相似度阈值（默认0.5）
 * @returns {string|null} 匹配到的选项，或null
 */
function fuzzyMatch(input, options, synonyms = {}, threshold = 0.5) {
    if (!input || typeof input !== 'string') return null;
    
    const normalizedInput = input.trim();
    if (!normalizedInput) return null;
    
    // 1. 精确匹配
    if (options.includes(normalizedInput)) {
        return normalizedInput;
    }
    
    // 2. 同义词精确匹配
    if (synonyms[normalizedInput]) {
        const synonym = synonyms[normalizedInput];
        if (options.includes(synonym)) {
            console.log(`[FuzzyMatch] 同义词匹配: "${normalizedInput}" -> "${synonym}"`);
            return synonym;
        }
    }
    
    // 3. 包含匹配（输入包含选项，或选项包含输入）
    for (const option of options) {
        if (normalizedInput.includes(option) || option.includes(normalizedInput)) {
            console.log(`[FuzzyMatch] 包含匹配: "${normalizedInput}" -> "${option}"`);
            return option;
        }
    }
    
    // 4. 同义词的包含匹配
    for (const [key, value] of Object.entries(synonyms)) {
        if (normalizedInput.includes(key) || key.includes(normalizedInput)) {
            if (options.includes(value)) {
                console.log(`[FuzzyMatch] 同义词包含匹配: "${normalizedInput}" (via "${key}") -> "${value}"`);
                return value;
            }
        }
    }
    
    // 5. 编辑距离匹配
    let bestMatch = null;
    let bestSimilarity = 0;
    
    // 对原始选项计算相似度
    for (const option of options) {
        const similarity = stringSimilarity(normalizedInput, option);
        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = option;
        }
    }
    
    // 对同义词键也计算相似度
    for (const [key, value] of Object.entries(synonyms)) {
        if (!options.includes(value)) continue;
        
        const similarity = stringSimilarity(normalizedInput, key);
        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = value;
        }
    }
    
    if (bestSimilarity >= threshold && bestMatch) {
        console.log(`[FuzzyMatch] 相似度匹配: "${normalizedInput}" -> "${bestMatch}" (相似度: ${(bestSimilarity * 100).toFixed(1)}%)`);
        return bestMatch;
    }
    
    console.log(`[FuzzyMatch] 未找到匹配: "${normalizedInput}" (最佳相似度: ${(bestSimilarity * 100).toFixed(1)}%)`);
    return null;
}

/**
 * 匹配场景名称
 * @param {string} sceneName LLM输出的场景名
 * @returns {string} 匹配后的标准场景名，或 'none'
 */
function matchScene(sceneName) {
    if (!sceneName || sceneName === 'none' || sceneName === '无') return 'none';
    
    const result = fuzzyMatch(
        sceneName,
        slgSceneOptions,
        typeof slgSceneSynonyms !== 'undefined' ? slgSceneSynonyms : {},
        0.4  // 场景匹配阈值稍低一些，更宽容
    );
    
    // 关键词兜底：当所有匹配方式都失败时，检查是否包含语义关键词
    if (!result && typeof sceneSemanticKeywords !== 'undefined') {
        for (const [keyword, defaultScene] of Object.entries(sceneSemanticKeywords)) {
            if (sceneName.includes(keyword)) {
                console.log(`[matchScene] 关键词兜底: "${sceneName}" (含"${keyword}") -> "${defaultScene}"`);
                return defaultScene;
            }
        }
    }
    
    return result || 'none';
}

/**
 * 匹配表情名称
 * @param {string} emotionName LLM输出的表情名
 * @returns {string} 匹配后的标准表情名，或 'none'
 */
function matchEmotion(emotionName) {
    if (!emotionName || emotionName === 'none' || emotionName === '无') return 'none';
    
    // 先检查是否为特殊CG格式
    if (/^特殊CG\d+$/.test(emotionName)) {
        return emotionName;
    }
    
    const result = fuzzyMatch(
        emotionName,
        slgEmotionOptions,
        typeof slgEmotionSynonyms !== 'undefined' ? slgEmotionSynonyms : {},
        0.5
    );
    
    // 关键词兜底：当所有匹配方式都失败时，检查是否包含语义关键词
    if (!result && typeof emotionSemanticKeywords !== 'undefined') {
        for (const [keyword, defaultEmotion] of Object.entries(emotionSemanticKeywords)) {
            if (emotionName.includes(keyword)) {
                console.log(`[matchEmotion] 关键词兜底: "${emotionName}" (含"${keyword}") -> "${defaultEmotion}"`);
                return defaultEmotion;
            }
        }
    }
    
    return result || 'none';
}

/**
 * 匹配NPC名称
 * @param {string} npcName LLM输出的NPC名
 * @returns {string} 匹配后的标准NPC名，或 'none'
 */
function matchNPC(npcName) {
    if (!npcName || npcName === 'none' || npcName === '无') return 'none';
    
    const normalizedName = npcName.trim();
    
    // 1. 精确匹配名字
    if (npcNameToId[normalizedName]) {
        return normalizedName;
    }
    
    // 2. 精确匹配ID
    if (npcs[normalizedName]) {
        return npcs[normalizedName].name;
    }
    
    // 3. 包含匹配
    const npcNames = Object.keys(npcNameToId);
    for (const name of npcNames) {
        if (normalizedName.includes(name) || name.includes(normalizedName)) {
            console.log(`[FuzzyMatch] NPC包含匹配: "${normalizedName}" -> "${name}"`);
            return name;
        }
    }
    
    // 4. 编辑距离匹配
    let bestMatch = null;
    let bestSimilarity = 0;
    
    for (const name of npcNames) {
        const similarity = stringSimilarity(normalizedName, name);
        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = name;
        }
    }
    
    if (bestSimilarity >= 0.6 && bestMatch) {
        console.log(`[FuzzyMatch] NPC相似度匹配: "${normalizedName}" -> "${bestMatch}" (相似度: ${(bestSimilarity * 100).toFixed(1)}%)`);
        return bestMatch;
    }
    
    return 'none';
}

/**
 * 匹配CG类型
 * @param {string} cgName LLM输出的CG名
 * @returns {string} 匹配后的标准CG名，或 'none'
 */
function matchCG(cgName) {
    if (!cgName || cgName === 'none' || cgName === '无') return 'none';
    
    const normalizedCG = cgName.trim();
    
    // 精确匹配
    if (slgCGOptions.includes(normalizedCG)) {
        return normalizedCG;
    }
    
    // 包含匹配
    for (const option of slgCGOptions) {
        if (option === 'none') continue;
        if (normalizedCG.includes(option) || option.includes(normalizedCG)) {
            console.log(`[FuzzyMatch] CG包含匹配: "${normalizedCG}" -> "${option}"`);
            return option;
        }
    }
    
    return 'none';
}

// ==================== 武学等级计算 ====================

function calculateRemainingPoints() {
    const earnedLevels = calculateLevelFromWuxue(playerStats.武学);

    // 基于人物基础战斗属性计算已使用的点数（不含装备）
    const usedForAttack = (combatStats.攻击力 - 20) / 10;
    const usedForHP = (combatStats.生命值 - 50) / 25;
    const usedForCritRate = (combatStats.暴击率 - 10) / 15;
    const usedForCritDamage = (combatStats.暴击伤害 - 150) / 20;
    const usedForBlock = (combatStats.格挡 - 0) / 10;
    const usedForArmorPen = (combatStats.穿甲 - 0) / 10;
    const usedForLifesteal = (combatStats.吸血 - 0) / 15;
    const usedForThorns = (combatStats.反伤 - 0) / 15;
    const usedForTurnover = (combatStats.回转 - 0) / 0.1;
    const totalUsed = usedForAttack + usedForHP + usedForCritRate + usedForCritDamage + usedForBlock + usedForArmorPen + usedForLifesteal + usedForThorns + usedForTurnover;
    const remaining = earnedLevels - totalUsed;
    const integerRemaining = Math.round(remaining);
    
    return Math.max(0, integerRemaining);
}

