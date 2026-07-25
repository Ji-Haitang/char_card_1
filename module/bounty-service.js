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

    var BOUNTY_LOCATIONS = ['高昌', '沙州', '龟兹', '伊州', '哈密绿洲', '月牙泉'];

    var BOUNTY_SYSTEM_PROMPT =
        '你是武侠世界的悬赏公告栏。请生成3张不同的悬赏通缉令。要求：\n' +
        '- 风格贴近五代十国末期西域武侠风格\n' +
        '- 人名/绰号有江湖气息\n' +
        '- 罪行描述简洁有画面感，不超过50字\n' +
        '- 地点必须从给定的列表中选择\n' +
        '- 难度分布合理，3个任务等级不完全相同\n' +
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

    function _buildUserPrompt() {
        var year = Math.floor((currentWeek - 1) / 48) + 1;
        var remaining = (currentWeek - 1) % 48;
        var month = Math.floor(remaining / 4) + 1;
        var week = remaining % 4 + 1;
        var seasonText = (typeof seasonNameMap !== 'undefined' && seasonNameMap[seasonStatus]) || '冬天';
        var wuxue = (typeof playerStats !== 'undefined' && playerStats && typeof playerStats.武学 === 'number') ? playerStats.武学 : 0;

        return '当前游戏背景：北宋初期，西域天山派。\n' +
            '玩家当前武学值：' + wuxue + '（0-100）。\n' +
            '本周：第' + year + '年第' + month + '月第' + week + '周，季节：' + seasonText + '。\n\n' +
            '可选地点列表：' + BOUNTY_LOCATIONS.join('、') + '\n' +
            '（地点名称必须与 world_map.html 的地点 key 完全一致，如实际 key 为\'沙州\'而非\'沙洲城\'）\n\n' +
            '请生成3张悬赏通缉令，JSON格式如下（直接输出JSON，不加任何markdown代码块）：\n' +
            '{"bounties":[\n' +
            '  {"enemyName":"...","locationName":"高昌","level":3,"description":"...","reputationReward":15,"goldReward":300},\n' +
            '  {"enemyName":"...","locationName":"沙州","level":5,"description":"...","reputationReward":25,"goldReward":500},\n' +
            '  {"enemyName":"...","locationName":"哈密绿洲","level":7,"description":"...","reputationReward":35,"goldReward":700}\n' +
            ']}\n\n' +
            'level建议参考玩家武学值：武学<20对应1-3级，武学20-50对应2-5级，武学50-80对应3-7级，武学>80对应5-9级。\n' +
            'reputationReward约为level×5，goldReward约为level×100。';
    }

    // 提取 JSON 字符串（容错 markdown 代码块包裹的情况）
    function _parseBountyResponse(text) {
        var cleaned = String(text || '').replace(/```json|```/g, '').trim();
        var data = JSON.parse(cleaned);
        if (!Array.isArray(data.bounties) || data.bounties.length === 0) throw new Error('格式无效');
        return data.bounties;
    }

    // =========================================================================
    // 弹窗渲染
    // =========================================================================
    function _escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
                    '<div class="bounty-card-info">地点：' + _escapeHtml(activeBounty.locationName) + '　等级：' + _escapeHtml(activeBounty.level) + '</div>' +
                    '<div class="bounty-card-reward">声望+' + _escapeHtml(activeBounty.reputationReward) + '　赏金+' + _escapeHtml(activeBounty.goldReward) + '</div>' +
                '</div>';
            if (genBtn) genBtn.style.display = 'none';
            if (abBtn) abBtn.style.display = 'inline-block';
        } else {
            if (_currentBountyList.length === 0) {
                container.innerHTML = '<div class="bounty-empty-tip">暂无悬赏任务，点击下方"发布悬赏"生成</div>';
            } else {
                container.innerHTML = _currentBountyList.map(function(task, idx) {
                    return '<div class="bounty-card" onclick="bountyService.acceptBounty(' + idx + ')">' +
                        '<div class="bounty-card-title">⚔ ' + _escapeHtml(task.enemyName) + '</div>' +
                        '<div class="bounty-card-desc">' + _escapeHtml(task.description) + '</div>' +
                        '<div class="bounty-card-info">地点：' + _escapeHtml(task.locationName) + '　等级：' + _escapeHtml(task.level) + '</div>' +
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
        _renderBountyModal();
        modal.style.display = 'block';
    }

    function closeBountyModal() {
        var modal = document.getElementById('bounty-modal');
        if (modal) modal.style.display = 'none';
    }

    async function generateBountyTasks() {
        if (_generating) return;
        _generating = true;
        var genBtn = document.getElementById('bounty-generate-btn');
        var container = document.getElementById('bounty-list-container');
        if (genBtn) { genBtn.disabled = true; genBtn.textContent = '生成中...'; }
        if (container) container.innerHTML = '<div class="bounty-empty-tip">生成中...</div>';

        try {
            var messages = [
                { role: 'system', content: BOUNTY_SYSTEM_PROMPT },
                { role: 'user', content: _buildUserPrompt() }
            ];
            var result = await _sendForBounty(messages);
            var bounties = _parseBountyResponse(result.content);
            _currentBountyList = bounties;
            _renderBountyModal();
        } catch (e) {
            console.error('[BountyService] generateBountyTasks 失败:', e);
            _currentBountyList = [];
            _renderBountyModal();
            showModal('生成失败，请重试');
        } finally {
            _generating = false;
            if (genBtn) { genBtn.disabled = false; genBtn.textContent = '发布悬赏'; }
        }
    }

    function acceptBounty(idx) {
        var task = _currentBountyList[idx];
        if (!task) return;
        activeBounty = {
            enemyName: task.enemyName,
            locationName: task.locationName,
            level: task.level,
            description: task.description,
            reputationReward: task.reputationReward,
            goldReward: task.goldReward
        };
        _currentBountyList = [];
        if (typeof syncGameDataFromVariables === 'function') syncGameDataFromVariables();
        closeBountyModal();
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
