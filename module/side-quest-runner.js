/**
 * side-quest-runner.js - 暗线/支线剧情系统：LLM 调度层（Runner 范式照抄 event-runner.js）
 *
 * 职责：
 *   - generateRumors()   打探传闻（210，生成候选不占额度、可反复换批；候选仅存内存仿 _pendingBountyParams）
 *   - acceptRumor(idx)   接取建树（接取时记周额度，失败不返还，保留当前传闻供手动重试）
 *   - afterCommit(parsed, meta)  每轮主对话提交后的支线判定主流程（212 + 前置过滤链）
 *   - cancel() / resumeOnLoad()
 *
 * 主流程等待 afterCommit 落定：判定期间保持正文遮罩与输入锁；_running 互斥 + _abortController 取消。
 * 同请求失败后每隔 1000ms 重试，最多重试 3 次；仍失败则返回 false、跳过自动存档并提示重新生成。
 *
 * regenerate/读档防护：uiIndex 水位线 + questId 双校验，过期判定结果直接丢弃。
 *
 * 依赖：side-quest-service.js, api-service.js, response-parser.js, json-repair-helper.js,
 *        template-engine.js, prompt-data-extra.js(PROMPT_SQ_*), prompt-overrides.js,
 *        game-state.js, storage-service.js, game-ui.js(showModal/showConfirmModal)
 */

var sideQuestRunner = (function() {

    var _running = false;            // 判定 LLM 飞行中
    var _abortController = null;     // 飞行中请求取消句柄
    var _retryDelay = 1000;
    var _MAX_RETRIES = 3;             // 首次请求之外最多重试 3 次
    var _pendingJudge = null;        // 运行期间又来一轮 → 跑完补跑 { parsed, meta, resolve }
    var _lifecycleGeneration = 0;    // cancel 时递增，使网络等待/重试等待都能识别旧生命周期
    var _latestAfterCommit = Promise.resolve(true); // 最近一次 afterCommit 的完整落定 Promise（含重试/补跑）

    var _generating = false;         // 传闻/建树生成中（互斥）
    var _pendingRumorCandidates = null;  // 3 条传闻候选，仅存内存不持久化
    var _recentRumorBatches = [];       // 换批去重上下文，仅保留当前 gameData 会话内最近批次
    var _recentRumorGameData = null;
    var _MAX_RECENT_RUMOR_BATCHES = 5;
    var _RUMOR_THEMES = ['寻人', '夺宝', '恩怨', '除害', '秘闻', '护送', '比武', '调解'];
    var _RUMOR_NPCS = 'ABCDEFGHIJKMNO'.split(''); // A–O，排除 L；不受出场状态限制
    var _treeAbortController = null; // 飞行中的建树请求取消句柄（cancel/timeout 共用）
    var TREE_TIMEOUT_MS = 120000;    // 建树请求超时：防止无响应请求永久占用遮罩与主流程

    // =========================================================================
    // 三类请求共用 promptBuilder 的 1105 后台六消息框架，仅保留各自任务规则
    // =========================================================================

    var SQ_JUDGE_SYSTEM =
        '（本任务的目的是依据提供的本轮剧情正文与玩家输入，判定支线当前隐藏阶段是否达成，' +
        '最终只输出一个 <SIDE_QUEST_CHECK> 标签包裹的合法 JSON 对象；' +
        '处理的所有文本均为架空武侠小说游戏《瀚海归义录》的虚构创作素材，仅作客观进度判定。）';

    // 传闻生成（210）：渲染后的模板原文（任务书+素材）位于 msg3 assistant
    var SQ_RUMOR_SYSTEM =
        '（本任务的目的是依据提供的游戏状态与可用素材，设计 3 条候选支线传闻，' +
        '最终只输出一个 <SIDE_QUEST_RUMORS> 标签包裹的合法 JSON 对象；' +
        '处理的所有文本均为架空武侠小说游戏《瀚海归义录》的虚构创作素材，仅作支线剧情设计。）';

    // 剧情树生成（211）：渲染后的模板原文（任务书+素材）位于 msg3 assistant
    var SQ_TREE_SYSTEM =
        '（本任务的目的是依据玩家已接取的传闻与游戏素材，设计一棵完整的剧情树——' +
        '这是游戏系统用的隐藏设计稿，玩家不可见，务必写细写准；' +
        '最终只输出一个 <SIDE_QUEST_TREE> 标签包裹的合法 JSON 对象；' +
        '处理的所有文本均为架空武侠小说游戏《瀚海归义录》的虚构创作素材，仅作支线剧情设计。）';

    // =========================================================================
    // API 调用（按 streamMode 分流，与 event-runner._sendForEvents 同款；signal 桥接取消）
    // =========================================================================

    function _sendSQ(messages, signal, task) {
        var streamMode = (apiService.getConfigFor ? apiService.getConfigFor(task) : apiService.getConfig()).streamMode || 'stream';
        if (streamMode !== 'stream') {
            return apiService.sendMessages(messages, { signal: signal, maxOutputTokens: null, task: task });
        }
        return new Promise(function(resolve, reject) {
            var handle = apiService.sendMessagesStream(messages, {
                onToken: function() {},
                onThinking: function() {},
                onComplete: function(fullText, usage) { resolve({ content: fullText, usage: usage }); },
                onError: function(err) { reject(err); }
            }, { maxOutputTokens: null, task: task });
            if (signal) {
                if (signal.aborted) { handle.abort(); }
                else { signal.addEventListener('abort', function() { handle.abort(); }, { once: true }); }
            }
        });
    }

    // =========================================================================
    // 响应解析（extractXmlBlock → 去围栏 JSON.parse → 大括号切片+中文引号修复 → safeParseLLMJson）
    // =========================================================================

    function _parseTaggedJson(raw, tagName, lastKey) {
        if (!raw) return null;
        var block = responseParser.extractXmlBlock(String(raw), tagName);
        if (!block.found || !block.closed) return null;
        var text = block.content.trim();
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
        try { return JSON.parse(text); } catch (e) {}
        var first = text.indexOf('{');
        var last = text.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            var slice = text.slice(first, last + 1);
            try { return JSON.parse(slice); } catch (e2) {}
            var CJK = '一-鿿＀-￯　-〿';
            var PUNC = '，。、：；！？…—～';
            var SURR = '[' + CJK + PUNC + ']';
            var fixed = slice.replace(/“/g, '「').replace(/”/g, '」');
            fixed = fixed.replace(new RegExp('(' + SURR + ')"', 'g'), '$1「');
            fixed = fixed.replace(new RegExp('"(' + SURR + ')', 'g'), '」$1');
            try { return JSON.parse(fixed); } catch (e3) {}
        }
        if (window.safeParseLLMJson) {
            return window.safeParseLLMJson(text, {
                lastKey: lastKey,
                onRepaired: function(layer) {
                    console.warn('[SideQuest] json repaired (layer ' + layer + '), 但是最后字段校验通过');
                }
            });
        }
        return null;
    }

    function _renderTemplate(tpl, ctx) {
        return templateEngine.renderPromptTemplate(tpl, ctx);
    }

    function _poText(key, fallback) {
        return (typeof promptOverrides !== 'undefined') ? promptOverrides.get(key, fallback) : fallback;
    }

    // =========================================================================
    // 打探传闻（210）
    // =========================================================================

    /** 候选与去重记忆不跨存档对象；不写入世界事实、任务历史或持久化数据。 */
    function _syncRumorSession() {
        var gd = typeof gameData !== 'undefined' ? gameData : null;
        if (_recentRumorGameData !== gd) {
            _recentRumorGameData = gd;
            _recentRumorBatches = [];
            _pendingRumorCandidates = null;
        }
        return gd;
    }

    function _rememberRumorBatch(rumors) {
        var brief = function(value, limit) {
            return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
        };
        // 独立快照防止接取/建树修改当前候选；字段限长避免模型异常长输出撑大下一次请求。
        _recentRumorBatches.push(rumors.map(function(rumor) {
            return {
                title: brief(rumor.title, 60),
                location: brief(rumor.relatedLocations[0], 80),
                background: brief(rumor.background, 300),
                playerGoal: brief(rumor.playerGoal, 160)
            };
        }));
        if (_recentRumorBatches.length > _MAX_RECENT_RUMOR_BATCHES) _recentRumorBatches.shift();
    }

    /** 每次请求只抽一次；正常池内不重复，地点不足三处时用已开放地点补足。 */
    function _rollThree(values) {
        if (!values.length) throw new Error('当前没有可前往的支线地点');
        var remaining = values.slice();
        var picks = [];
        while (picks.length < 3) {
            if (!remaining.length) remaining = values.slice();
            var index = Math.floor(Math.random() * remaining.length);
            picks.push(remaining.splice(index, 1)[0]);
        }
        return picks;
    }

    function _buildRumorCtx() {
        var ctx = sideQuestService.buildSharedCtx();
        ctx.sqRumorThemes = _rollThree(_RUMOR_THEMES);
        ctx.sqRumorLocations = _rollThree(sideQuestService.getAccessibleLocations());
        ctx.sqRumorNpcs = _rollThree(_RUMOR_NPCS);
        // 旧的自定义 210 若仍引用 sqLocationList，也只看到本批地点。
        ctx.sqLocationList = ctx.sqRumorLocations.join('、');
        return ctx;
    }

    function _joinThree(values) {
        return values[0] + '、' + values[1] + '和' + values[2];
    }

    /** 默认模板已有抽选要求；旧自定义模板补齐要求，换批时另附历史候选。 */
    function _buildRumorRequestContext(ctx, taskContent) {
        var constraints = [
            '- 生成 3 条候选支线传闻，三条题材分别为' + _joinThree(ctx.sqRumorThemes),
            '- relatedLocations 必须且只能包含 1 个地点，3条传闻对应的地点分别为' + _joinThree(ctx.sqRumorLocations),
            '- relatedNpcs 用字母编号数组（如 ["E"]），无牵涉则空数组，本次可选的相关NPC为' + _joinThree(ctx.sqRumorNpcs),
            '- rumors 数组中的第 1、2、3 条分别对应上述第 1、2、3 个题材与地点；NPC 从本次三个编号中按剧情需要选择，不要求与传闻一一对应'
        ];
        var lines = constraints.filter(function(line) { return taskContent.indexOf(line) === -1; });
        if (lines.length) lines.unshift('本批预抽结果（若前文范围不同，以本段为准）：');
        if (_recentRumorBatches.length) {
            lines.push('', '<RecentRumorCandidates>',
                '近期已展示的候选传闻（仅用于避免重复，不代表这些事件已经发生）：');
            _recentRumorBatches.forEach(function(batch) {
                batch.forEach(function(rumor) {
                    lines.push('- ' + JSON.stringify(rumor).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'));
                });
            });
            lines.push('</RecentRumorCandidates>',
                '本次为换一批：避开上述候选的核心起因、冲突和任务目标，不续写这些未接取的候选。',
                '仅修改标题、地点、敌人称谓或道具名称，不算新题材。',
                '本次可选的地点为' + _joinThree(ctx.sqRumorLocations) + '，可选的相关NPC编号为' + _joinThree(ctx.sqRumorNpcs) +
                '。允许再次使用同一 NPC 或地点，但应设计不同的事件与人物诉求。');
        }
        return lines.length ? '\n\n' + lines.join('\n') : '';
    }

    /**
     * 生成 3 条候选支线传闻。接取前可重复生成换批。
     * @returns {Promise<Array|null>} rumors 数组；失败/被拦截返回 null
     */
    async function generateRumors() {
        if (!sideQuestService.isEnabled()) { _notify('支线系统未启用'); return null; }
        if (_generating) { console.log('[SideQuest] 生成中，忽略重复触发'); return null; }
        if (typeof pipeline !== 'undefined' && pipeline.isBusy && pipeline.isBusy()) {
            _notify('当前已有生成任务，请稍后再打探传闻');
            return null;
        }
        var active = sideQuestService.getActive();
        if (active) { _notify('一事未了——请先完成或放弃当前支线「' + active.title + '」'); return null; }
        if (sideQuestService.rumorRefreshUsed()) { _notify('本周已接取过支线，下周再来吧'); return null; }

        var rumorGameData = _syncRumorSession();
        var rumorBatches = _recentRumorBatches;
        var rumorGeneration = _lifecycleGeneration;
        var isCurrentRequest = function() {
            return rumorGeneration === _lifecycleGeneration && rumorBatches === _recentRumorBatches &&
                rumorGameData === (typeof gameData !== 'undefined' ? gameData : null);
        };
        _generating = true;
        try {
            var ctx = _buildRumorCtx();
            var tpl = _poText('SQ_RUMOR', (typeof PROMPT_SQ_RUMOR !== 'undefined') ? PROMPT_SQ_RUMOR : '');
            if (!tpl) throw new Error('PROMPT_SQ_RUMOR 未加载');
            // 运行时补齐抽选与去重上下文，自定义 210 模板也能收到；候选不是已发生的剧情。
            var taskContent = _renderTemplate(tpl, ctx);
            taskContent += _buildRumorRequestContext(ctx, taskContent);
            // 1105 六消息结构：渲染后的任务书与素材位于 msg3 assistant
            var messages = promptBuilder.buildBackgroundMessages({
                systemPrompt: SQ_RUMOR_SYSTEM,
                materialContent: taskContent,
                taskPrompt: '请生成 3 条候选支线传闻。',
                taskRules: [
                    '三条传闻题材互异，严格遵守生成要求中的字段与约束',
                    '严格遵循生成要求中给出的输出结构'
                ],
                outputTag: 'SIDE_QUEST_RUMORS',
                outputDescription: '候选支线传闻 JSON'
            });
            console.groupCollapsed('[SideQuest] ══ 发起传闻生成 ══');
            for (var ri = 0; ri < messages.length; ri++) {
                console.log('[SideQuest] [' + (ri + 1) + '] ' + messages[ri].role + ' (' + messages[ri].content.length + ' chars):\n' + messages[ri].content);
            }
            console.groupEnd();

            var result = await _sendSQ(messages, null, 'sideQuestRumor');
            var raw = (result && result.content) || '';
            console.groupCollapsed('[SideQuest] ══ 传闻生成回复 ══');
            console.log('[SideQuest] usage:', JSON.stringify(result && result.usage || null));
            console.log('[SideQuest] 原文:\n' + raw);
            console.groupEnd();

            if (!isCurrentRequest()) {
                console.log('[SideQuest] 传闻生成上下文已切换，丢弃过期候选');
                return null;
            }
            var parsed = _parseTaggedJson(raw, 'SIDE_QUEST_RUMORS', 'rumors');
            if (!parsed || !Array.isArray(parsed.rumors)) throw new Error('传闻 JSON 解析失败');
            var rumors = parsed.rumors.filter(function(r) {
                return r && r.title && r.background && r.playerGoal;
            });
            if (rumors.length < 3) throw new Error('有效传闻不足 3 条（实际 ' + rumors.length + '）');
            // 地点夹紧：每条新支线只保留一个当前可前往的合法地点。
            rumors.forEach(function(r) {
                r.relatedLocations = sideQuestService.sanitizeRelatedLocations(r.relatedLocations);
                if (['简单', '普通', '困难'].indexOf(r.difficulty) === -1) r.difficulty = '普通';
            });
            rumors = rumors.filter(function(r) { return r.relatedLocations.length === 1; });
            if (rumors.length < 3) throw new Error('具有合法唯一地点的传闻不足 3 条');
            rumors = rumors.slice(0, 3);
            // 保留模型原文含义：地点顺序或 NPC 超出本批抽选时整批拒绝，不强行改写字段。
            rumors.forEach(function(r, index) {
                if (r.relatedLocations[0] !== ctx.sqRumorLocations[index]) {
                    throw new Error('第 ' + (index + 1) + ' 条传闻未使用本批指定地点，请换一批重试');
                }
                var npcIds = Array.isArray(r.relatedNpcs) ? r.relatedNpcs : [];
                if (npcIds.some(function(id) { return ctx.sqRumorNpcs.indexOf(id) === -1; })) {
                    throw new Error('第 ' + (index + 1) + ' 条传闻使用了本批范围外的相关 NPC，请换一批重试');
                }
                r.relatedNpcs = sideQuestService.sanitizeRelatedNpcs(npcIds);
            });

            _rememberRumorBatch(rumors);
            _pendingRumorCandidates = rumors;
            if (sideQuestService.clearPendingTree) sideQuestService.clearPendingTree();
            console.log('[SideQuest] 传闻生成成功:', rumors.map(function(r) { return r.title; }).join('、'));
            return rumors;
        } catch (e) {
            if (!isCurrentRequest()) return null;
            console.error('[SideQuest] 传闻生成失败:', e);
            _notify('打探传闻失败：' + (e && e.message ? e.message : '请重试'));
            return null;
        } finally {
            _generating = false;
        }
    }

    function getRumorCandidates() {
        _syncRumorSession();
        if (_pendingRumorCandidates && _pendingRumorCandidates.length) return _pendingRumorCandidates;
        // 读档/刷新后候选已失，但已接取的传闻仍保存在存档里，保留手动重试入口
        var pt = (sideQuestService.getPendingTree) ? sideQuestService.getPendingTree() : null;
        return (pt && pt.rumor) ? [pt.rumor] : null;
    }

    /** 待重试建树的候选下标；-1 表示当前没有失败待重试的传闻 */
    function getTreeRetryIndex() {
        _syncRumorSession();
        var pt = (sideQuestService.getPendingTree) ? sideQuestService.getPendingTree() : null;
        if (!pt) return -1;
        if (_pendingRumorCandidates && _pendingRumorCandidates.length) return pt.index;
        return 0;  // 候选已失，仅剩持久化的这一条
    }

    // =========================================================================
    // 接取建树（211）
    // =========================================================================

    /**
     * 建树 messages：1105 六消息框架，渲染后的模板原文（任务书+素材）位于 msg3 assistant。
     */
    function _buildTreeMessages(rumor) {
        var ctx = sideQuestService.buildTreeCtx(rumor);
        var tpl = _poText('SQ_TREE', (typeof PROMPT_SQ_TREE !== 'undefined') ? PROMPT_SQ_TREE : '');
        if (!tpl) throw new Error('PROMPT_SQ_TREE 未加载');
        var taskContent = _renderTemplate(tpl, ctx);
        return promptBuilder.buildBackgroundMessages({
            systemPrompt: SQ_TREE_SYSTEM,
            materialContent: taskContent,
            taskPrompt: '请生成完整剧情树。',
            taskRules: [
                '剧情树硬约束必须全部满足，违反任何一条都将被系统拒绝',
                '严格遵循剧情树硬约束中给出的输出结构'
            ],
            outputTag: 'SIDE_QUEST_TREE',
            outputDescription: '完整剧情树 JSON'
        });
    }

    /**
     * 接取候选传闻 → 建树（失败保留额度与候选，允许手动重试）
     * @returns {Promise<boolean>} 是否接取成功
     */
    async function acceptRumor(idx) {
        if (!sideQuestService.isEnabled()) { _notify('支线系统未启用'); return false; }
        if (_generating) return false;
        if (typeof pipeline !== 'undefined' && pipeline.isBusy && pipeline.isBusy()) {
            _notify('当前已有生成任务，请稍后再接取支线');
            return false;
        }
        var candidates = getRumorCandidates();
        var rumor = candidates && candidates[idx];
        if (!rumor) { _notify('传闻候选已失效，请重新打探'); return false; }
        if (sideQuestService.getActive()) { _notify('已有进行中的支线'); return false; }
        var quotaUsed = sideQuestService.rumorRefreshUsed();
        if (quotaUsed && getTreeRetryIndex() !== idx) {
            _notify('本周已选择接取一条支线；若剧情树生成失败，只能重试已选择的这条传闻。');
            return false;
        }
        // 接取动作即占用本周额度；失败也不返还，但保留待建树记录以便手动重试。
        if (!quotaUsed) sideQuestService.markCurrentWeekUsed();
        if (sideQuestService.setPendingTree) sideQuestService.setPendingTree(rumor, idx);

        _generating = true;
        var busyShown = false;
        var timeoutId = null;
        try {
            if (typeof pipeline !== 'undefined' && pipeline.showBusyOverlay) {
                pipeline.showBusyOverlay('施延年伏案疾书');
                busyShown = true;
            }
            // 独立取消句柄：API 层无超时，缺少它时请求悬挂会永久占用遮罩与主流程
            _treeAbortController = new AbortController();
            var treeSignal = _treeAbortController.signal;
            timeoutId = setTimeout(function() {
                console.warn('[SideQuest] 剧情树请求超时，已中止');
                if (_treeAbortController) _treeAbortController.abort();
            }, TREE_TIMEOUT_MS);

            var tree = null;
            var lastErr = null;
            try {
                var messages = _buildTreeMessages(rumor);
                console.groupCollapsed('[SideQuest] ══ 发起剧情树生成 ══');
                for (var ti = 0; ti < messages.length; ti++) {
                    console.log('[SideQuest] [' + (ti + 1) + '] ' + messages[ti].role + ' (' + messages[ti].content.length + ' chars):\n' + messages[ti].content);
                }
                console.groupEnd();

                // 单次请求：失败后不自动重试，由玩家点击“重新生成剧情树”手动重试
                var result = await _sendSQ(messages, treeSignal, 'sideQuestTree');
                var raw = (result && result.content) || '';
                console.groupCollapsed('[SideQuest] ══ 剧情树回复 ══');
                console.log('[SideQuest] usage:', JSON.stringify(result && result.usage || null));
                console.log('[SideQuest] 原文:\n' + raw);
                console.groupEnd();

                var parsed = _parseTaggedJson(raw, 'SIDE_QUEST_TREE', 'nodes');
                if (!parsed) throw new Error('剧情树 JSON 解析失败');
                var check = sideQuestService.validateTree(parsed, rumor.difficulty);
                if (!check.ok) throw new Error('剧情树校验失败: ' + check.errors.join('；'));
                tree = parsed;
            } catch (e) {
                lastErr = e;
                var abortedReq = !!(e && (e.name === 'AbortError' || (treeSignal && treeSignal.aborted)));
                console.warn('[SideQuest] 剧情树生成' + (abortedReq ? '被中止/超时' : '失败') + ':', e && e.message ? e.message : e);
            }

            if (!tree) {
                var reason = (lastErr && lastErr.name === 'AbortError') ? '请求超时或被中止' : (lastErr ? lastErr.message : '未知错误');
                _notify('剧情树生成失败：' + _escapeHtml(reason) +
                    '<br>本周接取额度已使用。可点击“重新生成剧情树”重试这条传闻。');
                return false;
            }
            var accepted = sideQuestService.acceptQuest(rumor, tree);
            if (!accepted) {
                _notify('支线接取失败：传闻地点当前已不可前往。<br>本周接取额度仍已使用；恢复前往条件后，可重新生成这条传闻的剧情树。');
                return false;
            }
            _pendingRumorCandidates = null;
            if (sideQuestService.clearPendingTree) sideQuestService.clearPendingTree();
            _notify('已接取支线「' + rumor.title + '」\n目标：' + rumor.playerGoal);
            return true;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            _treeAbortController = null;
            if (busyShown && typeof pipeline !== 'undefined' && pipeline.hideBusyOverlay) {
                pipeline.hideBusyOverlay();
            }
            _generating = false;
        }
    }

    // =========================================================================
    // 判定主流程 afterCommit（方案书 §5.3）
    // =========================================================================

    /**
     * 每轮主对话提交后由 pipeline 等待，返回的 Promise 包含本轮判定（含失败重试）
     * 及被排队轮次的实际补跑。meta.onStatus 将各阶段提示交给本轮加载 UI。
     * resolve(false) 表示判定失败或被 cancel/新轮次取代，自动存档与手动导出不得保存旧状态。
     */
    function afterCommit(parsed, meta) {
        var task;
        try {
            task = _afterCommit(parsed, meta);
        } catch (e) {
            task = Promise.reject(e);
        }
        var tracked = Promise.resolve(task).catch(function(e) {
            console.error('[SideQuest] afterCommit 未捕获异常:', e);
            _notify('本轮支线判定未完成，自动存档已跳过，请重新生成本轮回复。');
            return false;
        });
        _latestAfterCommit = tracked;
        return tracked;
    }

    /** 手动保存/导出等待最新一轮支线后处理落定；新轮次进入时继续等待最新轮次。 */
    async function whenSettled() {
        while (true) {
            var task = _latestAfterCommit;
            var result = await task;
            if (task === _latestAfterCommit) return result;
        }
    }

    async function _afterCommit(parsed, meta) {
        // SillyTavern 环境静默跳过
        if (typeof pipeline === 'undefined') return;
        var sq = (typeof gameData !== 'undefined' && gameData) ? gameData.sideQuest : null;
        if (!sq) return;

        var active = sq.active;
        var pendingReturnFailure = (sideQuestService.getPendingReturnFailure)
            ? sideQuestService.getPendingReturnFailure() : sq.pendingReturnFailure;
        // 返回门派导致的失败不是普通阶段判定：本轮只负责把返程与失败余波写进正文，
        // 不再调用 212，也不让“返回”被判成新的支线进展。
        if (pendingReturnFailure) {
            if (!((parsed && parsed.mainText) || '').trim() || parsed.sideNote == null) {
                console.log('[SideQuest] 失败返程回复不完整，保留收束上下文以供重试');
                return false;
            }
            if (sideQuestService.clearPendingReturnFailure) sideQuestService.clearPendingReturnFailure();
            return true;
        }
        if (!sideQuestService.isEnabled() || !active) return;
        // 与剧本链互斥：冻结支线，包括 ending 余韵结算。
        if (typeof currentSpecialEvent !== 'undefined' && currentSpecialEvent) return;
        if (sideQuestService.markStarted) sideQuestService.markStarted();

        // 只有完整的余韵回复、且地点/同伴门控通过时才下发奖励；截断可重生成或确认失败返门。
        // 置于 judgeDisabled 之前：收束不是判定，熔断/暂停不得卡住奖励下发。
        if (active.pendingEpilogue) {
            if (!((parsed && parsed.mainText) || '').trim() || parsed.sideNote == null) return false;
            if (!sideQuestService.checkStageGates(active)) return;
            _applyOutcome(sideQuestService.finalizeEpilogue());
            return;
        }
        if (sq.judgeDisabled) return;
        if (active.status !== 'active') return;
        // awaiting（抉择/战斗等待期）判定休眠，不计轮不计时
        if (active.pendingInteraction && active.pendingInteraction.state === 'awaiting') return;
        // 水位线：防重判 / regenerate 后丢弃过期判定
        var uiIndex = meta && typeof meta.uiIndex === 'number' ? meta.uiIndex : -1;
        if (uiIndex < 0 || uiIndex <= active.lastJudgedUiIndex) return;

        var node = active.nodes ? active.nodes[active.currentNodeId] : null;
        if (!node) {
            console.error('[SideQuest] 当前节点不存在: ' + active.currentNodeId);
            _applyOutcome(sideQuestService.failQuest('剧情树数据异常', meta));
            return;
        }

        // 同步时限检查（超 deadline 直接失败，不走 LLM）
        var nowWeek = (typeof currentWeek !== 'undefined') ? currentWeek : 0;
        if (active.deadlineWeek > 0 && nowWeek > active.deadlineWeek) {
            _applyOutcome(sideQuestService.failQuest('超过时限（第 ' + active.deadlineWeek + ' 周）', meta));
            return;
        }
        // 同步 maxTurns 检查
        if (node.maxTurns > 0 && active.turnsInNode >= node.maxTurns) {
            _applyOutcome(sideQuestService.failQuest('在「' + (node.title || '') + '」阶段久拖不决', meta));
            return;
        }

        // 主对话回复格式不完整（SIDE_NOTE 解析失败/正文为空）的轮次跳过判定：
        // 空素材判定既浪费 token 又易误判，也不得把 buildup 确定性推进为 awaiting。
        var _mainText = (parsed && parsed.mainText) || '';
        if (!_mainText.trim()) {
            console.log('[SideQuest] 本轮剧情正文为空（回复格式不完整），跳过判定');
            return;
        }

        // 与 213 共用支线地点/随行 NPC 门控；须在交互呈现前拦截，旧 hardGates/keywords 不再生效。
        if (!sideQuestService.checkStageGates(active)) {
            active.turnsInNode++;
            active.lastJudgedUiIndex = uiIndex;
            _persistQuiet();
            return;
        }

        // choice/battle 且 buildup：本轮正文已铺垫且门控通过 → 确定性翻转 awaiting 并呈现交互（不经判定 LLM）
        if ((node.interaction === 'choice' || node.interaction === 'battle') &&
            active.pendingInteraction && active.pendingInteraction.state === 'buildup') {
            active.pendingInteraction.state = 'awaiting';
            active.lastJudgedUiIndex = uiIndex;
            _persistQuiet();
            _presentInteraction(node);
            return;
        }

        // choice/battle 节点无 pendingInteraction（异常态）时兜底：直接补 buildup，不走 LLM 判定
        if (node.interaction === 'choice' || node.interaction === 'battle') {
            active.pendingInteraction = { kind: node.interaction, nodeId: active.currentNodeId, state: 'buildup' };
            active.lastJudgedUiIndex = uiIndex;
            _persistQuiet();
            return;
        }

        // 互斥锁：只保留最新一轮；被取代轮次返回 false，防止其延迟自动存档。
        if (_running) {
            if (_pendingJudge && _pendingJudge.resolve) _pendingJudge.resolve(false);
            return new Promise(function(resolve) {
                _pendingJudge = { parsed: parsed, meta: meta, resolve: resolve };
                console.log('[SideQuest] 判定运行中，暂存本轮 (uiIndex=' + uiIndex + ')');
            });
        }
        var settled = await _runJudge(parsed, meta);
        if (settled === false) {
            // 被取消/过期/支线已放弃：排队轮次不会再有执行机会，必须结清其 Promise，
            // 否则 whenSettled（自动存档、手动保存/导出）会永久等待。
            if (_pendingJudge && _pendingJudge.resolve) {
                var dropped = _pendingJudge;
                _pendingJudge = null;
                console.log('[SideQuest] 判定已失效，丢弃排队轮次 (uiIndex=' + dropped.meta.uiIndex + ')');
                dropped.resolve(false);
            }
            return false;
        }
        if (_pendingJudge) {
            var pending = _pendingJudge;
            _pendingJudge = null;
            var pendingResult = await _afterCommit(pending.parsed, pending.meta);
            pending.resolve(pendingResult);
            return pendingResult;
        }
        return true;
    }

    function _reportJudgeStatus(meta, text) {
        if (meta && typeof meta.onStatus === 'function') {
            try { meta.onStatus(text); } catch (e) { /* UI 更新失败不影响判定 */ }
        }
    }


    /**
     * 判定 LLM 单轮执行（首次请求 + 最多 3 次重试）。重试留在同一 Promise 内，
     * 调用方只有等到成功、失败或取消才算落定，避免在重试间隙恢复输入或保存旧状态。
     */
    async function _runJudge(parsed, meta) {
        _setRunning(true);
        var generation = _lifecycleGeneration;
        var active = sideQuestService.getActive();
        var questId = active ? active.questId : null;
        var uiIndex = meta.uiIndex;
        var failures = 0; // 每轮独立计数，取消/重生成不会继承旧轮次数。

        try {
            while (true) {
                _reportJudgeStatus(meta, failures > 0
                    ? '施延年重判支线（' + failures + '/' + _MAX_RETRIES + '）'
                    : '施延年推敲支线');
                _abortController = new AbortController();
                var signal = _abortController.signal;
                try {
                    var node = active.nodes[active.currentNodeId];
                    var messages = _buildJudgeMessages(active, node, meta.userMessage, (parsed && parsed.mainText) || '');

                    console.groupCollapsed('[SideQuest] ══ 发起阶段判定 ══ quest=' + active.questId + ' node=' + active.currentNodeId + ' uiIndex=' + uiIndex);
                    for (var i = 0; i < messages.length; i++) {
                        console.log('[SideQuest] [' + (i + 1) + '] ' + messages[i].role + ' (' + messages[i].content.length + ' chars):\n' + messages[i].content);
                    }
                    console.groupEnd();

                    var apiResult = await _sendSQ(messages, signal, 'sideQuestJudge');
                    if (signal.aborted || generation !== _lifecycleGeneration) {
                        console.log('[SideQuest] 已被取消（LLM 返回后检测），放弃写入');
                        return false;
                    }

                    var raw = (apiResult && apiResult.content) || '';
                    console.groupCollapsed('[SideQuest] ══ 判定回复 ══');
                    console.log('[SideQuest] usage:', JSON.stringify(apiResult && apiResult.usage || null));
                    console.log('[SideQuest] 原文:\n' + raw);
                    console.groupEnd();

                    var judgeResult = _parseTaggedJson(raw, 'SIDE_QUEST_CHECK', 'progressNote');
                    if (!judgeResult || !judgeResult.result) throw new Error('判定 JSON 解析失败（长度=' + raw.length + '）');

                    // 回滚保护：questId 与水位线双校验，过期判定结果丢弃
                    var cur = sideQuestService.getActive();
                    if (!cur || cur.questId !== questId || uiIndex <= cur.lastJudgedUiIndex) {
                        console.log('[SideQuest] 判定结果已过期（regenerate/读档），丢弃');
                        return false;
                    }

                    var outcome = sideQuestService.applyJudgement(judgeResult, meta);
                    _applyOutcome(outcome);
                    _reportJudgeStatus(meta, '施延年收好判词');
                    return true;
                } catch (e) {
                    if (e.name === 'AbortError' || signal.aborted || generation !== _lifecycleGeneration) {
                        console.log('[SideQuest] 已被主动取消，不重试');
                        return false;
                    }
                    failures++;
                    if (failures > _MAX_RETRIES) {
                        console.warn('[SideQuest] 判定重试 ' + _MAX_RETRIES + ' 次后仍失败，跳过本轮自动存档:', e.message);
                        _reportJudgeStatus(meta, '施延年判词未成');
                        _notify('支线判定重试 ' + _MAX_RETRIES + ' 次后仍失败，本轮自动存档已跳过，请重新生成本轮回复。');
                        return false;
                    }
                    console.warn('[SideQuest] ✗ 判定失败，' + _retryDelay + 'ms 后重试（' + failures + '/' + _MAX_RETRIES + '）:', e.message);
                    _reportJudgeStatus(meta, '施延年判定未成，1秒后重试（' + failures + '/' + _MAX_RETRIES + '）');

                    // 重试等待同样响应 cancel，不让旧回合在延迟结束后写回或自动存档。
                    await new Promise(function(resolve) {
                        var finished = false;
                        function done() {
                            if (finished) return;
                            finished = true;
                            clearTimeout(timer);
                            signal.removeEventListener('abort', done);
                            resolve();
                        }
                        var timer = setTimeout(done, _retryDelay);
                        signal.addEventListener('abort', done, { once: true });
                    });
                    if (signal.aborted || generation !== _lifecycleGeneration) return false;
                    var cur2 = sideQuestService.getActive();
                    if (!cur2 || cur2.questId !== questId || uiIndex <= cur2.lastJudgedUiIndex) return false;
                }
            }
        } finally {
            // cancel 后可能立即开始新生命周期；旧请求的 finally 不得清掉新请求的
            // AbortController/运行标记，否则新判定会失去取消能力并被提前视为空闲。
            if (generation === _lifecycleGeneration) {
                _abortController = null;
                _setRunning(false);
            }
        }
    }

    /**
     * 判定 messages：1105 六消息框架，正文/输入原文位于 msg3 assistant，
     * 任务参数中的 sqMainText/sqUserInput 填占位引用。
     */
    function _buildJudgeMessages(active, node, userInput, mainText) {
        var judgeCtx = sideQuestService.buildJudgeCtx(active, node, '（见上方收集的素材）', '（见上方收集的素材）');
        var tpl = _poText('SQ_JUDGE', (typeof PROMPT_SQ_JUDGE !== 'undefined') ? PROMPT_SQ_JUDGE : '');
        var taskContent = _renderTemplate(tpl, judgeCtx);
        var material = '【本轮玩家输入】\n' + (userInput || '（无）') + '\n\n【本轮剧情正文】\n' + (mainText || '（无）');
        return promptBuilder.buildBackgroundMessages({
            systemPrompt: SQ_JUDGE_SYSTEM,
            materialContent: material,
            taskPrompt: taskContent,
            taskRules: [
                '只依据素材中实际发生之事判定，不推测未写出的情节',
                '未达成也未失败 → continue；低置信一律 continue',
                '严格遵循任务中给出的输出结构'
            ],
            outputTag: 'SIDE_QUEST_CHECK',
            outputDescription: '支线阶段判定 JSON'
        });
    }

    // =========================================================================
    // 交互呈现（Phase 3 UI 钩子：window.SideQuestInteraction，未定义时仅状态翻转）
    // =========================================================================

    function _presentInteraction(node) {
        console.log('[SideQuest] 交互点到达: ' + node.interaction + ' 「' + (node.title || '') + '」');
        if (typeof window.SideQuestInteraction !== 'undefined') {
            if (node.interaction === 'choice' && typeof window.SideQuestInteraction.presentChoice === 'function') {
                window.SideQuestInteraction.presentChoice(node);
            } else if (node.interaction === 'battle' && typeof window.SideQuestInteraction.presentBattle === 'function') {
                window.SideQuestInteraction.presentBattle(node);
            }
        }
        if (typeof showToast === 'function') {
            showToast(node.interaction === 'choice' ? '支线迎来关键抉择' : '狭路相逢，一战难免', { type: 'sidequest' });
        }
    }

    // =========================================================================
    // 结果反馈
    // =========================================================================

    function _applyOutcome(outcome) {
        if (!outcome || !outcome.action || outcome.action === 'none') return;
        switch (outcome.action) {
            case 'continue':
                // 静默（仅控制台），不打扰玩家
                break;
            case 'advance':
                if (typeof showToast === 'function') showToast('支线有了新进展', { type: 'sidequest' });
                break;
            case 'ending': {
                var lines = ['<b>支线完成：' + _escapeHtml(outcome.questTitle || '') + '</b>',
                    '',
                    '<b>结局·' + _escapeHtml(outcome.endingTitle || '') + '</b>',
                    _escapeHtml(outcome.epilogue || '')];
                if (outcome.rewards && outcome.rewards.length) {
                    lines.push('');
                    lines.push('<b>获得奖励：</b>' + outcome.rewards.map(function(r) {
                        return _escapeHtml(r.label) + (r.add >= 0 ? '+' : '') + r.add;
                    }).join('　'));
                }
                _notify(lines.join('<br>'));
                break;
            }
            case 'fail':
                _notify('<b>支线失败：' + _escapeHtml(outcome.questTitle || '') + '</b><br>' +
                    _escapeHtml(outcome.reason || '') + '<br>声望 -3');
                break;
        }
    }

    function _notify(html) {
        if (typeof showModal === 'function') showModal(html);
        else console.log('[SideQuest] ' + String(html).replace(/<[^>]+>/g, ''));
    }

    function _escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function _persistQuiet() {
        if (typeof syncGameDataFromVariables === 'function') syncGameDataFromVariables();
        if (typeof storageService !== 'undefined' && storageService.saveAppState) {
            try { storageService.saveAppState({ gameData: gameData }); } catch (e) { /* 静默 */ }
        }
    }

    // =========================================================================
    // 生命周期
    // =========================================================================

    /** 取消飞行中的判定及重试/排队；所有等待方收到 false，禁止旧状态落自动存档。 */
    function cancel() {
        _lifecycleGeneration++;
        if (_abortController) {
            _abortController.abort();
            _abortController = null;
            console.log('[SideQuest] cancel() 已中止飞行中的判定请求');
        }
        // 建树请求同样中止：否则读档/重生成时它仍占着遮罩与主流程
        if (_treeAbortController) {
            _treeAbortController.abort();
            _treeAbortController = null;
            console.log('[SideQuest] cancel() 已中止飞行中的剧情树请求');
        }
        if (_pendingJudge && _pendingJudge.resolve) _pendingJudge.resolve(false);
        _pendingJudge = null;
        _setRunning(false);
    }

    /**
     * 页面加载/读档后调用：若存档中 pendingInteraction 处于 awaiting（UI 不持久化），重新呈现交互
     */
    function resumeOnLoad() {
        _syncRumorSession();
        _recentRumorBatches = [];
        _pendingRumorCandidates = null;
        if (typeof pipeline === 'undefined') return;
        var active = sideQuestService.getActive();
        if (!active || !active.pendingInteraction) return;
        if (active.pendingInteraction.state !== 'awaiting') return;
        var node = active.nodes ? active.nodes[active.pendingInteraction.nodeId] : null;
        if (!node) return;
        console.log('[SideQuest] resumeOnLoad: 恢复 awaiting 交互呈现（' + active.pendingInteraction.kind + '）');
        _presentInteraction(node);
    }

    function isRunning() { return _running; }

    /** _running 切换桥：同步支线状态条（判定中脉冲），刷新失败不阻断判定 */
    function _setRunning(v) {
        _running = v;
        if (typeof updateSideQuestStatusBar === 'function') {
            try { updateSideQuestStatusBar(); } catch (e) { /* 静默 */ }
        }
    }

    return {
        generateRumors: generateRumors,
        getRumorCandidates: getRumorCandidates,
        getTreeRetryIndex: getTreeRetryIndex,
        acceptRumor: acceptRumor,
        afterCommit: afterCommit,
        whenSettled: whenSettled,
        cancel: cancel,
        resumeOnLoad: resumeOnLoad,
        isRunning: isRunning,
        notifyOutcome: _applyOutcome
    };
})();

window.sideQuestRunner = sideQuestRunner;
