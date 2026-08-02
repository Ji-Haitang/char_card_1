/**
 * bounty-service.js - 悬赏任务系统（仅 index 独立前端链路）
 *
 * 在议事厅生成悬赏通缉令，接取后在大地图对应地点触发定向战斗，
 * 根据战斗结果获得声望和赏金奖励。
 *
 * 依赖：apiService, gameData/activeBounty（game-state.js）, showModal/showConfirmModal（game-ui.js）
 */

var bountyService = (function() {

    var _currentBountyList = [];  // 本次生成的任务列表，不持久化
    var _generating = false;

    var BOUNTY_LOCATIONS = ['高昌', '沙州', '龟兹', '伊州', '哈密绿洲', '月牙泉'];  // 兜底列表：声望数据缺失时使用

    // 地点声望门槛（低于此值无法前往），与 world_map.html 的 locationReputationThreshold 保持一致
    var LOCATION_REPUTATION_THRESHOLD = {
        '天山派外堡': 0,
        '博格达峰': 200,
        '伊州': 10,
        '哈密绿洲': 30,
        '高昌': 90,
        '迪坎儿村': 20,
        '大沙海': 100,
        '博斯坦村': 20,
        '沙州': 110,
        '瓜州': 130,
        '龟兹': 80,
        '崆峒派': 60,
        '昆仑派': 70,
        '拜火教总坛': 150,
        '白驼山': 120,
        '月牙泉': 40,
        '千佛洞': 50
    };

    // 根据玩家当前声望动态计算可前往地点；声望缺失时回退兜底列表
    function _getAvailableBountyLocations() {
        var rep = (typeof playerStats !== 'undefined' && playerStats && typeof playerStats.声望 === 'number') ? playerStats.声望 : null;
        if (rep === null) return BOUNTY_LOCATIONS;
        var list = Object.keys(LOCATION_REPUTATION_THRESHOLD).filter(function(name) {
            return rep >= LOCATION_REPUTATION_THRESHOLD[name];
        });
        return list.length >= 3 ? list : BOUNTY_LOCATIONS;
    }

    var BOUNTY_SYSTEM_PROMPT =
        '你是武侠世界的悬赏公告栏。请生成3名不同的悬赏通缉犯。要求：\n' +
        '- 风格贴近北宋初期西域武侠风格\n' +
        '- 人名/绰号有江湖气息，绰号可从外貌特征、所用兵器、行事作风等方向着意，3人之间风格各异\n' +
        '- 罪行描述简洁有画面感，不超过50字\n' +
        '- 3人的罪行性质互有区分，劫财、害命、叛门、窃宝等不同方向错开，避免雷同\n' +
        '严格按 JSON 格式输出，不输出任何其他文字。';

    // =========================================================================
    // API 调用（按 apiService.getConfig().streamMode 动态选择流式/非流式，同 summary-runner.js）
    // =========================================================================
    function _sendForBounty(messages) {
        var streamMode = (apiService.getConfig && apiService.getConfig().streamMode) || 'stream';
        if (streamMode !== 'stream') {
            return apiService.sendMessages(messages, { maxOutputTokens: null });
        }
        return new Promise(function(resolve, reject) {
            apiService.sendMessagesStream(messages, {
                onToken: function() {},
                onThinking: function() {},
                onComplete: function(fullText, usage) { resolve({ content: fullText, usage: usage }); },
                onError: function(err) { reject(err); }
            }, { maxOutputTokens: null });
        });
    }

    // 武学阶段定义（index → 点数区间 + 中文境界名），与 turn-based-battle-new.html 的 WUXUE_STAGE_DEFS 保持一致
    var WUXUE_STAGE_DEFS = [
        { index: 0, pointsRange: [0, 7], label: '未曾习武' },
        { index: 1, pointsRange: [8, 11], label: '初学乍练' },
        { index: 2, pointsRange: [12, 14], label: '小有所成' },
        { index: 3, pointsRange: [15, 17], label: '融会贯通' },
        { index: 4, pointsRange: [18, 20], label: '驾轻就熟' },
        { index: 5, pointsRange: [21, 22], label: '登堂入室' },
        { index: 6, pointsRange: [23, 24], label: '炉火纯青' },
        { index: 7, pointsRange: [25, 26], label: '一代宗师' },
        { index: 8, pointsRange: [27, 28], label: '登峰造极' },
        { index: 9, pointsRange: [29, 30], label: '武林至尊' }
    ];

    // 根据玩家武学值计算悬赏敌人 level 范围 [下限, 上限]
    // 链路：武学 → calculateLevelFromWuxue(game-utils.js) 得属性点数 → 查阶段 index → [index-2, index+1]（钳制在 0-9）
    function _getBountyLevelRange() {
        var wuxue = (typeof playerStats !== 'undefined' && playerStats && typeof playerStats.武学 === 'number') ? playerStats.武学 : 0;
        var points = (typeof calculateLevelFromWuxue === 'function') ? calculateLevelFromWuxue(wuxue) : 0;
        var stageIndex = 0;
        for (var i = 0; i < WUXUE_STAGE_DEFS.length; i++) {
            var r = WUXUE_STAGE_DEFS[i].pointsRange;
            if (points >= r[0] && points <= r[1]) { stageIndex = i; break; }
        }
        return [Math.max(0, stageIndex - 2), Math.min(9, stageIndex + 1)];
    }

    // 本次悬赏的预掷参数（生成时 roll 好，解析 LLM 结果后再拼接落库）
    var _pendingBountyParams = null;

    function _rollInt(min, max) {
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    // 预掷 3 个敌人的 所在地（互不重复）与 level（不完全相同），返回 [{locationName, level}]
    function _rollBountyParams() {
        var available = _getAvailableBountyLocations().slice();
        // 洗牌后取前 3 个，保证地点互不重复
        for (var i = available.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = available[i]; available[i] = available[j]; available[j] = t;
        }
        var range = _getBountyLevelRange();
        var levels = [];
        var allSame = range[0] === range[1];  // 范围只有 1 个值时无法保证"不完全相同"
        do {
            levels = [_rollInt(range[0], range[1]), _rollInt(range[0], range[1]), _rollInt(range[0], range[1])];
        } while (!allSame && levels[0] === levels[1] && levels[1] === levels[2]);
        return [0, 1, 2].map(function(k) {
            return { locationName: available[k], level: levels[k] };
        });
    }

    function _stageLabel(level) {
        var def = WUXUE_STAGE_DEFS[level];
        return def ? def.label : WUXUE_STAGE_DEFS[0].label;
    }

    function _buildUserPrompt() {
        var year = Math.floor((currentWeek - 1) / 48) + 1;
        var remaining = (currentWeek - 1) % 48;
        var month = Math.floor(remaining / 4) + 1;
        var week = remaining % 4 + 1;
        var seasonText = (typeof seasonNameMap !== 'undefined' && seasonNameMap[seasonStatus]) || '冬天';

        var params = _rollBountyParams();
        _pendingBountyParams = params;
        var names = ['敌人A', '敌人B', '敌人C'];
        var enemyLines = params.map(function(p, i) {
            return '    ' + names[i] + ':\n' +
                '      所在地: ' + p.locationName + '\n' +
                '      武学境界: ' + _stageLabel(p.level);
        }).join('\n');

        return '当前游戏背景：北宋初期，西域陇右武林\n' +
            '参考信息:\n' +
            '  时间: 第' + year + '年第' + month + '月第' + week + '周\n' +
            '  季节: ' + seasonText + '\n' +
            '  敌人信息:\n' +
            enemyLines + '\n' +
            '格式要求:\n' +
            '  直接输出JSON，不加任何markdown代码块，结构如下：\n' +
            '  {"bounties":[\n' +
            '    {"enemyName":"...","description":"..."},\n' +
            '    {"enemyName":"...","description":"..."},\n' +
            '    {"enemyName":"...","description":"..."}\n' +
            '  ]}\n' +
            '  bounties数组顺序须与敌人A/B/C一一对应，只需输出敌人的名称与罪行描述\n' +
            '内容要求:\n' +
            '  - 风格贴近北宋初期西域武侠风格\n' +
            '  - enemyName为目标的人名/绰号，须有江湖气息；绰号可从外貌特征、所用兵器、行事作风等方向着意，3人风格各异\n' +
            '  - description为目标的罪行描述，简洁有画面感，50字以内；3人的罪行性质互有区分，劫财、害命、叛门、窃宝等不同方向错开，富有创意，避免雷同\n' +
            '  - 每个目标的enemyName与description应结合其所在地与武学境界，输出合理自洽的内容\n\n' +
            '请依据上述信息生成三个敌人的名称和描述，直接输出JSON，不加任何markdown代码块';
    }

    // 提取 JSON 字符串（容错 markdown 代码块包裹的情况）
    function _parseBountyResponse(text) {
        var cleaned = String(text || '').replace(/```json|```/g, '').trim();
        var data = JSON.parse(cleaned);
        if (!Array.isArray(data.bounties) || data.bounties.length === 0) throw new Error('格式无效');
        return data.bounties;
    }

    // 依据 level 在 ±20% 随机浮动内生成奖励（不再由 LLM 生成）
    // reputationReward = (level + 1) * 4 * [0.8~1.2]，goldReward = (level + 1) * 500 * [0.8~1.2]
    function _rollBountyRewards(level) {
        var lv = Number(level);
        if (!Number.isFinite(lv) || lv < 0) lv = 0;
        return {
            reputationReward: Math.round((lv + 1) * 4 * (0.8 + Math.random() * 0.4)),
            goldReward: Math.round((lv + 1) * 500 * (0.8 + Math.random() * 0.4))
        };
    }

    // =========================================================================
    // 弹窗渲染
    // =========================================================================
    function _escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 本周是否已接过悬赏（额度每周1个，不随跨周累计/回补）
    function _bountyWeeklyUsed() {
        return (typeof lastBountyAcceptWeek !== 'undefined') && lastBountyAcceptWeek === currentWeek;
    }

    function _renderBountyModal() {
        var container = document.getElementById('bounty-list-container');
        var genBtn = document.getElementById('bounty-generate-btn');
        var abBtn = document.getElementById('bounty-abandon-btn');
        if (!container) return;

        if (typeof activeBounty !== 'undefined' && activeBounty) {
            container.innerHTML =
                '<div class="bounty-card bounty-card-active">' +
                    '<div class="bounty-card-tag">进行中</div>' +
                    '<div class="bounty-card-title">⚔ ' + _escapeHtml(activeBounty.enemyName) + '</div>' +
                    '<div class="bounty-card-desc">' + _escapeHtml(activeBounty.description) + '</div>' +
                    '<div class="bounty-card-info">地点：' + _escapeHtml(activeBounty.locationName) + '　武学修为：' + _escapeHtml(_stageLabel(activeBounty.level)) + '</div>' +
                    '<div class="bounty-card-reward">声望+' + _escapeHtml(activeBounty.reputationReward) + '　赏金+' + _escapeHtml(activeBounty.goldReward) + '</div>' +
                '</div>';
            if (genBtn) genBtn.style.display = 'none';
            if (abBtn) abBtn.style.display = 'inline-block';
        } else if (_bountyWeeklyUsed()) {
            // 本周额度已用（成功/失败/放弃均不返还）
            container.innerHTML = '<div class="bounty-empty-tip">本周已接取过悬赏任务，无论成败下周再来吧</div>';
            if (genBtn) genBtn.style.display = 'none';
            if (abBtn) abBtn.style.display = 'none';
        } else {
            if (_currentBountyList.length === 0) {
                container.innerHTML = '<div class="bounty-empty-tip">暂无悬赏任务，点击下方"查看悬赏"生成</div>';
            } else {
                container.innerHTML = _currentBountyList.map(function(task, idx) {
                    return '<div class="bounty-card" onclick="bountyService.acceptBounty(' + idx + ')">' +
                        '<div class="bounty-card-title">⚔ ' + _escapeHtml(task.enemyName) + '</div>' +
                        '<div class="bounty-card-desc">' + _escapeHtml(task.description) + '</div>' +
                        '<div class="bounty-card-info">地点：' + _escapeHtml(task.locationName) + '　武学修为：' + _escapeHtml(_stageLabel(task.level)) + '</div>' +
                        '<div class="bounty-card-reward">声望+' + _escapeHtml(task.reputationReward) + '　赏金+' + _escapeHtml(task.goldReward) + '</div>' +
                    '</div>';
                }).join('');
            }
            if (genBtn) genBtn.style.display = 'inline-block';
            if (abBtn) abBtn.style.display = 'none';
        }
    }

    // =========================================================================
    // 对外暴露的函数
    // =========================================================================

    function showBountyModal() {
        var modal = document.getElementById('bounty-modal');
        if (!modal) return;
        // 搬到 body，避免受 #main-viewport 的裁剪/层级影响（同汗青集弹窗）
        if (modal.parentElement !== document.body) {
            document.body.appendChild(modal);
        }
        _renderBountyModal();
        modal.style.display = 'block';
        // 一帧后适配尺寸并绑定自动适配（tallModalIds 已含 bounty-modal，高度突破 viewport 至 container 底边）
        requestAnimationFrame(function() {
            if (typeof fitModalToViewport === 'function') fitModalToViewport(modal);
            if (typeof bindModalAutoFit === 'function') bindModalAutoFit(modal);
        });
    }

    function closeBountyModal() {
        var modal = document.getElementById('bounty-modal');
        if (!modal) return;
        modal.style.display = 'none';
        if (modal._unbindFit) modal._unbindFit();
    }

    async function generateBountyTasks() {
        if (_generating) return;
        if (_bountyWeeklyUsed()) { showModal('本周已接取过悬赏任务，下周再来吧'); _renderBountyModal(); return; }
        if (typeof activeBounty !== 'undefined' && activeBounty) { showModal('已有进行中的悬赏任务'); _renderBountyModal(); return; }
        _generating = true;
        var genBtn = document.getElementById('bounty-generate-btn');
        var container = document.getElementById('bounty-list-container');
        if (genBtn) { genBtn.disabled = true; genBtn.textContent = '生成中...'; }
        if (container) container.innerHTML = '<div class="bounty-empty-tip">生成中...</div>';

        try {
            var userPrompt = _buildUserPrompt();
            console.log('[BountyService] 预掷悬赏参数:', JSON.parse(JSON.stringify(_pendingBountyParams)));
            console.log('[BountyService] 发起悬赏请求 messages:', [
                { role: 'system', content: BOUNTY_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt }
            ]);
            var messages = [
                { role: 'system', content: BOUNTY_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt }
            ];
            var result = await _sendForBounty(messages);
            console.log('[BountyService] LLM 原始回复:', result.content);
            var bounties = _parseBountyResponse(result.content);
            var params = _pendingBountyParams || [];
            if (bounties.length !== params.length) throw new Error('悬赏数量与预掷参数不匹配');
            // LLM 只产出 enemyName/description，所在地与等级用预掷参数拼接，奖励按 level 随机生成
            bounties.forEach(function(task, i) {
                task.locationName = params[i].locationName;
                task.level = params[i].level;
                var rewards = _rollBountyRewards(task.level);
                task.reputationReward = rewards.reputationReward;
                task.goldReward = rewards.goldReward;
            });
            console.log('[BountyService] 拼接完成后的悬赏列表:', JSON.parse(JSON.stringify(bounties)));
            _currentBountyList = bounties;
            _renderBountyModal();
        } catch (e) {
            console.error('[BountyService] generateBountyTasks 失败:', e);
            _currentBountyList = [];
            _renderBountyModal();
            showModal('生成失败，请重试');
        } finally {
            _generating = false;
            _pendingBountyParams = null;
            if (genBtn) { genBtn.disabled = false; genBtn.textContent = '查看悬赏'; }
        }
    }

    function acceptBounty(idx) {
        var task = _currentBountyList[idx];
        if (!task) return;
        if (_bountyWeeklyUsed()) { showModal('本周已接取过悬赏任务，下周再来吧'); _renderBountyModal(); return; }
        var msg = '确定要接下对"' + _escapeHtml(task.enemyName) + '"的悬赏吗？<br>' +
            '所在地：' + _escapeHtml(task.locationName) + '　武学修为：' + _escapeHtml(_stageLabel(task.level)) + '<br>' +
            '声望+' + _escapeHtml(task.reputationReward) + '　赏金+' + _escapeHtml(task.goldReward) + '<br>' +
            '（每周限接1次，接下后无论成败本周不可再接）';
        showConfirmModal('接下悬赏', msg, function() {
            activeBounty = {
                enemyName: task.enemyName,
                locationName: task.locationName,
                level: task.level,
                description: task.description,
                reputationReward: task.reputationReward,
                goldReward: task.goldReward
            };
            lastBountyAcceptWeek = currentWeek;  // 记录接取周数，本周额度用尽
            console.log('[BountyService] 已接取悬赏 (第' + currentWeek + '周):', JSON.parse(JSON.stringify(activeBounty)));
            _currentBountyList = [];
            if (typeof syncGameDataFromVariables === 'function') syncGameDataFromVariables();
            closeBountyModal();
        });
    }

    function abandonBounty() {
        if (typeof activeBounty === 'undefined' || !activeBounty) return;
        var enemyName = activeBounty.enemyName;
        showConfirmModal('放弃悬赏', '确定要放弃当前悬赏任务"' + _escapeHtml(enemyName) + '"吗？', function() {
            activeBounty = null;
            if (typeof syncGameDataFromVariables === 'function') syncGameDataFromVariables();
            showBountyModal();
        });
    }

    return {
        showBountyModal: showBountyModal,
        closeBountyModal: closeBountyModal,
        generateBountyTasks: generateBountyTasks,
        acceptBounty: acceptBounty,
        abandonBounty: abandonBounty
    };
})();

window.showBountyModal = bountyService.showBountyModal;
window.closeBountyModal = bountyService.closeBountyModal;
window.generateBountyTasks = bountyService.generateBountyTasks;
window.abandonBounty = bountyService.abandonBounty;
