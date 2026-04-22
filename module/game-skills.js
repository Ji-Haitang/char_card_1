/**
 * game-skills.js - 技能学习与装备界面
 *
 * 负责：
 * 1. 在藏经阁注入“技能习得”按钮
 * 2. 在属性查看下拉菜单注入“查看技能”按钮
 * 3. 动态创建技能学习/装备弹窗
 * 4. 处理技能学习、装备、卸下与界面渲染
 *
 * 依赖：
 * - skillList
 * - learnedSkills / equippedSkills / playerStats
 * - getSkillLevelData / getUsedMemorySlots / getMaxMemorySlots / checkSkillRequirements
 * - showModal / showConfirmModal / closeAllSpecialModals / fitModalToViewport / bindModalAutoFit
 * - saveGameData / updateAllDisplays / toggleDropdown
 */

let currentSkillLibraryFilter = '全部';

function initSkillUi() {
    injectSkillEntryButtons();
    ensureSkillModals();
    exposeSkillFunctions();
}

function injectSkillEntryButtons() {
    const attributeDropdown = document.getElementById('attribute-dropdown');
    if (attributeDropdown && !document.getElementById('show-skill-equipment-btn')) {
        const btn = document.createElement('button');
        btn.id = 'show-skill-equipment-btn';
        btn.className = 'dropdown-item';
        btn.textContent = '查看技能';
        btn.onclick = () => showSkillEquipment();
        attributeDropdown.appendChild(btn);
    }

    const cangjinggeScene = document.getElementById('cangjingge-scene');
    const actions = cangjinggeScene ? cangjinggeScene.querySelector('.scene-actions') : null;
    if (actions && !document.getElementById('show-skill-library-btn')) {
        const btn = document.createElement('button');
        btn.id = 'show-skill-library-btn';
        btn.className = 'scene-btn';
        btn.textContent = '技能习得';
        btn.onclick = () => showSkillLibrary();
        actions.appendChild(btn);
    }
}

function ensureSkillModals() {
    if (!document.getElementById('skill-library-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="skill-library-modal" class="modal viewport-overlay">
                <div class="modal-content skill-library-content">
                    <div class="skill-modal-header">
                        <div>
                            <h3>技能习得</h3>
                            <div class="skill-modal-subtitle">浏览功法、查看前置条件并学习新等级。</div>
                        </div>
                        <div class="skill-memory-summary" id="skill-library-memory-summary"></div>
                    </div>
                    <div class="skill-filter-row" id="skill-library-filters"></div>
                    <div class="skill-list-container" id="skill-library-list"></div>
                    <div class="modal-buttons">
                        <button class="modal-btn cancel" onclick="closeSkillLibraryModal()">关闭</button>
                    </div>
                </div>
            </div>
        `);
    }

    if (!document.getElementById('skill-equipment-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="skill-equipment-modal" class="modal viewport-overlay">
                <div class="modal-content skill-equip-content">
                    <div class="skill-modal-header">
                        <div>
                            <h3>技能管理</h3>
                            <div class="skill-modal-subtitle">调整已学技能的装备等级，受记忆点上限约束。</div>
                        </div>
                        <div class="skill-memory-summary" id="skill-equipment-memory-summary"></div>
                    </div>
                    <div class="skill-memory-bar">
                        <div class="skill-memory-fill" id="skill-memory-fill"></div>
                    </div>
                    <div class="skill-equipment-sections">
                        <div class="skill-panel">
                            <div class="skill-panel-title">已装备技能</div>
                            <div id="equipped-skill-list" class="skill-list-container compact"></div>
                        </div>
                        <div class="skill-panel">
                            <div class="skill-panel-title">已学技能</div>
                            <div id="learned-skill-list" class="skill-list-container compact"></div>
                        </div>
                    </div>
                    <div class="modal-buttons">
                        <button class="modal-btn cancel" onclick="closeSkillEquipmentModal()">关闭</button>
                    </div>
                </div>
            </div>
        `);
    }
}

function exposeSkillFunctions() {
    window.showSkillLibrary = showSkillLibrary;
    window.closeSkillLibraryModal = closeSkillLibraryModal;
    window.learnSkill = learnSkill;
    window.showSkillEquipment = showSkillEquipment;
    window.closeSkillEquipmentModal = closeSkillEquipmentModal;
    window.equipSkill = equipSkill;
    window.unequipSkill = unequipSkill;
    window.changeSkillLibraryFilter = changeSkillLibraryFilter;
}

function getSkillCategories() {
    return ['全部', '攻击', '防御', '辅助', '控制'];
}

function getSkillEntries(filter = '全部') {
    return Object.entries(skillList || {}).filter(([, skill]) => {
        return filter === '全部' || skill.category === filter;
    });
}

function getLearnedSkillLevel(skillId) {
    return Number(learnedSkills?.[skillId] || 0);
}

function getEquippedSkillLevel(skillId) {
    return Number(equippedSkills?.[skillId] || 0);
}

function getNextLearnableLevel(skillId) {
    const learnedLevel = getLearnedSkillLevel(skillId);
    const skill = skillList?.[skillId];
    if (!skill) return null;
    const nextLevel = learnedLevel + 1;
    return nextLevel <= skill.levels.length ? nextLevel : null;
}

function getSkillRequirementLabel(path) {
    const labelMap = {
        'playerStats.武学': '武学',
        'playerStats.学识': '学识',
        'playerStats.声望': '声望',
        'playerStats.金钱': '金钱',
        'playerTalents.根骨': '根骨',
        'playerTalents.悟性': '悟性',
        'playerTalents.心性': '心性',
        'playerTalents.魅力': '魅力',
        'currentWeek': '周数'
    };
    if (typeof path === 'string' && path.startsWith('npcFavorability.')) {
        const npcId = path.split('.')[1];
        const npcName = npcs?.[npcId]?.name;
        return npcName ? `${npcName}好感度` : 'NPC好感度';
    }
    return labelMap[path] || path;
}

function formatSkillRequirement(condition) {
    if (!condition || typeof condition !== 'object') return '';
    if (Object.prototype.hasOwnProperty.call(condition, 'min')) return `≥ ${condition.min}`;
    if (Object.prototype.hasOwnProperty.call(condition, 'max')) return `≤ ${condition.max}`;
    if (Object.prototype.hasOwnProperty.call(condition, 'equals')) return `= ${condition.equals}`;
    if (Array.isArray(condition.in)) return `属于 ${condition.in.join(' / ')}`;
    return '';
}

function renderRequirementList(requires, failedPaths) {
    const entries = Object.entries(requires || {});
    if (!entries.length) {
        return '<div class="skill-requirement-list"><span class="skill-requirement ok">无前置条件</span></div>';
    }

    return `
        <div class="skill-requirement-list">
            ${entries.map(([path, condition]) => {
                const failed = failedPaths.includes(path);
                return `<span class="skill-requirement ${failed ? 'failed' : 'ok'}">${getSkillRequirementLabel(path)} ${formatSkillRequirement(condition)}</span>`;
            }).join('')}
        </div>
    `;
}

function getSkillSummaryText(skillId, level) {
    const levelData = getSkillLevelData(skillId, level);
    return levelData ? levelData.effectDesc : '暂无效果说明';
}

function getSkillMemoryText(skillId) {
    return `记忆 ${getSkillMemorySlots(skillId)} 点`;
}

function buildSkillLevelDetails(skillId, learnedLevel) {
    const skill = skillList?.[skillId];
    if (!skill) return '';

    return `
        <details class="skill-level-details">
            <summary>查看等级详情</summary>
            <div class="skill-level-list">
                ${skill.levels.map((levelData, index) => {
                    const level = index + 1;
                    const stateClass = level <= learnedLevel ? 'learned' : (level === learnedLevel + 1 ? 'next' : 'locked');
                    const stateText = level <= learnedLevel ? '已学' : (level === learnedLevel + 1 ? '可学' : '未解锁');
                    const requirementCheck = checkSkillRequirements(skillId, level);
                    return `
                        <div class="skill-level-row ${stateClass}">
                            <div class="skill-level-head">
                                <span class="skill-level-name">Lv${level}</span>
                                <span class="skill-level-state">${stateText}</span>
                            </div>
                            <div class="skill-level-meta">学习费用 ${levelData.cost} 金</div>
                            <div class="skill-level-effect">${levelData.effectDesc}</div>
                            ${renderRequirementList(levelData.requires, requirementCheck.failed)}
                        </div>
                    `;
                }).join('')}
            </div>
        </details>
    `;
}

function updateSkillModalPosition(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'block';
    requestAnimationFrame(() => {
        fitModalToViewport(modal);
        bindModalAutoFit(modal);
    });
}

function renderSkillLibrary() {
    const summary = document.getElementById('skill-library-memory-summary');
    const filters = document.getElementById('skill-library-filters');
    const list = document.getElementById('skill-library-list');
    if (!summary || !filters || !list) return;

    summary.textContent = `记忆 ${getUsedMemorySlots()}/${getMaxMemorySlots()} · 学识 ${playerStats?.学识 || 0}`;

    filters.innerHTML = getSkillCategories().map(category => `
        <button class="skill-filter-btn ${category === currentSkillLibraryFilter ? 'active' : ''}" onclick="changeSkillLibraryFilter('${category}')">${category}</button>
    `).join('');

    const entries = getSkillEntries(currentSkillLibraryFilter);
    if (!entries.length) {
        list.innerHTML = '<div class="skill-empty-state">当前分类下没有技能。</div>';
        return;
    }

    list.innerHTML = entries.map(([skillId, skill]) => {
        const learnedLevel = getLearnedSkillLevel(skillId);
        const nextLevel = getNextLearnableLevel(skillId);
        const equippedLevel = getEquippedSkillLevel(skillId);

        if (nextLevel == null) {
            return `
                <div class="skill-card maxed">
                    <div class="skill-card-top">
                        <div>
                            <div class="skill-title-row"><span class="skill-title">${skill.name}</span><span class="skill-badge success">Lv${learnedLevel}/Lv${skill.levels.length}</span></div>
                            <div class="skill-desc">${skill.description}</div>
                        </div>
                        <div class="skill-card-tags"><span class="skill-tag">${skill.category}</span>${equippedLevel ? `<span class="skill-tag equipped">已装备 Lv${equippedLevel}</span>` : ''}</div>
                    </div>
                    <div class="skill-meta-row">已满级</div>
                    ${buildSkillLevelDetails(skillId, learnedLevel)}
                </div>
            `;
        }

        const nextLevelData = getSkillLevelData(skillId, nextLevel);
        const requirementCheck = checkSkillRequirements(skillId, nextLevel);
        const canAfford = (playerStats?.金钱 || 0) >= (nextLevelData?.cost || 0);
        const canLearn = requirementCheck.ok && canAfford;

        return `
            <div class="skill-card ${canLearn ? '' : 'locked'}">
                <div class="skill-card-top">
                    <div>
                        <div class="skill-title-row"><span class="skill-title">${skill.name}</span><span class="skill-badge">Lv${learnedLevel} → Lv${nextLevel}</span></div>
                        <div class="skill-desc">${skill.description}</div>
                    </div>
                    <div class="skill-card-tags"><span class="skill-tag">${skill.category}</span>${equippedLevel ? `<span class="skill-tag equipped">已装备 Lv${equippedLevel}</span>` : ''}</div>
                </div>
                <div class="skill-meta-row">学习费用 ${nextLevelData.cost} 金 · ${getSkillMemoryText(skillId)}</div>
                <div class="skill-effect-row">${nextLevelData.effectDesc}</div>
                ${renderRequirementList(nextLevelData.requires, requirementCheck.failed)}
                <div class="skill-card-actions">
                    <button class="skill-action-btn ${canLearn ? '' : 'disabled'}" ${canLearn ? `onclick="learnSkill('${skillId}')"` : 'disabled'}>${canAfford ? '学习' : '金钱不足'}</button>
                </div>
                <details class="skill-level-details" id="skill-detail-${skillId}">
                    <summary>等级详情</summary>
                    <div class="skill-level-list">
                        ${skill.levels.map((levelData, index) => {
                            const level = index + 1;
                            const stateClass = level <= learnedLevel ? 'learned' : (level === nextLevel ? 'next' : 'locked');
                            const stateText = level <= learnedLevel ? '已学' : (level === nextLevel ? '可学' : '未解锁');
                            const check = checkSkillRequirements(skillId, level);
                            return `
                                <div class="skill-level-row ${stateClass}">
                                    <div class="skill-level-head">
                                        <span class="skill-level-name">Lv${level}</span>
                                        <span class="skill-level-state">${stateText}</span>
                                    </div>
                                    <div class="skill-level-meta">学习费用 ${levelData.cost} 金</div>
                                    <div class="skill-level-effect">${levelData.effectDesc}</div>
                                    ${renderRequirementList(levelData.requires, check.failed)}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </details>
            </div>
        `;
    }).join('');
}

function renderSkillEquipment() {
    const summary = document.getElementById('skill-equipment-memory-summary');
    const fill = document.getElementById('skill-memory-fill');
    const equippedList = document.getElementById('equipped-skill-list');
    const learnedList = document.getElementById('learned-skill-list');
    if (!summary || !fill || !equippedList || !learnedList) return;

    const maxMemory = getMaxMemorySlots();
    const usedMemory = getUsedMemorySlots();
    const percentage = maxMemory > 0 ? Math.min(100, usedMemory / maxMemory * 100) : 0;

    summary.textContent = `记忆 ${usedMemory}/${maxMemory}`;
    fill.style.width = `${percentage}%`;

    const learnedEntries = Object.entries(skillList || {}).filter(([skillId]) => getLearnedSkillLevel(skillId) > 0);
    const equippedEntries = learnedEntries.filter(([skillId]) => getEquippedSkillLevel(skillId) > 0);

    equippedList.innerHTML = equippedEntries.length ? equippedEntries.map(([skillId, skill]) => {
        const equippedLevel = getEquippedSkillLevel(skillId);
        return `
            <div class="skill-card compact equipped-card">
                <div class="skill-title-row"><span class="skill-title">${skill.name}</span><span class="skill-badge success">Lv${equippedLevel}</span></div>
                <div class="skill-effect-row">${getSkillSummaryText(skillId, equippedLevel)}</div>
                <div class="skill-meta-row">${getSkillMemoryText(skillId)}</div>
                <div class="skill-equip-actions">
                    <button class="skill-action-btn ghost" onclick="unequipSkill('${skillId}')">卸下</button>
                </div>
            </div>
        `;
    }).join('') : '<div class="skill-empty-state">当前没有已装备技能。</div>';

    learnedList.innerHTML = learnedEntries.length ? learnedEntries.map(([skillId, skill]) => {
        const learnedLevel = getLearnedSkillLevel(skillId);
        const equippedLevel = getEquippedSkillLevel(skillId);
        const isEquipped = equippedLevel > 0;
        return `
            <div class="skill-card compact ${equippedLevel ? 'is-equipped' : ''}">
                <div class="skill-title-row"><span class="skill-title">${skill.name}</span><span class="skill-badge ${isEquipped ? 'success' : ''}">${isEquipped ? '已装备' : '已学'} Lv${learnedLevel}</span></div>
                <div class="skill-effect-row">${getSkillSummaryText(skillId, learnedLevel)}</div>
                <div class="skill-meta-row">${getSkillMemoryText(skillId)}</div>
                <div class="skill-equip-actions">
                    ${isEquipped ? '<span class="skill-tag equipped">当前已装备</span>' : `<button class="skill-action-btn" onclick="equipSkill('${skillId}')">装备</button>`}
                </div>
            </div>
        `;
    }).join('') : '<div class="skill-empty-state">你还没有学会任何技能。</div>';
}

function changeSkillLibraryFilter(filter) {
    currentSkillLibraryFilter = filter;
    renderSkillLibrary();
}

async function persistSkillState() {
    if (typeof saveGameData === 'function') {
        await saveGameData();
    } else if (typeof syncGameDataFromVariables === 'function') {
        syncGameDataFromVariables();
    }
}

function showSkillLibrary() {
    closeAllSpecialModals();
    renderSkillLibrary();
    updateSkillModalPosition('skill-library-modal');
}

function closeSkillLibraryModal() {
    const modal = document.getElementById('skill-library-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal._unbindFit && modal._unbindFit();
}

async function learnSkill(skillId) {
    const skill = skillList?.[skillId];
    if (!skill) return;

    const learnedLevel = getLearnedSkillLevel(skillId);
    const nextLevel = learnedLevel + 1;
    const levelData = getSkillLevelData(skillId, nextLevel);
    if (!levelData) {
        showModal('该技能已经满级。');
        return;
    }

    const requirementCheck = checkSkillRequirements(skillId, nextLevel);
    if (!requirementCheck.ok) {
        showModal('前置条件未满足，暂时无法学习该等级。');
        return;
    }
    if ((playerStats?.金钱 || 0) < levelData.cost) {
        showModal('金钱不足，无法学习该技能。');
        return;
    }

    showConfirmModal(
        '确认学习',
        `确定花费 ${levelData.cost} 金学习 ${skill.name} Lv${nextLevel} 吗？<br><br>${levelData.effectDesc}`,
        async () => {
            playerStats.金钱 -= levelData.cost;
            learnedSkills[skillId] = nextLevel;
            if (equippedSkills?.[skillId]) {
                equippedSkills[skillId] = nextLevel;
            }
            checkAllValueRanges();
            updateAllDisplays();
            await persistSkillState();
            renderSkillLibrary();
            if (document.getElementById('skill-equipment-modal')?.style.display === 'block') {
                renderSkillEquipment();
            }
            showModal(`${skill.name} 已提升至 Lv${nextLevel}。`);
        }
    );
}

function showSkillEquipment() {
    closeAllSpecialModals();
    renderSkillEquipment();
    updateSkillModalPosition('skill-equipment-modal');
    toggleDropdown('attribute-dropdown');
}

function closeSkillEquipmentModal() {
    const modal = document.getElementById('skill-equipment-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal._unbindFit && modal._unbindFit();
}

async function equipSkill(skillId, level) {
    const skill = skillList?.[skillId];
    const learnedLevel = getLearnedSkillLevel(skillId);
    const targetLevel = Number(level) || learnedLevel;
    const levelData = getSkillLevelData(skillId, targetLevel);
    if (!skill || !levelData) return;

    if (targetLevel > learnedLevel) {
        showModal('该等级尚未学会，无法装备。');
        return;
    }

    const currentLevel = getEquippedSkillLevel(skillId);
    const currentCost = currentLevel ? getSkillMemorySlots(skillId) : 0;
    const nextCost = getSkillMemorySlots(skillId);
    const projectedUsed = getUsedMemorySlots() - currentCost + nextCost;

    if (projectedUsed > getMaxMemorySlots()) {
        showModal('记忆点不足，无法装备该技能。');
        return;
    }

    equippedSkills[skillId] = targetLevel;
    await persistSkillState();
    renderSkillEquipment();
    if (document.getElementById('skill-library-modal')?.style.display === 'block') {
        renderSkillLibrary();
    }
}

async function unequipSkill(skillId) {
    if (!equippedSkills || !equippedSkills[skillId]) return;
    delete equippedSkills[skillId];
    await persistSkillState();
    renderSkillEquipment();
    if (document.getElementById('skill-library-modal')?.style.display === 'block') {
        renderSkillLibrary();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSkillUi);
} else {
    initSkillUi();
}
