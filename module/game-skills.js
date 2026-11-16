/**
 * game-skills.js - 技能学习与装备界面（背包式三栏面板）
 *
 * 负责：
 * 1. 在藏经阁注入“技能习得”按钮
 * 2. 在属性查看下拉菜单注入“查看技能”按钮（静态 HTML 在 index.html）
 * 3. 创建两个视窗内三栏面板：技能习得（藏经阁）、技能管理（查看技能）
 * 4. 处理技能学习、装备、卸下与界面渲染
 *
 * 依赖：
 * - skillList / learnedSkills / equippedSkills / playerStats / npcs
 * - getSkillLevelData / getUsedMemorySlots / getMaxMemorySlots / getSkillMemorySlots / checkSkillRequirements
 * - DialogPanel（module/dialog-panel.js）
 * - showModal / showConfirmModal / closeAllSpecialModals / toggleDropdown
 * - saveGameData / checkAllValueRanges / updateAllDisplays
 */

let currentSkillLibraryTab = '攻击';
let currentSkillEquipTab = 'equipped';
let selectedLibrarySkill = null;
let selectedEquipSkill = null;

const skillEquipPanel = { modal: null, api: null };
const skillLibraryPanel = { modal: null, api: null };

function initSkillUi() {
    injectSkillEntryButtons();
    ensureSkillModals();
    exposeSkillFunctions();
}

function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (className) el.className = className;
    return el;
}

function injectSkillEntryButtons() {
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
            <div id="skill-library-modal" class="dialog-panel" style="display:none">
                <section class="dialog-panel-shell" role="dialog" aria-modal="true" aria-labelledby="skill-library-title">
                    <header class="dialog-panel-header">
                        <h2 id="skill-library-title">技能习得</h2>
                        <button type="button" data-dialog-close>退出</button>
                    </header>
                    <div class="dialog-panel-columns">
                        <nav class="dialog-tabs" aria-label="技能类型">
                            <button type="button" data-dialog-tab="攻击">攻击</button>
                            <button type="button" data-dialog-tab="防御">防御</button>
                            <button type="button" data-dialog-tab="辅助">辅助</button>
                            <button type="button" data-dialog-tab="控制">控制</button>
                        </nav>
                        <div id="skill-library-list" class="dialog-list" aria-label="可学技能"></div>
                        <section class="dialog-detail" aria-label="技能详情">
                            <div id="skill-library-detail" class="dialog-detail-body" aria-live="polite"></div>
                            <div id="skill-library-actions" class="dialog-detail-actions"></div>
                        </section>
                    </div>
                </section>
            </div>
        `);
    }

    if (!document.getElementById('skill-equipment-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="skill-equipment-modal" class="dialog-panel" style="display:none">
                <section class="dialog-panel-shell" role="dialog" aria-modal="true" aria-labelledby="skill-equipment-title">
                    <header class="dialog-panel-header">
                        <h2 id="skill-equipment-title">技能管理</h2>
                        <button type="button" data-dialog-close>退出</button>
                    </header>
                    <div class="dialog-memorybar" aria-label="记忆点占用">
                        <span class="dialog-memory-label">记忆点</span>
                        <div class="dialog-memory-track"><div class="dialog-memory-fill" id="skill-memory-fill"></div></div>
                        <span class="dialog-memory-text" id="skill-equipment-memory-summary">0 / 0</span>
                    </div>
                    <div class="dialog-panel-columns">
                        <nav class="dialog-tabs" aria-label="技能分类">
                            <button type="button" data-dialog-tab="equipped">已装备</button>
                            <button type="button" data-dialog-tab="learned">已学习</button>
                        </nav>
                        <div id="skill-equipment-list" class="dialog-list" aria-label="技能列表"></div>
                        <section class="dialog-detail" aria-label="技能详情">
                            <div id="skill-equipment-detail" class="dialog-detail-body" aria-live="polite"></div>
                            <div id="skill-equipment-actions" class="dialog-detail-actions"></div>
                        </section>
                    </div>
                </section>
            </div>
        `);
    }

    // 挂载进 #main-viewport 并绑定点击委托（只做一次）。
    if (!skillLibraryPanel.api) {
        skillLibraryPanel.modal = document.getElementById('skill-library-modal');
        skillLibraryPanel.api = DialogPanel.mount(skillLibraryPanel.modal);
        skillLibraryPanel.modal.addEventListener('click', onLibraryClick);
    }
    if (!skillEquipPanel.api) {
        skillEquipPanel.modal = document.getElementById('skill-equipment-modal');
        skillEquipPanel.api = DialogPanel.mount(skillEquipPanel.modal);
        skillEquipPanel.modal.addEventListener('click', onEquipClick);
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
}

function getSkillCategories() {
    return ['攻击', '防御', '辅助', '控制'];
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

function getSkillSummaryText(skillId, level) {
    const levelData = getSkillLevelData(skillId, level);
    return levelData ? levelData.effectDesc : '暂无效果说明';
}

/* ============ 技能习得（藏经阁） ============ */

function onLibraryClick(event) {
    const button = event.target.closest('button');
    if (!button || !skillLibraryPanel.modal.contains(button)) return;
    if (button.hasAttribute('data-dialog-close')) return; // 由 DialogPanel 处理
    if (button.dataset.dialogTab) {
        currentSkillLibraryTab = button.dataset.dialogTab;
        selectedLibrarySkill = null;
        renderSkillLibrary();
    } else if (button.dataset.libraryItem) {
        selectedLibrarySkill = button.dataset.libraryItem;
        renderSkillLibrary();
    } else if (button.dataset.libraryAction === 'learn' && selectedLibrarySkill) {
        learnSkill(selectedLibrarySkill);
    }
}

function renderSkillLibrary() {
    const list = document.getElementById('skill-library-list');
    const detail = document.getElementById('skill-library-detail');
    const actions = document.getElementById('skill-library-actions');
    if (!list || !detail || !actions) return;

    skillLibraryPanel.modal.querySelectorAll('[data-dialog-tab]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.dialogTab === currentSkillLibraryTab));
    });

    const ids = Object.keys(skillList || {}).filter(id => skillList[id].category === currentSkillLibraryTab);
    if (selectedLibrarySkill && !ids.includes(selectedLibrarySkill)) selectedLibrarySkill = null;

    list.replaceChildren();
    if (!ids.length) {
        list.append(node('p', '当前类型下没有技能。', 'dialog-empty'));
    } else {
        ids.forEach(id => {
            const skill = skillList[id];
            const learned = getLearnedSkillLevel(id);
            const next = getNextLearnableLevel(id);
            const badge = next == null ? '已满级' : `Lv${learned} → Lv${next}`;
            const btn = node('button', undefined, 'dialog-item');
            btn.type = 'button';
            btn.dataset.libraryItem = id;
            btn.setAttribute('aria-pressed', String(id === selectedLibrarySkill));
            btn.append(node('span', skill.name, 'dialog-item-name'), node('span', badge, 'dialog-item-badge'));
            list.append(btn);
        });
    }

    detail.replaceChildren(); actions.replaceChildren();
    if (!selectedLibrarySkill) {
        detail.append(node('h3', currentSkillLibraryTab + '技能'), node('p', '选择一项技能，查看下一级的费用、条件与效果。'));
        return;
    }

    const skill = skillList[selectedLibrarySkill];
    const learned = getLearnedSkillLevel(selectedLibrarySkill);
    const next = getNextLearnableLevel(selectedLibrarySkill);
    detail.append(node('h3', skill.name));

    if (next == null) {
        detail.append(node('p', `该技能已满级（Lv${learned}）。`));
        return;
    }

    const levelData = getSkillLevelData(selectedLibrarySkill, next);
    const check = checkSkillRequirements(selectedLibrarySkill, next);
    const canAfford = (playerStats?.金钱 || 0) >= (levelData?.cost || 0);

    const meta = node('div', undefined, 'dialog-meta');
    meta.append(
        node('p', `目标等级：Lv${next}`),
        node('p', `学习费用：${levelData.cost} 金`),
        node('p', `记忆点：${getSkillMemorySlots(selectedLibrarySkill)} 点`)
    );
    detail.append(meta);

    // 学习条件（不满足者红色标出）
    const entries = Object.entries(levelData.requires || {});
    if (!entries.length) {
        detail.append(node('p', '学习条件：无前置条件', 'dialog-req ok'));
    } else {
        detail.append(node('p', '学习条件：'));
        entries.forEach(([path, condition]) => {
            const failed = check.failed.includes(path);
            detail.append(node('div', `${getSkillRequirementLabel(path)} ${formatSkillRequirement(condition)}`, `dialog-req ${failed ? 'failed' : 'ok'}`));
        });
    }

    detail.append(node('p', '效果：' + levelData.effectDesc));

    const learnBtn = node('button');
    learnBtn.type = 'button';
    learnBtn.dataset.libraryAction = 'learn';
    if (check.ok && canAfford) {
        learnBtn.textContent = '学习';
    } else if (!canAfford) {
        learnBtn.textContent = '金钱不足';
        learnBtn.disabled = true;
    } else {
        learnBtn.textContent = '条件未满足';
        learnBtn.disabled = true;
    }
    actions.append(learnBtn);
}

function showSkillLibrary() {
    closeAllSpecialModals();
    selectedLibrarySkill = null;
    renderSkillLibrary();
    skillLibraryPanel.api.open(document.activeElement);
}

function closeSkillLibraryModal() {
    skillLibraryPanel.api && skillLibraryPanel.api.close();
}

async function learnSkill(skillId) {
    if(typeof speechService!=='undefined'&&!speechService.guardProgress())return;
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
            if(typeof speechService!=='undefined'&&!speechService.guardProgress())return;
            playerStats.金钱 -= levelData.cost;
            learnedSkills[skillId] = nextLevel;
            if (equippedSkills?.[skillId]) {
                equippedSkills[skillId] = nextLevel;
            }
            checkAllValueRanges();
            updateAllDisplays();
            await persistSkillState();
            selectedLibrarySkill = skillId;
            renderSkillLibrary();
            if (skillEquipPanel.api && skillEquipPanel.api.isOpen()) renderSkillEquipment();
            showModal(`${skill.name} 已提升至 Lv${nextLevel}。`);
        }
    );
}

/* ============ 技能管理（查看技能） ============ */

function onEquipClick(event) {
    const button = event.target.closest('button');
    if (!button || !skillEquipPanel.modal.contains(button)) return;
    if (button.hasAttribute('data-dialog-close')) return; // 由 DialogPanel 处理
    if (button.dataset.dialogTab) {
        currentSkillEquipTab = button.dataset.dialogTab;
        selectedEquipSkill = null;
        renderSkillEquipment();
    } else if (button.dataset.skillItem) {
        selectedEquipSkill = button.dataset.skillItem;
        renderSkillEquipment();
    } else if (button.dataset.skillAction === 'equip' && selectedEquipSkill) {
        equipSkill(selectedEquipSkill);
    } else if (button.dataset.skillAction === 'unequip' && selectedEquipSkill) {
        unequipSkill(selectedEquipSkill);
    }
}

function renderSkillEquipment() {
    const summary = document.getElementById('skill-equipment-memory-summary');
    const fill = document.getElementById('skill-memory-fill');
    const list = document.getElementById('skill-equipment-list');
    const detail = document.getElementById('skill-equipment-detail');
    const actions = document.getElementById('skill-equipment-actions');
    if (!summary || !fill || !list || !detail || !actions) return;

    const maxMemory = getMaxMemorySlots();
    const usedMemory = getUsedMemorySlots();
    summary.textContent = `${usedMemory} / ${maxMemory}`;
    fill.style.width = (maxMemory > 0 ? Math.min(100, usedMemory / maxMemory * 100) : 0) + '%';

    skillEquipPanel.modal.querySelectorAll('[data-dialog-tab]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.dialogTab === currentSkillEquipTab));
    });

    const isEquippedTab = currentSkillEquipTab === 'equipped';
    const equippedIds = Object.keys(equippedSkills || {}).filter(id => getEquippedSkillLevel(id) > 0);
    const learnedIds = Object.keys(learnedSkills || {}).filter(id => getLearnedSkillLevel(id) > 0);
    // 已装备选项卡 = 已装备技能；已学习选项卡 = 已学但未装备的技能。
    const ids = isEquippedTab ? equippedIds : learnedIds.filter(id => !equippedSkills?.[id]);
    // 按 skillList 配置顺序排列
    const ordered = Object.keys(skillList || {}).filter(id => ids.includes(id));

    if (selectedEquipSkill && !ordered.includes(selectedEquipSkill)) selectedEquipSkill = null;

    list.replaceChildren();
    if (!ordered.length) {
        list.append(node('p', isEquippedTab ? '当前没有已装备技能。' : '当前没有可装备的已学技能。', 'dialog-empty'));
    } else {
        ordered.forEach(id => {
            const skill = skillList[id];
            const level = isEquippedTab ? getEquippedSkillLevel(id) : getLearnedSkillLevel(id);
            const btn = node('button', undefined, 'dialog-item');
            btn.type = 'button';
            btn.dataset.skillItem = id;
            btn.setAttribute('aria-pressed', String(id === selectedEquipSkill));
            btn.append(node('span', skill.name, 'dialog-item-name'), node('span', 'Lv' + level, 'dialog-item-badge'));
            list.append(btn);
        });
    }

    detail.replaceChildren(); actions.replaceChildren();
    if (!selectedEquipSkill) {
        detail.append(node('h3', isEquippedTab ? '已装备' : '已学习'), node('p', '选择一项技能查看详情。'));
        return;
    }

    const skill = skillList[selectedEquipSkill];
    const level = isEquippedTab ? getEquippedSkillLevel(selectedEquipSkill) : getLearnedSkillLevel(selectedEquipSkill);
    detail.append(node('h3', skill.name));
    const meta = node('div', undefined, 'dialog-meta');
    meta.append(
        node('p', `当前等级：Lv${level}`),
        node('p', `记忆点：${getSkillMemorySlots(selectedEquipSkill)} 点`),
        node('p', `类型：${skill.category}`)
    );
    detail.append(meta, node('p', getSkillSummaryText(selectedEquipSkill, level)));

    const btn = node('button');
    btn.type = 'button';
    if (isEquippedTab) {
        btn.textContent = '卸下';
        btn.dataset.skillAction = 'unequip';
    } else {
        btn.textContent = '装备';
        btn.dataset.skillAction = 'equip';
    }
    actions.append(btn);
}

function showSkillEquipment() {
    closeAllSpecialModals();
    selectedEquipSkill = null;
    renderSkillEquipment();
    skillEquipPanel.api.open(document.activeElement);
    toggleDropdown('attribute-dropdown');
}

function closeSkillEquipmentModal() {
    skillEquipPanel.api && skillEquipPanel.api.close();
}

async function persistSkillState() {
    if (typeof saveGameData === 'function') {
        await saveGameData();
    } else if (typeof syncGameDataFromVariables === 'function') {
        syncGameDataFromVariables();
    }
}

async function equipSkill(skillId) {
    if(typeof speechService!=='undefined'&&!speechService.guardProgress())return;
    const skill = skillList?.[skillId];
    const learnedLevel = getLearnedSkillLevel(skillId);
    const targetLevel = learnedLevel;
    const levelData = getSkillLevelData(skillId, targetLevel);
    if (!skill || !levelData || targetLevel < 1) {
        showModal('该技能尚未学会，无法装备。');
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
    selectedEquipSkill = skillId;
    renderSkillEquipment();
    if (skillLibraryPanel.api && skillLibraryPanel.api.isOpen()) renderSkillLibrary();
}

async function unequipSkill(skillId) {
    if(typeof speechService!=='undefined'&&!speechService.guardProgress())return;
    if (!equippedSkills || !equippedSkills[skillId]) return;
    delete equippedSkills[skillId];
    await persistSkillState();
    selectedEquipSkill = skillId;
    renderSkillEquipment();
    if (skillLibraryPanel.api && skillLibraryPanel.api.isOpen()) renderSkillLibrary();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSkillUi);
} else {
    initSkillUi();
}
