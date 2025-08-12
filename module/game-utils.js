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

