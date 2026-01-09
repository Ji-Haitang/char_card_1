/**
 * game-utils.js - 工具函数库
 * 
 * 文件概述：
 * 提供游戏中常用的工具函数，包括渲染环境检测、数值计算、范围限制等。
 * 这些函数被其他模块广泛使用。
 * 
 * 主要功能：
 * 1. 渲染环境检测（检测是否在SillyTavern等环境中）
 * 2. 数值范围限制和检查
 * 3. 武学等级与点数计算系统
 * 
 * 对外暴露的主要函数：
 * - isInRenderEnvironment(): 检测是否在渲染环境中（如SillyTavern）
 * - getRenderFunction(): 获取可用的渲染函数（STscript或triggerSlash）
 * - getCurrentRenderer(): 获取当前渲染器类型（xiaobaiX或otherRenderer）
 * - clampValue(value, min, max): 将数值限制在指定范围内
 * - checkAllValueRanges(): 检查并修正所有游戏数值，确保在合法范围内
 * - calculateLevelFromWuxue(wuxue): 根据武学值计算可获得的等级点数
 * - calculateWuxueForLevel(level): 计算达到某等级需要的武学值
 * - calculateRemainingPoints(): 计算剩余可分配的属性点
 * 
 * 依赖关系：
 * - 依赖 game-config.js 中的 valueRanges
 * - 依赖全局状态变量（playerTalents, playerStats等）
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
    if (window._originalRenderer.hasSTscript && !window._originalRenderer.hasTriggerSlash) {
        return 'xiaobaiX';
    } else if (!window._originalRenderer.hasSTscript && window._originalRenderer.hasTriggerSlash) {
        return 'otherRenderer';
    } else if (window._originalRenderer.hasSTscript && window._originalRenderer.hasTriggerSlash) {
        return 'xiaobaiX';
    }
    return 'none';
}

// 数值范围限制
function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function checkAllValueRanges() {
    // 检查天赋属性
    for (let key in playerTalents) {
        const range = valueRanges.playerTalents[key];
        playerTalents[key] = clampValue(playerTalents[key], range.min, range.max);
    }
    
    // 检查人物数值
    for (let key in playerStats) {
        const range = valueRanges.playerStats[key];
        playerStats[key] = clampValue(playerStats[key], range.min, range.max);
    }
    
    // 检查战斗数值
    for (let key in combatStats) {
        const range = valueRanges.combatStats[key];
        combatStats[key] = clampValue(combatStats[key], range.min, range.max);
    }
    
    playerMood = clampValue(playerMood, valueRanges.playerMood.min, valueRanges.playerMood.max);
    
    for (let npcId in npcFavorability) {
        npcFavorability[npcId] = clampValue(npcFavorability[npcId], valueRanges.npcFavorability.min, valueRanges.npcFavorability.max);
    }
    
    actionPoints = clampValue(actionPoints, valueRanges.actionPoints.min, valueRanges.actionPoints.max);
    currentWeek = clampValue(currentWeek, valueRanges.currentWeek.min, valueRanges.currentWeek.max);
}

// 武学等级计算
function calculateLevelFromWuxue(wuxue) {
    let totalWuxue = 0;
    let level = 0;
    
    for (let i = 1; i <= 20; i++) {
        const requiredWuxue = 4 + i;
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
        totalWuxue += (4 + i);
    }
    return totalWuxue;
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
    
    // 计算装备的总加成
    let equipmentAttackBonus = 0;
    let equipmentHPBonus = 0;
    
    // 遍历所有装备
    for (const [slot, itemName] of Object.entries(equipment)) {
        if (itemName && item_list[itemName]) {
            const item = item_list[itemName];
            if (item.装备属性 === '攻击力') {
                equipmentAttackBonus += item.装备数值;
            } else if (item.装备属性 === '生命值') {
                equipmentHPBonus += item.装备数值;
            }
        }
    }
    
    // 计算基础数值（排除装备加成）
    const baseAttack = combatStats.攻击力 - equipmentAttackBonus;
    const baseHP = combatStats.生命值 - equipmentHPBonus;
    
    // 基于基础数值计算已使用的点数
    const usedForAttack = (baseAttack - 20) / 10;
    const usedForHP = (baseHP - 50) / 25;
    const totalUsed = usedForAttack + usedForHP;
    
    return Math.max(0, earnedLevels - totalUsed);
}

