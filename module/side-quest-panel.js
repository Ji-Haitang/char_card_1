/* ============================================================================
 * side-quest-panel.js — 支线传闻/进行中/往事面板（DialogPanel 三栏，仿 game-skills.js）
 *
 * 数据全部来自 window.sideQuestService / window.sideQuestRunner（typeof 守卫，
 * 缺失时面板显示空态而不报错）。注入安全：一律 textContent，不拼 innerHTML。
 * ========================================================================== */

let currentSideQuestTab = 'rumors';
let selectedRumorIdx = -1;
let selectedHistoryIdx = -1;
let _sqPanelBusy = false;

const sideQuestPanel = { modal: null, api: null };

function initSideQuestUi() {
    ensureSideQuestModal();
    ensureTaskInfoModal();
    exposeSideQuestFunctions();
    startTaskInfoButtonWatch();
}

function sqNode(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (className) el.className = className;
    return el;
}

function ensureSideQuestModal() {
    if (!document.getElementById('side-quest-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="side-quest-modal" class="dialog-panel" style="display:none">
                <section class="dialog-panel-shell" role="dialog" aria-modal="true" aria-labelledby="side-quest-title">
                    <header class="dialog-panel-header">
                        <h2 id="side-quest-title">支线传闻</h2>
                        <button type="button" data-dialog-close>退出</button>
                    </header>
                    <div class="dialog-panel-columns">
                        <nav class="dialog-tabs" aria-label="支线分类">
                            <button type="button" data-dialog-tab="rumors">传闻</button>
                            <button type="button" data-dialog-tab="active">进行中</button>
                            <button type="button" data-dialog-tab="history">往事</button>
                        </nav>
                        <div class="dialog-list sq-list-col">
                            <div id="side-quest-list" class="sq-list-items" aria-label="支线列表"></div>
                            <div id="side-quest-list-actions" class="dialog-detail-actions"></div>
                        </div>
                        <section class="dialog-detail" aria-label="支线详情">
                            <div id="side-quest-detail" class="dialog-detail-body" aria-live="polite"></div>
                            <div id="side-quest-actions" class="dialog-detail-actions"></div>
                        </section>
                    </div>
                </section>
            </div>
        `);
    }
    if (!sideQuestPanel.api) {
        sideQuestPanel.modal = document.getElementById('side-quest-modal');
        sideQuestPanel.api = DialogPanel.mount(sideQuestPanel.modal);
        sideQuestPanel.modal.addEventListener('click', onSideQuestClick);
    }
}

function exposeSideQuestFunctions() {
    window.showSideQuestPanel = showSideQuestPanel;
    window.closeSideQuestPanel = closeSideQuestPanel;
    window.updateSideQuestEntryButtons = updateSideQuestEntryButtons;
    window.showTaskInfoPanel = showTaskInfoPanel;
    window.closeTaskInfoPanel = closeTaskInfoPanel;
    window.updateTaskInfoButton = updateTaskInfoButton;
}

/** 支线/任务面板任一处数据变动后，两块面板凡打开的都重绘 */
function _sqRerenderAll() {
    if (sideQuestPanel.api && sideQuestPanel.api.isOpen()) renderSideQuestPanel();
    if (taskInfoPanel.api && taskInfoPanel.api.isOpen()) renderTaskInfoPanel();
    updateTaskInfoButton();
}

function _sqSvc() { return (typeof sideQuestService !== 'undefined') ? sideQuestService : null; }
function _sqRunner() { return (typeof sideQuestRunner !== 'undefined') ? sideQuestRunner : null; }

function _sqNpcName(letter) {
    return (typeof npcs !== 'undefined' && npcs && npcs[letter] && npcs[letter].name) ? npcs[letter].name : letter;
}

/** 阶段序数：已揭示 stage 数 + 1（当前），分母为 stage 总数 */
function _sqStageInfo(active) {
    let total = 0;
    Object.keys(active.nodes || {}).forEach(id => {
        if (active.nodes[id] && active.nodes[id].type === 'stage') total++;
    });
    const seen = {};
    let revealed = 0;
    (active.log || []).forEach(entry => {
        if (entry && entry.revealedTitle && entry.nodeId && !seen[entry.nodeId]) {
            seen[entry.nodeId] = true;
            revealed++;
        }
    });
    total = Math.max(total, 1);
    return { now: Math.min(revealed + 1, total), total: total };
}

function _sqWeeksLeft(active) {
    if (!active.deadlineWeek || active.deadlineWeek <= 0) return '时限不限';
    const now = (typeof currentWeek !== 'undefined') ? currentWeek : active.acceptedWeek;
    return '剩余 ' + Math.max(0, active.deadlineWeek - now) + ' 周';
}

/* ============ 入口按钮可用态（有进行中支线时「打探传闻」禁用） ============ */

function updateSideQuestEntryButtons() {
    const svc = _sqSvc();
    const hasActive = !!(svc && svc.getActive && svc.getActive());
    const btn = document.getElementById('sq-rumor-btn');
    if (btn) {
        btn.disabled = hasActive;
        btn.title = hasActive ? '一事未了——请先完成或放弃当前支线' : '';
    }
}

/* ============ 点击委托 ============ */

function onSideQuestClick(event) {
    const button = event.target.closest('button');
    if (!button || !sideQuestPanel.modal.contains(button)) return;
    if (button.hasAttribute('data-dialog-close')) return; // 由 DialogPanel 处理
    if (_sqPanelBusy) return;
    if (button.dataset.dialogTab) {
        currentSideQuestTab = button.dataset.dialogTab;
        renderSideQuestPanel();
    } else if (button.dataset.rumorItem !== undefined) {
        selectedRumorIdx = Number(button.dataset.rumorItem);
        renderSideQuestPanel();
    } else if (button.dataset.historyItem !== undefined) {
        selectedHistoryIdx = Number(button.dataset.historyItem);
        renderSideQuestPanel();
    } else if (button.dataset.sqAction === 'refresh') {
        _sqRefreshRumors();
    } else if (button.dataset.sqAction === 'accept' && selectedRumorIdx >= 0) {
        _sqAcceptRumor(selectedRumorIdx);
    } else if (button.dataset.sqAction === 'abandon') {
        _sqAbandonQuest();
    }
}

/* ============ 渲染 ============ */

function renderSideQuestPanel() {
    const list = document.getElementById('side-quest-list');
    const detail = document.getElementById('side-quest-detail');
    const actions = document.getElementById('side-quest-actions');
    const listActions = document.getElementById('side-quest-list-actions');
    if (!list || !detail || !actions || !listActions) return;

    sideQuestPanel.modal.querySelectorAll('[data-dialog-tab]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.dialogTab === currentSideQuestTab));
    });

    list.replaceChildren();
    detail.replaceChildren();
    actions.replaceChildren();
    listActions.replaceChildren();

    if (currentSideQuestTab === 'rumors') _renderRumorTab(list, detail, actions, listActions);
    else if (currentSideQuestTab === 'active') _renderActiveTab(list, detail, actions);
    else _renderHistoryTab(list, detail, actions);
}

/* ---------- 传闻 ---------- */

function _renderRumorTab(list, detail, actions, listActions) {
    const svc = _sqSvc(), runner = _sqRunner();
    const active = svc && svc.getActive ? svc.getActive() : null;
    if (active) {
        list.append(sqNode('p', '一事未了——请先完成或放弃当前支线「' + active.title + '」。', 'dialog-empty'));
        detail.append(sqNode('h3', '传闻'), sqNode('p', '进行中支线存在期间无法打探新传闻。'));
        return;
    }
    const candidates = (runner && runner.getRumorCandidates && runner.getRumorCandidates()) || null;
    const used = svc && svc.rumorRefreshUsed && svc.rumorRefreshUsed();

    if (!candidates || !candidates.length) {
        list.append(sqNode('p', used ? '本周已接取过支线，下周再来吧。' : '尚未打探到任何传闻。', 'dialog-empty'));
        detail.append(sqNode('h3', '传闻'), sqNode('p', '茶余饭后的只言片语，或许藏着一段不为人知的故事。'));
        const refreshBtn = sqNode('button');
        refreshBtn.type = 'button';
        refreshBtn.dataset.sqAction = 'refresh';
        if (_sqPanelBusy) {
            refreshBtn.textContent = '打探中…';
            refreshBtn.disabled = true;
        } else if (used) {
            refreshBtn.textContent = '本周已接取';
            refreshBtn.disabled = true;
        } else {
            refreshBtn.textContent = '打探传闻';
            refreshBtn.title = '打探不计次数，接取支线才计入本周次数';
        }
        actions.append(refreshBtn);
        return;
    }

    const retryIndex = runner && runner.getTreeRetryIndex ? runner.getTreeRetryIndex() : -1;
    // 仅当“已接取但建树失败”且本周额度已用时，才锁死到该候选；跨周后额度恢复，可自由改选。
    const lockedRetryIndex = (used && retryIndex >= 0) ? retryIndex : -1;
    if (lockedRetryIndex >= 0 && candidates[lockedRetryIndex]) selectedRumorIdx = lockedRetryIndex;

    candidates.forEach((r, i) => {
        const btn = sqNode('button', undefined, 'dialog-item');
        btn.type = 'button';
        btn.dataset.rumorItem = i;
        btn.disabled = _sqPanelBusy || (lockedRetryIndex >= 0 && lockedRetryIndex !== i);
        btn.setAttribute('aria-pressed', String(i === selectedRumorIdx));
        btn.append(sqNode('span', r.title, 'dialog-item-name'), sqNode('span', r.difficulty || '普通', 'dialog-item-badge'));
        list.append(btn);
    });

    const refreshBtn = sqNode('button');
    refreshBtn.type = 'button';
    refreshBtn.dataset.sqAction = 'refresh';
    refreshBtn.textContent = _sqPanelBusy ? '处理中…' : (used ? '本周已接取' : '换一批传闻');
    refreshBtn.disabled = _sqPanelBusy || used;
    listActions.append(refreshBtn); // 中栏列表底部，与右栏「接取此线」底边对齐

    const sel = candidates[selectedRumorIdx];
    if (!sel) {
        detail.append(sqNode('h3', '传闻'), sqNode('p', '选择一条传闻查看详情。'));
        return;
    }
    detail.append(sqNode('h3', sel.title));
    const meta = sqNode('div', undefined, 'dialog-meta');
    meta.append(sqNode('p', '难度：' + (sel.difficulty || '普通')));
    if (Array.isArray(sel.relatedLocations) && sel.relatedLocations.length) {
        meta.append(sqNode('p', '相关地点：' + sel.relatedLocations.join('、')));
    }
    if (Array.isArray(sel.relatedNpcs) && sel.relatedNpcs.length) {
        meta.append(sqNode('p', '相关人物：' + sel.relatedNpcs.map(_sqNpcName).join('、')));
    }
    detail.append(meta);
    detail.append(sqNode('p', sel.background || ''));
    detail.append(sqNode('p', '目标：' + (sel.playerGoal || ''), 'sq-goal'));

    const acceptBtn = sqNode('button');
    acceptBtn.type = 'button';
    acceptBtn.dataset.sqAction = 'accept';
    const retryingTree = used && retryIndex === selectedRumorIdx;
    acceptBtn.textContent = _sqPanelBusy ? '生成剧情树中…' : (retryingTree ? '重新生成剧情树' : (used ? '本周额度已用' : '接取此线'));
    acceptBtn.disabled = _sqPanelBusy || (used && !retryingTree);
    actions.append(acceptBtn);
    if (used && !retryingTree) {
        detail.append(sqNode('p', '本周接取额度已使用；只有此前建树失败的传闻可以重试。'));
    }
}

async function _sqRefreshRumors() {
    const runner = _sqRunner();
    if (!runner || _sqPanelBusy) return;
    _sqPanelBusy = true;
    renderSideQuestPanel();
    try {
        const rumors = await runner.generateRumors();
        if (rumors && rumors.length) selectedRumorIdx = 0;
    } finally {
        _sqPanelBusy = false;
        renderSideQuestPanel();
    }
}

async function _sqAcceptRumor(idx) {
    const runner = _sqRunner();
    if (!runner || _sqPanelBusy) return;
    _sqPanelBusy = true;
    renderSideQuestPanel();
    try {
        const ok = await runner.acceptRumor(idx);
        if (ok) {
            selectedRumorIdx = -1;
            currentSideQuestTab = 'active';
        }
    } finally {
        _sqPanelBusy = false;
        renderSideQuestPanel();
    }
}

/* ---------- 进行中 ---------- */

function _renderActiveTab(list, detail, actions) {
    const svc = _sqSvc();
    const active = svc && svc.getActive ? svc.getActive() : null;
    if (!active) {
        list.append(sqNode('p', '暂无进行中的支线。', 'dialog-empty'));
        detail.append(sqNode('h3', '进行中'), sqNode('p', '可前往「传闻」页打探新线索。'));
        return;
    }
    const stage = _sqStageInfo(active);

    const card = sqNode('button', undefined, 'dialog-item');
    card.type = 'button';
    card.setAttribute('aria-pressed', 'true');
    card.append(
        sqNode('span', active.title, 'dialog-item-name'),
        sqNode('span', '第' + stage.now + '/' + stage.total + '阶', 'dialog-item-badge')
    );
    list.append(card);

    detail.append(sqNode('h3', active.title));
    const meta = sqNode('div', undefined, 'dialog-meta');
    meta.append(
        sqNode('p', '难度：' + (active.difficulty || '普通')),
        sqNode('p', _sqWeeksLeft(active))
    );
    if (Array.isArray(active.relatedLocations) && active.relatedLocations.length) {
        meta.append(sqNode('p', '相关地点：' + active.relatedLocations.join('、')));
    }
    if (Array.isArray(active.relatedNpcs) && active.relatedNpcs.length) {
        meta.append(sqNode('p', '相关人物：' + active.relatedNpcs.map(_sqNpcName).join('、')));
    }
    detail.append(meta);
    if (active.playerGoal) detail.append(sqNode('p', '目标：' + active.playerGoal, 'sq-goal'));
    if (active.background) detail.append(sqNode('p', active.background));

    // 已知进展：仅显示已揭示的 revealedTitle（hiddenGoal/未揭示标题绝不外显）
    detail.append(sqNode('h4', '已知进展'));
    const revealed = (active.log || []).filter(e => e && e.revealedTitle);
    if (!revealed.length) {
        detail.append(sqNode('p', '（尚无明确进展，继续日常行动即可）', 'dialog-empty'));
    } else {
        const ol = sqNode('ol', undefined, 'sq-progress-list');
        revealed.forEach(e => ol.append(sqNode('li', e.revealedTitle)));
        detail.append(ol);
    }

    const abandonBtn = sqNode('button');
    abandonBtn.type = 'button';
    abandonBtn.dataset.sqAction = 'abandon';
    abandonBtn.textContent = '放弃支线';
    abandonBtn.className = 'sq-abandon-btn';
    actions.append(abandonBtn);
}

function _sqAbandonQuest() {
    const svc = _sqSvc();
    const active = svc && svc.getActive ? svc.getActive() : null;
    if (!active) return;
    showConfirmModal(
        '放弃支线',
        '确定放弃「' + String(active.title || '').replace(/</g, '&lt;') + '」吗？<br>放弃无惩罚，可在议事厅重新打探传闻。',
        () => {
            svc.abandonQuest();
            _sqRerenderAll();
        }
    );
}

/* ---------- 往事 ---------- */

const SQ_OUTCOME_LABEL = { completed: '完成', failed: '失败', abandoned: '放弃' };

function _renderHistoryTab(list, detail, actions) {
    const svc = _sqSvc();
    const history = (svc && svc.getHistory ? svc.getHistory() : []).slice().reverse();
    if (!history.length) {
        list.append(sqNode('p', '尚无已完结的支线。', 'dialog-empty'));
        detail.append(sqNode('h3', '往事'), sqNode('p', '尘埃落定之后，这里会记下每一段支线的结局。'));
        return;
    }
    if (selectedHistoryIdx >= history.length) selectedHistoryIdx = -1;

    history.forEach((h, i) => {
        const btn = sqNode('button', undefined, 'dialog-item');
        btn.type = 'button';
        btn.dataset.historyItem = i;
        btn.setAttribute('aria-pressed', String(i === selectedHistoryIdx));
        const outcome = SQ_OUTCOME_LABEL[h.outcome] || h.outcome || '未知';
        btn.append(
            sqNode('span', h.title, 'dialog-item-name'),
            sqNode('span', outcome, 'dialog-item-badge sq-outcome-' + (h.outcome || 'unknown'))
        );
        list.append(btn);
    });

    const sel = history[selectedHistoryIdx];
    if (!sel) {
        detail.append(sqNode('h3', '往事'), sqNode('p', '选择一段往事查看详情。'));
        return;
    }
    detail.append(sqNode('h3', sel.title));
    const meta = sqNode('div', undefined, 'dialog-meta');
    meta.append(
        sqNode('p', '结局：' + (SQ_OUTCOME_LABEL[sel.outcome] || sel.outcome || '未知')),
        sqNode('p', '第 ' + (sel.acceptedWeek || '?') + ' 周接取 · 第 ' + (sel.finishedWeek || '?') + ' 周了结')
    );
    detail.append(meta);
    if (sel.outcome === 'failed' && sel.failReason) {
        detail.append(sqNode('p', '失败原因：' + sel.failReason));
    }
}

/* ============ 开关 ============ */

function showSideQuestPanel(tab) {
    if (typeof closeAllSpecialModals === 'function') closeAllSpecialModals();
    const svc = _sqSvc();
    if (tab === 'rumors' || tab === 'active' || tab === 'history') {
        currentSideQuestTab = tab;
    } else if (svc && svc.getActive && svc.getActive()) {
        currentSideQuestTab = 'active';
    } else {
        currentSideQuestTab = 'rumors';
    }
    renderSideQuestPanel();
    sideQuestPanel.api.open(document.activeElement);
    // 仅当属性下拉正处于展开态时收起它（下拉入口路径）；toggleDropdown 是无条件切换，
    // 状态条/场景按钮入口直接调用会把已关闭的下拉误展开
    const dd = document.getElementById('attribute-dropdown');
    if (dd && dd.classList.contains('show') && typeof toggleDropdown === 'function') {
        try { toggleDropdown('attribute-dropdown'); } catch (e) { /* 忽略 */ }
    }
}

function closeSideQuestPanel() {
    sideQuestPanel.api && sideQuestPanel.api.close();
}

/* ============================================================================
 * 任务信息面板（右下角叹号按钮入口）：当前悬赏 / 当前支线 / 历史支线
 * 样式与支线传闻面板同一 DialogPanel 三栏；「当前支线」「历史支线」直接复用
 * 上方 _renderActiveTab / _renderHistoryTab（内容/样式与「进行中」「往事」完全一致）。
 * ========================================================================== */

let currentTaskInfoTab = 'bounty';
const taskInfoPanel = { modal: null, api: null };

function ensureTaskInfoModal() {
    if (!document.getElementById('task-info-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="task-info-modal" class="dialog-panel" style="display:none">
                <section class="dialog-panel-shell" role="dialog" aria-modal="true" aria-labelledby="task-info-title">
                    <header class="dialog-panel-header">
                        <h2 id="task-info-title">任务信息</h2>
                        <button type="button" data-dialog-close>退出</button>
                    </header>
                    <div class="dialog-panel-columns">
                        <nav class="dialog-tabs" aria-label="任务分类">
                            <button type="button" data-dialog-tab="bounty">悬赏</button>
                            <button type="button" data-dialog-tab="active">传闻</button>
                            <button type="button" data-dialog-tab="history">历史</button>
                        </nav>
                        <div class="dialog-list sq-list-col">
                            <div id="task-info-list" class="sq-list-items" aria-label="任务列表"></div>
                            <div id="task-info-list-actions" class="dialog-detail-actions"></div>
                        </div>
                        <section class="dialog-detail" aria-label="任务详情">
                            <div id="task-info-detail" class="dialog-detail-body" aria-live="polite"></div>
                            <div id="task-info-actions" class="dialog-detail-actions"></div>
                        </section>
                    </div>
                </section>
            </div>
        `);
    }
    if (!taskInfoPanel.api) {
        taskInfoPanel.modal = document.getElementById('task-info-modal');
        taskInfoPanel.api = DialogPanel.mount(taskInfoPanel.modal);
        taskInfoPanel.modal.addEventListener('click', onTaskInfoClick);
    }
}

function _tiActiveBounty() {
    return (typeof activeBounty !== 'undefined' && activeBounty) ? activeBounty : null;
}

function onTaskInfoClick(event) {
    const button = event.target.closest('button');
    if (!button || !taskInfoPanel.modal.contains(button)) return;
    if (button.hasAttribute('data-dialog-close')) return; // 由 DialogPanel 处理
    if (button.dataset.dialogTab) {
        currentTaskInfoTab = button.dataset.dialogTab;
        renderTaskInfoPanel();
    } else if (button.dataset.historyItem !== undefined) {
        selectedHistoryIdx = Number(button.dataset.historyItem);
        renderTaskInfoPanel();
    } else if (button.dataset.sqAction === 'abandon') {
        _sqAbandonQuest();
    } else if (button.dataset.tiAction === 'abandon-bounty') {
        _tiAbandonBounty();
    }
}

function renderTaskInfoPanel() {
    const list = document.getElementById('task-info-list');
    const detail = document.getElementById('task-info-detail');
    const actions = document.getElementById('task-info-actions');
    const listActions = document.getElementById('task-info-list-actions');
    if (!list || !detail || !actions || !listActions) return;

    taskInfoPanel.modal.querySelectorAll('[data-dialog-tab]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.dialogTab === currentTaskInfoTab));
    });

    list.replaceChildren();
    detail.replaceChildren();
    actions.replaceChildren();
    listActions.replaceChildren();

    if (currentTaskInfoTab === 'bounty') _renderBountyTab(list, detail, actions);
    else if (currentTaskInfoTab === 'active') _renderActiveTab(list, detail, actions);
    else _renderHistoryTab(list, detail, actions);
    updateTaskInfoButton();
}

/* ---------- 当前悬赏 ---------- */

function _renderBountyTab(list, detail, actions) {
    const bounty = _tiActiveBounty();
    const svc = (typeof bountyService !== 'undefined') ? bountyService : null;
    if (!bounty) {
        const weeklyUsed = (typeof lastBountyAcceptWeek !== 'undefined' && typeof currentWeek !== 'undefined' &&
            lastBountyAcceptWeek === currentWeek);
        list.append(sqNode('p', '暂无进行中的悬赏。', 'dialog-empty'));
        detail.append(
            sqNode('h3', '当前悬赏'),
            sqNode('p', weeklyUsed ? '本周已接取过悬赏任务，无论成败下周再来吧。' : '可前往议事厅的悬赏榜接取悬赏任务。')
        );
        return;
    }
    const suspended = !!(svc && svc.isSuspendedBySideQuest && svc.isSuspendedBySideQuest());
    const stageLabel = (svc && svc.getStageLabel) ? svc.getStageLabel(bounty.level) : String(bounty.level);

    const card = sqNode('button', undefined, 'dialog-item');
    card.type = 'button';
    card.setAttribute('aria-pressed', 'true');
    card.append(
        sqNode('span', bounty.enemyName || '悬赏目标', 'dialog-item-name'),
        sqNode('span', suspended ? '暂缓' : '进行中', 'dialog-item-badge')
    );
    list.append(card);

    detail.append(sqNode('h3', '悬赏缉拿：' + (bounty.enemyName || '')));
    const meta = sqNode('div', undefined, 'dialog-meta');
    meta.append(
        sqNode('p', '所在地：' + (bounty.locationName || '未知')),
        sqNode('p', '武学修为：' + stageLabel),
        sqNode('p', '赏格：声望+' + (bounty.reputationReward ?? 0) + '　赏金+' + (bounty.goldReward ?? 0))
    );
    detail.append(meta);
    detail.append(sqNode('p', '目标：下山前往「' + (bounty.locationName || '') + '」缉拿' + (bounty.enemyName || '悬赏目标'), 'sq-goal'));
    if (bounty.description) detail.append(sqNode('p', bounty.description));
    if (suspended) {
        detail.append(sqNode('p', '当前支线与此悬赏同在一地，悬赏暂缓；支线了结或地点不再相同后自动恢复。', 'dialog-empty'));
    }

    const abandonBtn = sqNode('button');
    abandonBtn.type = 'button';
    abandonBtn.dataset.tiAction = 'abandon-bounty';
    abandonBtn.textContent = '放弃悬赏';
    abandonBtn.className = 'sq-abandon-btn';
    actions.append(abandonBtn);
}

function _tiAbandonBounty() {
    const svc = (typeof bountyService !== 'undefined') ? bountyService : null;
    if (!svc || !svc.abandonBounty || !_tiActiveBounty()) return;
    svc.abandonBounty(_sqRerenderAll);
}

/* ---------- 叹号按钮：有悬赏/支线时金橘色 ---------- */

function updateTaskInfoButton() {
    const btn = document.getElementById('viewport-task-btn');
    if (!btn) return;
    const svc = _sqSvc();
    const hasTask = !!_tiActiveBounty() || !!(svc && svc.getActive && svc.getActive());
    if (btn.classList.contains('has-task') !== hasTask) btn.classList.toggle('has-task', hasTask);
    const label = hasTask ? '任务信息（有进行中的任务）' : '任务信息';
    if (btn.title !== label) { btn.title = label; btn.setAttribute('aria-label', label); }
}

// 悬赏接取/结算/放弃、读档、支线推进分散在多处模块，统一用轻量轮询兜底同步按钮颜色
function startTaskInfoButtonWatch() {
    updateTaskInfoButton();
    setInterval(updateTaskInfoButton, 1000);
}

function showTaskInfoPanel(tab) {
    if (typeof closeAllSpecialModals === 'function') closeAllSpecialModals();
    const svc = _sqSvc();
    if (tab === 'bounty' || tab === 'active' || tab === 'history') {
        currentTaskInfoTab = tab;
    } else if (_tiActiveBounty()) {
        currentTaskInfoTab = 'bounty';
    } else if (svc && svc.getActive && svc.getActive()) {
        currentTaskInfoTab = 'active';
    } else {
        currentTaskInfoTab = 'bounty';
    }
    renderTaskInfoPanel();
    taskInfoPanel.api.open(document.activeElement);
}

function closeTaskInfoPanel() {
    taskInfoPanel.api && taskInfoPanel.api.close();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSideQuestUi);
} else {
    initSideQuestUi();
}
