(function installSkillBatchPresetHelper() {
    if (window.skillBatchPresetHelper) {
        console.log('[SkillBatchPreset] helper already installed');
        return window.skillBatchPresetHelper;
    }

    const BATCHES = {
        A: [
            'beng_ji_xiao_dian_le',
            'xiao_li_fei_dao',
            'kai_shan_jiu_shi',
            'bing_chuan_dian_xue_shou',
            'ling_hu_lian_zhan',
            'lian_yu_chan_si',
            'bai_cao_xin_jing'
        ],
        B: [
            'bin_xin_jue',
            'rou_zhan_gu_duan',
            'tie_bu_shan',
            'yuan_bi_quan',
            'wan_juan_gui_zong'
        ],
        C: [
            'gui_yi_jian_jue',
            'wu_jian_zhen_yi',
            'tian_xiang_shi_jing',
            'zao_hua_du_e_zhen'
        ]
    };

    const DEFAULTS = {
        money: 999999,
        reputation: 200,
        targetSkillLevel: 5,
        minKnowledgeForTesting: 300,
        fallbackFavorability: 100,
        fallbackWuxue: 200,
        fallbackXueshi: 300
    };

    function ensureEnvironment() {
        const missing = [];

        if (typeof skillList === 'undefined') missing.push('skillList');
        if (typeof playerStats === 'undefined') missing.push('playerStats');
        if (typeof npcFavorability === 'undefined') missing.push('npcFavorability');
        if (typeof learnedSkills === 'undefined') missing.push('learnedSkills');
        if (typeof equippedSkills === 'undefined') missing.push('equippedSkills');

        if (missing.length) {
            throw new Error('当前页面缺少必要页面变量: ' + missing.join(', '));
        }

        if (typeof getSkillMemorySlots !== 'function' || typeof getUsedMemorySlots !== 'function' || typeof getMaxMemorySlots !== 'function') {
            throw new Error('技能系统工具函数未就绪，请确认当前页面是 index 主页面且技能模块已加载');
        }
    }

    function toTitleBatch(batchName) {
        return String(batchName || '').trim().toUpperCase();
    }

    function getBatchSkillIds(batchName) {
        const normalized = toTitleBatch(batchName);
        const ids = BATCHES[normalized];
        if (!ids) {
            throw new Error('未知批次: ' + batchName + '，可用批次为 A / B / C');
        }
        return ids.slice();
    }

    function getSkillName(skillId) {
        return skillList?.[skillId]?.name || skillId;
    }

    function collectRequirementPlan() {
        const plan = {
            playerStats: {},
            npcFavorability: {}
        };

        for (const skill of Object.values(skillList || {})) {
            for (const levelData of skill.levels || []) {
                for (const [path, condition] of Object.entries(levelData.requires || {})) {
                    if (!condition || typeof condition !== 'object' || !Object.prototype.hasOwnProperty.call(condition, 'min')) {
                        continue;
                    }

                    if (path.startsWith('playerStats.')) {
                        const statName = path.split('.')[1];
                        plan.playerStats[statName] = Math.max(plan.playerStats[statName] || 0, Number(condition.min) || 0);
                    }

                    if (path.startsWith('npcFavorability.')) {
                        const npcId = path.split('.')[1];
                        plan.npcFavorability[npcId] = Math.max(plan.npcFavorability[npcId] || 0, Number(condition.min) || 0);
                    }
                }
            }
        }

        plan.playerStats.学识 = Math.max(plan.playerStats.学识 || 0, DEFAULTS.minKnowledgeForTesting);
        plan.playerStats.武学 = Math.max(plan.playerStats.武学 || 0, DEFAULTS.fallbackWuxue);
        plan.playerStats.金钱 = Math.max(plan.playerStats.金钱 || 0, DEFAULTS.money);
        plan.playerStats.声望 = Math.max(plan.playerStats.声望 || 0, DEFAULTS.reputation);

        return plan;
    }

    function ensureFavorabilityKeys(plan) {
        const npcIds = new Set([
            ...Object.keys(npcFavorability || {}),
            ...Object.keys(weekStartFavorability || {}),
            ...Object.keys(plan.npcFavorability || {})
        ]);

        for (const npcId of npcIds) {
            if (!Object.prototype.hasOwnProperty.call(npcFavorability, npcId)) {
                npcFavorability[npcId] = 0;
            }
            if (typeof weekStartFavorability !== 'undefined' && !Object.prototype.hasOwnProperty.call(weekStartFavorability, npcId)) {
                weekStartFavorability[npcId] = 0;
            }
        }
    }

    function applyTestPreset(options = {}) {
        ensureEnvironment();
        const plan = collectRequirementPlan();
        ensureFavorabilityKeys(plan);

        const targetKnowledge = Math.max(
            Number(options.knowledge) || 0,
            plan.playerStats.学识 || DEFAULTS.fallbackXueshi,
            DEFAULTS.minKnowledgeForTesting
        );
        const targetWuxue = Math.max(Number(options.wuxue) || 0, plan.playerStats.武学 || DEFAULTS.fallbackWuxue);
        const targetMoney = Math.max(Number(options.money) || 0, plan.playerStats.金钱 || DEFAULTS.money);
        const targetReputation = Math.max(Number(options.reputation) || 0, plan.playerStats.声望 || DEFAULTS.reputation);
        const fallbackFavorability = Math.max(Number(options.favorability) || 0, DEFAULTS.fallbackFavorability);

        playerStats.学识 = targetKnowledge;
        playerStats.武学 = targetWuxue;
        playerStats.金钱 = targetMoney;
        playerStats.声望 = targetReputation;

        for (const [npcId, requiredValue] of Object.entries(plan.npcFavorability)) {
            const targetFavorability = Math.max(requiredValue, fallbackFavorability);
            npcFavorability[npcId] = targetFavorability;
            if (typeof weekStartFavorability !== 'undefined') {
                weekStartFavorability[npcId] = targetFavorability;
            }
        }

        if (typeof checkAllValueRanges === 'function') {
            checkAllValueRanges();
        }

        return {
            playerStats: {
                学识: playerStats.学识,
                武学: playerStats.武学,
                金钱: playerStats.金钱,
                声望: playerStats.声望
            },
            npcFavorability: Object.fromEntries(Object.keys(plan.npcFavorability).sort().map(npcId => [npcId, npcFavorability[npcId]]))
        };
    }

    function learnAllSkills(targetLevel = DEFAULTS.targetSkillLevel) {
        ensureEnvironment();
        const learned = [];

        for (const [skillId, skill] of Object.entries(skillList || {})) {
            const finalLevel = Math.min(Number(targetLevel) || DEFAULTS.targetSkillLevel, Array.isArray(skill.levels) ? skill.levels.length : 0);
            learnedSkills[skillId] = finalLevel;
            learned.push({
                id: skillId,
                name: skill.name,
                level: finalLevel
            });
        }

        return learned;
    }

    function unequipAllSkills() {
        ensureEnvironment();
        for (const skillId of Object.keys(equippedSkills || {})) {
            delete equippedSkills[skillId];
        }
    }

    function equipBatch(batchName) {
        ensureEnvironment();
        const normalized = toTitleBatch(batchName);
        const skillIds = getBatchSkillIds(normalized);

        unequipAllSkills();

        let usedMemory = 0;
        for (const skillId of skillIds) {
            const learnedLevel = Number(learnedSkills?.[skillId] || 0);
            if (!learnedLevel) {
                throw new Error('技能尚未学会，无法装备: ' + getSkillName(skillId));
            }

            const memoryCost = getSkillMemorySlots(skillId);
            usedMemory += memoryCost;
            equippedSkills[skillId] = learnedLevel;
        }

        const maxMemory = getMaxMemorySlots();
        if (usedMemory > maxMemory) {
            throw new Error('批次 ' + normalized + ' 超出记忆点上限: ' + usedMemory + '/' + maxMemory);
        }

        return buildSummary(normalized);
    }

    function refreshViews() {
        if (typeof checkAllValueRanges === 'function') {
            checkAllValueRanges();
        }
        if (typeof updateAllDisplays === 'function') {
            updateAllDisplays();
        }
        if (typeof renderSkillLibrary === 'function' && document.getElementById('skill-library-modal')?.style.display === 'block') {
            renderSkillLibrary();
        }
        if (typeof renderSkillEquipment === 'function' && document.getElementById('skill-equipment-modal')?.style.display === 'block') {
            renderSkillEquipment();
        }
    }

    async function persist() {
        if (typeof saveGameData === 'function') {
            await saveGameData();
        }
    }

    function buildSummary(batchName) {
        const equippedIds = batchName ? getBatchSkillIds(batchName) : Object.keys(equippedSkills || {});
        return {
            batch: batchName || null,
            playerStats: {
                学识: playerStats.学识,
                武学: playerStats.武学,
                金钱: playerStats.金钱,
                声望: playerStats.声望
            },
            memory: {
                used: getUsedMemorySlots(),
                max: getMaxMemorySlots()
            },
            learnedSkillCount: Object.keys(learnedSkills || {}).length,
            equippedSkills: equippedIds
                .filter(skillId => equippedSkills?.[skillId])
                .map(skillId => ({
                    id: skillId,
                    name: getSkillName(skillId),
                    level: equippedSkills[skillId],
                    memory: getSkillMemorySlots(skillId)
                }))
        };
    }

    async function setupBatch(batchName, options = {}) {
        const normalized = toTitleBatch(batchName);
        const preset = applyTestPreset(options);
        learnAllSkills(options.targetSkillLevel);
        const summary = equipBatch(normalized);

        refreshViews();
        await persist();

        const result = {
            action: 'setupBatch',
            batch: normalized,
            preset,
            summary
        };

        console.group('[SkillBatchPreset] batch ' + normalized + ' ready');
        console.table(summary.equippedSkills);
        console.log(result);
        console.groupEnd();
        return result;
    }

    async function unlockAll(options = {}) {
        const preset = applyTestPreset(options);
        const learned = learnAllSkills(options.targetSkillLevel);

        refreshViews();
        await persist();

        const result = {
            action: 'unlockAll',
            preset,
            learnedCount: learned.length,
            summary: buildSummary()
        };

        console.group('[SkillBatchPreset] all skills unlocked');
        console.log(result);
        console.groupEnd();
        return result;
    }

    async function switchBatch(batchName) {
        const normalized = toTitleBatch(batchName);
        const summary = equipBatch(normalized);

        refreshViews();
        await persist();

        const result = {
            action: 'switchBatch',
            batch: normalized,
            summary
        };

        console.group('[SkillBatchPreset] switched to batch ' + normalized);
        console.table(summary.equippedSkills);
        console.log(result);
        console.groupEnd();
        return result;
    }

    function printBatchPlan() {
        const rows = Object.entries(BATCHES).map(([batchName, skillIds]) => ({
            batch: batchName,
            skills: skillIds.map(getSkillName).join(' + '),
            memory: skillIds.reduce((sum, skillId) => sum + getSkillMemorySlots(skillId), 0)
        }));
        console.group('[SkillBatchPreset] batch plan');
        console.table(rows);
        console.groupEnd();
        return rows;
    }

    function help() {
        console.log('skillBatchPresetHelper 用法:');
        console.log('1. skillBatchPresetHelper.printBatchPlan()');
        console.log('2. await skillBatchPresetHelper.unlockAll()  // 一键改属性+好感+全技能Lv5，不装备批次');
        console.log('3. await skillBatchPresetHelper.setupBatch("A")  // 一键改属性+全技能Lv5+装备A批');
        console.log('4. await skillBatchPresetHelper.setupBatch("B")  // 一键改属性+全技能Lv5+装备B批');
        console.log('5. await skillBatchPresetHelper.setupBatch("C")  // 一键改属性+全技能Lv5+装备C批');
        console.log('6. await skillBatchPresetHelper.switchBatch("A") // 已解锁后仅切换装备批次');
        console.log('7. skillBatchPresetHelper.summary()');
        console.log('说明: 该脚本会直接覆盖当前主角属性、NPC好感、learnedSkills、equippedSkills，并立即保存。');
    }

    const helper = {
        batches: BATCHES,
        collectRequirementPlan,
        applyTestPreset,
        learnAllSkills,
        unequipAllSkills,
        equipBatch,
        refreshViews,
        persist,
        setupBatch,
        unlockAll,
        switchBatch,
        printBatchPlan,
        summary() {
            const result = buildSummary();
            console.group('[SkillBatchPreset] current summary');
            console.table(result.equippedSkills);
            console.log(result);
            console.groupEnd();
            return result;
        },
        help
    };

    window.skillBatchPresetHelper = helper;
    console.log('[SkillBatchPreset] helper ready. Run skillBatchPresetHelper.help()');
    return helper;
})();