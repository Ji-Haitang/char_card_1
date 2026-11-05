/**
 * side-quest-service.js - 暗线/支线剧情系统：状态与规则层
 *
 * 职责：
 *   - gameData.sideQuest CRUD（active/history/lastRefreshWeek/judgeDisabled）
 *   - 剧情树校验器（节点数/stage数/choice恰好1个/battle 0-1/ending 2-3含≥1 success/
 *     引用存在/root可达/DFS无环/rewards白名单夹紧/enemyName黑名单）
 *   - 判定结果应用（continue/success/fail）与终点结算、失败惩罚（声望-3写死）
 *   - 主对话注入指导文本（PROMPT_SQ_GUIDE 五形态：stage/choice_buildup/choice_awaiting/
 *     battle_buildup/ending）
 *   - 212/213 共用门控（relatedLocations 单地点 + relatedNpcs 随行交集）
 *   - 210/211/212 三份调用类模板的 sq* 上下文变量预计算
 *
 * 持久化零侵入：状态全挂 gameData.sideQuest，mergeWithDefaults 自动补缺，
 * 存档/快照/导入导出无需改动。
 *
 * 依赖：game-config.js(npcs/seasonNameMap), game-state.js(gameData/syncGameDataFromVariables/
 *        playerStats/playerTalents/npcFavorability/currentWeek/mapLocation/currentSpecialEvent),
 *        template-engine.js, prompt-data-extra.js(PROMPT_SQ_*), prompt-overrides.js,
 *        storage-service.js, summary-history-service.js, event-history-service.js
 */

var sideQuestService = (function() {

    // =========================================================================
    // 常量
    // =========================================================================

    // 传入战斗页的类别必须匹配已有的战斗差分立绘；无明确线索时用游侠作中性兜底。
    var SQ_ENEMY_CATEGORIES = ['正派弟子', '反派弟子', '游侠', '军士', '匪徒', '平民', '蒙面人', '野兽'];

    // 战斗页 commonNPCs 预设名黑名单（enemyName 重名会覆盖传入数值，建树时拒绝）
    var ENEMY_NAME_BLACKLIST = ['破阵子', '洞庭君', '苓雪妃', '玄天青', '钱塘君', '萧白瑚', '姬姒',
        '施延年', '呼延显', '雨烛', '安慕', '唐沐梨', '洛潜幽', '神秘杂役', '鹿椿若'];

    // rewards 白名单与数值夹紧上限（负数同样夹紧）
    var REWARD_CAPS = {
        'playerStats.武学': 3, 'playerStats.学识': 3, 'playerStats.声望': 15, 'playerStats.金钱': 800,
        'playerTalents.根骨': 3, 'playerTalents.悟性': 3, 'playerTalents.心性': 3, 'playerTalents.魅力': 3
    };
    var FAVORABILITY_CAP = 10;   // npcFavorability.A~O
    var HISTORY_CAP = 20;        // sideQuest.history FIFO 上限
    var PROGRESS_NOTES_CAP = 300; // progressNotes 截断上限（字）

    // 支线结局是否额外写入 L2 eventHistory。暂时关闭：支线过程楼层已由 runEventSum
    // 正常总结，避免同一剧情再按结局重复入库、向量化与召回。未来如需恢复结局记录，
    // 只需改为 true；不影响 sideQuest.history“往事”，也不会清理已有的 L2 记录。
    var ARCHIVE_SIDE_QUEST_TO_EVENT_HISTORY = false;

    // 合法地点保留天山派以兼容既有节点；新传闻/建树的生成池会额外排除本派驻地。
    var SQ_LOCATIONS = ['天山派', '伊州', '千佛洞', '博斯坦村', '博格达峰', '哈密绿洲', '大沙海',
        '天山派外堡', '崆峒派', '拜火教总坛', '昆仑派', '月牙泉', '沙州', '瓜州', '白驼山',
        '迪坎儿村', '高昌', '龟兹'];

    // 与 world_map.html 的出行门槛一致：新支线只生成当前已经能前往的下山地点。
    var SQ_LOCATION_REPUTATION = {
        '天山派': 0, '天山派外堡': 0, '伊州': 10, '博斯坦村': 20, '迪坎儿村': 20,
        '哈密绿洲': 30, '月牙泉': 40, '千佛洞': 50, '崆峒派': 60, '昆仑派': 70,
        '龟兹': 80, '高昌': 90, '大沙海': 100, '沙州': 110, '白驼山': 120,
        '瓜州': 130, '拜火教总坛': 150, '博格达峰': 200
    };

    // 建树复杂度：普通/困难需要更多 stage 承载分支，ending 仍保持 2~3 个
    var TREE_DIFFICULTY_RULES = {
        '简单': { nodeMin: 4, nodeMax: 8, stageMin: 2, stageMax: 5, endingMin: 2, endingMax: 3, battleMin: 0, battleMax: 1, rewardFactor: 0.75 },
        '普通': { nodeMin: 6, nodeMax: 10, stageMin: 4, stageMax: 7, endingMin: 2, endingMax: 3, battleMin: 0, battleMax: 1, rewardFactor: 1 },
        '困难': { nodeMin: 8, nodeMax: 12, stageMin: 6, stageMax: 9, endingMin: 2, endingMax: 3, battleMin: 1, battleMax: 1, rewardFactor: 1.25 }
    };

    // 与悬赏/战斗页一致：属性点数 → 武学境界 index
    var SQ_WUXUE_STAGE_RANGES = [[0, 7], [8, 11], [12, 14], [15, 17], [18, 20],
        [21, 22], [23, 24], [25, 26], [27, 28], [29, 30]];

    // =========================================================================
    // 状态访问
    // =========================================================================

    function _sq() {
        return (typeof gameData !== 'undefined' && gameData && gameData.sideQuest) ? gameData.sideQuest : null;
    }

    function _cfg() {
        var c = (typeof gameData !== 'undefined' && gameData && gameData.sideQuestConfig) ? gameData.sideQuestConfig : null;
        return c || { enabled: true, confidenceThreshold: 0.7, deadlineWeeks: 10 };
    }

    /** SillyTavern 渲染环境整体静默跳过（方案书 §1.2） */
    function isAvailable() {
        return typeof pipeline !== 'undefined' && typeof gameData !== 'undefined' && !!_sq();
    }

    function isEnabled() {
        return isAvailable() && _cfg().enabled !== false;
    }

    function getActive() {
        var sq = _sq();
        return sq ? sq.active : null;
    }

    /**
     * 有进行中支线（gameData.sideQuest.active 非空，含收束余韵轮）时，屏蔽下山状态下按概率触发的
     * 随机选项事件/随机战斗事件（世界地图地点「!」标记 + 下山后自由行动掷骰）。
     * 支线自身的抉择/战斗、跳过一周触发的事件、悬赏战斗不受影响。
     */
    function suppressesRandomEvents() {
        return !!getActive();
    }

    function getHistory() {
        var sq = _sq();
        return (sq && Array.isArray(sq.history)) ? sq.history : [];
    }

    /** 抵达支线地点且相关 NPC 随行后开始；随存档保留，离场不会重置。 */
    function markStarted() {
        var active = getActive();
        if (!active || active.started || active.status !== 'active' || !isEnabled()) return;
        if (typeof GameMode !== 'undefined' && GameMode !== 1) return;
        if (!checkStageGates(active)) return;
        active.started = true;
        _persist();
    }

    /** 返回门派的失败边界包含 ending 余韵；旧存档用当前门控和已有进展兼容。 */
    function getReturnRisk() {
        var active = getActive();
        if (!active || (active.status !== 'active' && !active.pendingEpilogue)) return null;
        if (active.started || active.pendingEpilogue || (active.log && active.log.length > 0)) return active;
        var away = typeof GameMode !== 'undefined' && GameMode === 1;
        return away && checkStageGates(active) ? active : null;
    }

    /** 当前节点对象（无则 null） */
    function getCurrentNode() {
        var active = getActive();
        if (!active || !active.nodes) return null;
        return active.nodes[active.currentNodeId] || null;
    }

    /** 统一持久化：全局变量→gameData→appState，并刷新 UI */
    function _persist() {
        if (typeof syncGameDataFromVariables === 'function') syncGameDataFromVariables();
        if (typeof storageService !== 'undefined' && storageService.saveAppState) {
            try { storageService.saveAppState({ gameData: gameData }); } catch (e) { console.warn('[SideQuest] 存档失败:', e); }
        }
        if (typeof updateAllDisplays === 'function') updateAllDisplays();
    }

    // =========================================================================
    // 树校验器（方案书 §3.3）
    // =========================================================================

    function _outlets(node) {
        if (!node) return [];
        var outs = [];
        if (node.onSuccess) outs.push(node.onSuccess);
        if (Array.isArray(node.options)) {
            node.options.forEach(function(o) { if (o && o.next) outs.push(o.next); });
        }
        if (node.battle) {
            if (node.battle.winNext) outs.push(node.battle.winNext);
            if (node.battle.loseNext) outs.push(node.battle.loseNext);
        }
        return outs;
    }

    function _isRewardKeyAllowed(key) {
        if (REWARD_CAPS.hasOwnProperty(key)) return true;
        return /^npcFavorability\.[A-O]$/.test(key);
    }

    function _getDifficultyProfile(difficulty) {
        return TREE_DIFFICULTY_RULES[difficulty] || TREE_DIFFICULTY_RULES['普通'];
    }

    function _getWuxuePoints(wuxue) {
        if (typeof calculateLevelFromWuxue === 'function') return calculateLevelFromWuxue(wuxue);
        var total = 0;
        var points = 0;
        for (var i = 1; i <= 30; i++) {
            var cost = Math.ceil(2 + i / 2);
            if (total + cost > wuxue) break;
            total += cost;
            points = i;
        }
        return points;
    }

    function _getPlayerStageIndex() {
        var gd = (typeof gameData !== 'undefined' && gameData) ? gameData : {};
        var wuxue = Number(gd.playerStats && gd.playerStats.武学);
        if (!Number.isFinite(wuxue) || wuxue < 0) wuxue = 0;
        var points = _getWuxuePoints(wuxue);
        for (var i = 0; i < SQ_WUXUE_STAGE_RANGES.length; i++) {
            var range = SQ_WUXUE_STAGE_RANGES[i];
            if (points >= range[0] && points <= range[1]) return i;
        }
        return 0;
    }

    function _rollInt(min, max) {
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    /** 预掷战斗参数并计算结局奖励上限；211 只负责把既定数值写进树 */
    function _getTreeRules(difficulty) {
        var profile = _getDifficultyProfile(difficulty);
        var stage = _getPlayerStageIndex();
        var levelMin, levelMax;
        if (difficulty === '简单') {
            levelMin = Math.max(0, stage - 2);
            levelMax = Math.max(0, stage - 1);
        } else if (difficulty === '困难') {
            levelMin = Math.min(9, stage + 1);
            levelMax = Math.min(9, stage + 2);
        } else {
            levelMin = stage;
            levelMax = stage;
        }
        var enemyLevel = _rollInt(levelMin, levelMax);
        var battleRewardGold = Math.round((enemyLevel + 1) * 500 * (0.8 + Math.random() * 0.4));
        var factor = profile.rewardFactor;
        var minStatCap = difficulty === '简单' ? 1 : 2;
        return {
            profile: profile,
            playerStage: stage,
            enemyLevelMin: levelMin,
            enemyLevelMax: levelMax,
            enemyLevel: enemyLevel,
            battleRewardGold: battleRewardGold,
            rewardStatCap: Math.min(REWARD_CAPS['playerStats.武学'], Math.max(minStatCap, Math.round((enemyLevel + 1) * 0.4 * factor))),
            rewardReputationCap: Math.min(REWARD_CAPS['playerStats.声望'], Math.max(1, Math.round((enemyLevel + 1) * 4 * factor))),
            rewardGoldCap: Math.min(REWARD_CAPS['playerStats.金钱'], Math.max(50, Math.round((enemyLevel + 1) * 100 * factor / 50) * 50)),
            rewardTalentCap: difficulty === '简单' ? 0 : (difficulty === '困难' && enemyLevel >= 6 ? 2 : 1),
            rewardFavorCap: Math.min(FAVORABILITY_CAP, Math.max(2, Math.round((enemyLevel + 1) * 1.5 * factor)))
        };
    }

    /** 统一为战斗页已支持的类别，兼容生成旧节点、同义类别与中文剧情里的常见身份词。 */
    function resolveBattleCategory(battle) {
        battle = (battle && typeof battle === 'object') ? battle : {};
        var raw = battle.enemyCategory || battle.category || '';
        var text = String(raw).trim();
        var aliases = {
            '门派弟子': '正派弟子', '武林弟子': '正派弟子', '正道弟子': '正派弟子',
            '魔教弟子': '反派弟子', '邪道弟子': '反派弟子', '邪派弟子': '反派弟子', '魔道弟子': '反派弟子',
            '侠客': '游侠', '江湖人': '游侠', '武者': '游侠', '商旅': '游侠',
            '士兵': '军士', '官兵': '军士', '守卫': '军士', '兵丁': '军士', '擒生军': '军士', '伪军': '军士',
            '土匪': '匪徒', '盗贼': '匪徒', '强盗': '匪徒', '山贼': '匪徒', '马贼': '匪徒', '匪盗': '匪徒',
            '百姓': '平民', '村民': '平民', '商人': '平民', '路人': '平民', '百姓商贾': '平民',
            '刺客': '蒙面人', '黑衣人': '蒙面人', '神秘人': '蒙面人', '杀手': '蒙面人',
            '猛兽': '野兽', '野狼': '野兽', '猛虎': '野兽', '毒蛇': '野兽', '动物': '野兽', '怪物': '野兽'
        };
        function matchCategory(value) {
            if (!value || value === '未知') return '';
            if (SQ_ENEMY_CATEGORIES.indexOf(value) !== -1) return value;
            if (aliases[value]) return aliases[value];
            for (var i = 0; i < SQ_ENEMY_CATEGORIES.length; i++) {
                var category = SQ_ENEMY_CATEGORIES[i];
                if (value.indexOf(category) !== -1 || category.indexOf(value) !== -1) return category;
            }
            for (var alias in aliases) {
                if (value.indexOf(alias) !== -1) return aliases[alias];
            }
            return '';
        }
        var explicit = matchCategory(text);
        if (explicit) return explicit;

        function identityMatches(value) {
            if (!value || typeof value !== 'string') return [];
            var identityRules = [
                { category: '野兽', pattern: /野兽|野狼|豺狼|猛虎|毒蛇|恶犬|狼群|兽群/ },
                { category: '蒙面人', pattern: /蒙面|蒙着脸|遮面|覆面|面罩|黑巾遮面|黑衣刺客|刺客|杀手|暗杀/ },
                { category: '军士', pattern: /军士|兵卒|士兵|官兵|守军|军卒|兵丁|擒生军|伪军|兵马|队正|将军|校尉|军官/ },
                { category: '匪徒', pattern: /匪徒|匪盗|土匪|山贼|马贼|强盗|劫匪|盗贼|盗匪|绿林好汉/ },
                { category: '反派弟子', pattern: /邪派|魔教|白驼山|拜火教|邪教|邪道弟子|魔道弟子/ },
                { category: '正派弟子', pattern: /正派|正道|门派弟子|武林弟子|崆峒派|昆仑派|崆峒|昆仑|弟子/ },
                { category: '平民', pattern: /百姓|村民|商贾|商人|行商|客商|伙计|掌柜|路人/ },
                { category: '游侠', pattern: /游侠|侠客|江湖人|武者|江湖客|剑客|刀客|豪客|散人/ }
            ];
            return identityRules.filter(function(rule) { return rule.pattern.test(value); })
                .map(function(rule) { return rule.category; });
        }
        function inferFromIdentity(value) {
            var matches = identityMatches(value);
            return matches.length ? matches[0] : '';
        }
        var identity = [battle.enemyName, battle.enemyAppearance, battle.enemyDescription]
            .filter(function(v) { return typeof v === 'string' && v.trim(); }).join(' ');
        var inferred = inferFromIdentity(identity);
        if (inferred) return inferred;
        // introText is last resort: it often mentions nearby people who are not the enemy. Mixed
        // ally/enemy wording is ambiguous and stays on the neutral 游侠 portrait.
        var prose = battle.introText || battle.description || '';
        var proseHits = identityMatches(prose);
        inferred = (proseHits.length === 1) ? proseHits[0] : '';
        if (inferred) return inferred;
        return '游侠';
    }

    /**
     * 校验剧情树，返回 { ok: boolean, errors: string[] }
     * @param {object} tree
     * @param {string} [difficulty='普通']
     */
    function validateTree(tree, difficulty) {
        var profile = _getDifficultyProfile(difficulty);
        var errors = [];
        if (!tree || typeof tree !== 'object') return { ok: false, errors: ['剧情树不是对象'] };
        var nodes = tree.nodes;
        if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return { ok: false, errors: ['缺少 nodes 对象'] };

        var ids = Object.keys(nodes);
        if (ids.length < profile.nodeMin || ids.length > profile.nodeMax) {
            errors.push('节点总数须 ' + profile.nodeMin + '~' + profile.nodeMax + '，实际 ' + ids.length);
        }

        var rootId = tree.rootNodeId;
        if (rootId !== 'n1') errors.push('rootNodeId 必须是 n1（实际: ' + rootId + '）');
        if (!nodes[rootId]) errors.push('rootNodeId 指向不存在的节点');
        else if (nodes[rootId].type !== 'stage') errors.push('n1 必须是 stage 节点');

        var stageCount = 0, choiceCount = 0, battleCount = 0, endingCount = 0, successEndingCount = 0;

        ids.forEach(function(id) {
            var n = nodes[id];
            if (!n || typeof n !== 'object') { errors.push(id + ' 不是对象'); return; }

            if (n.type === 'stage') {
                stageCount++;
                if (!n.title) errors.push(id + ' 缺 title');
                if (!n.hiddenGoal) errors.push(id + ' 缺 hiddenGoal');
                var hasOutlet = false;

                if (n.interaction === 'choice') {
                    choiceCount++;
                    var opts = Array.isArray(n.options) ? n.options : [];
                    if (opts.length < 2 || opts.length > 3) errors.push(id + ' choice 选项须 2~3 个，实际 ' + opts.length);
                    var optIds = {};
                    opts.forEach(function(o, oi) {
                        if (!o || !o.label) { errors.push(id + ' 选项' + oi + ' 缺 label'); return; }
                        if (!o.id || typeof o.id !== 'string' || !o.id.trim()) {
                            errors.push(id + ' 选项' + oi + ' 缺 id');
                        } else if (optIds[o.id]) {
                            errors.push(id + ' 选项 id 重复: ' + o.id);
                        } else {
                            optIds[o.id] = true;
                        }
                        if (!nodes[o.next]) errors.push(id + ' 选项' + oi + ' next 指向不存在节点: ' + o.next);
                    });
                    hasOutlet = opts.length >= 2;
                } else if (n.interaction === 'battle') {
                    battleCount++;
                    var b = n.battle;
                    if (!b || typeof b !== 'object') {
                        errors.push(id + ' 缺 battle 配置');
                    } else {
                        if (!b.enemyName) errors.push(id + ' battle 缺 enemyName');
                        else if (ENEMY_NAME_BLACKLIST.indexOf(b.enemyName) !== -1) errors.push(id + ' enemyName 撞预设角色黑名单: ' + b.enemyName);
                        b.enemyCategory = resolveBattleCategory(b);
                        var lv = Number(b.level);
                        if (!Number.isFinite(lv) || lv < 0 || lv > 9) errors.push(id + ' battle.level 须 0~9 整数（实际: ' + b.level + '）');
                        if (!nodes[b.winNext]) errors.push(id + ' battle.winNext 指向不存在节点: ' + b.winNext);
                        if (!nodes[b.loseNext]) errors.push(id + ' battle.loseNext 指向不存在节点: ' + b.loseNext);
                        hasOutlet = !!(nodes[b.winNext] && nodes[b.loseNext]);
                    }
                } else {
                    if (!n.onSuccess || !nodes[n.onSuccess]) errors.push(id + ' onSuccess 指向不存在节点: ' + n.onSuccess);
                    else hasOutlet = true;
                }
                if (!hasOutlet) errors.push(id + ' stage 节点无归宿（须 onSuccess/options/battle 之一）');
            } else if (n.type === 'ending') {
                endingCount++;
                if (n.endingType === 'success') successEndingCount++;
                else if (n.endingType !== 'bittersweet') errors.push(id + ' endingType 非法: ' + n.endingType);
                if (!n.epilogue) errors.push(id + ' 缺 epilogue');
                var rw = n.rewards;
                if (rw && typeof rw === 'object') {
                    Object.keys(rw).forEach(function(key) {
                        if (!_isRewardKeyAllowed(key)) {
                            // LLM 常混淆 scope：根骨/悟性/心性/魅力是 playerTalents 天赋（playerStats 里不存在），
                            // 误写成 playerStats.* 时自动纠正——避免建树重试白烧一轮 token（真机联调实证 deepseek-flash 高频犯）
                            var m = /^playerStats\.(根骨|悟性|心性|魅力)$/.exec(key);
                            if (m) {
                                var fixed = 'playerTalents.' + m[1];
                                rw[fixed] = rw[key];
                                delete rw[key];
                                console.warn('[SideQuest] rewards 键自动纠正: ' + key + ' → ' + fixed);
                                return;
                            }
                            errors.push(id + ' rewards 非法键: ' + key);
                        }
                    });
                }
            } else {
                errors.push(id + ' type 非法: ' + n.type);
            }
        });

        if (stageCount < profile.stageMin || stageCount > profile.stageMax) {
            errors.push('stage 节点须 ' + profile.stageMin + '~' + profile.stageMax + ' 个，实际 ' + stageCount);
        }
        if (choiceCount !== 1) errors.push('choice 节点须恰好 1 个，实际 ' + choiceCount);
        if (battleCount < profile.battleMin || battleCount > profile.battleMax) {
            errors.push('battle 节点须 ' + profile.battleMin + '~' + profile.battleMax + ' 个，实际 ' + battleCount);
        }
        if (endingCount < profile.endingMin || endingCount > profile.endingMax) {
            errors.push('ending 节点须 ' + profile.endingMin + '~' + profile.endingMax + ' 个，实际 ' + endingCount);
        }
        if (successEndingCount < 1) errors.push('至少须 1 个 success 结局');

        // 可达性 + 无环（从 root 出发）
        if (nodes[rootId]) {
            var visited = {};
            var queue = [rootId];
            while (queue.length) {
                var cur = queue.shift();
                if (visited[cur]) continue;
                visited[cur] = true;
                _outlets(nodes[cur]).forEach(function(nx) {
                    if (nodes[nx] && !visited[nx]) queue.push(nx);
                });
            }
            ids.forEach(function(id) {
                if (!visited[id]) errors.push('节点 ' + id + ' 从 root 不可达');
            });

            var state = {};  // 0/undefined=未访问 1=在栈 2=完成
            var cycleFound = false;
            function dfs(id) {
                if (cycleFound || !nodes[id]) return;
                state[id] = 1;
                var outs = _outlets(nodes[id]);
                for (var i = 0; i < outs.length; i++) {
                    var nx = outs[i];
                    if (state[nx] === 1) { errors.push('检测到环: ' + id + ' → ' + nx); cycleFound = true; return; }
                    if (!state[nx]) dfs(nx);
                }
                state[id] = 2;
            }
            dfs(rootId);
        }

        return { ok: errors.length === 0, errors: errors };
    }

    // =========================================================================
    // 接取 / 放弃
    // =========================================================================

    /**
     * 建树通过后落库为进行中支线（由 runner 在校验成功后调用）
     * @param {object} rumor - 选中的传闻 { title, background, playerGoal, relatedNpcs, relatedLocations, difficulty }
     * @param {object} tree - 已通过 validateTree 的剧情树 { rootNodeId, nodes }
     */
    function acceptQuest(rumor, tree) {
        var sq = _sq();
        if (!sq) return null;
        var relatedLocations = sanitizeRelatedLocations(rumor.relatedLocations);
        if (relatedLocations.length !== 1) {
            console.warn('[SideQuest] 接取失败：传闻地点当前不可前往');
            return null;
        }
        var now = (typeof currentWeek !== 'undefined') ? currentWeek : 1;
        var dlWeeks = _cfg().deadlineWeeks;
        sq.active = {
            questId: 'sq_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
            title: rumor.title || '未名支线',
            background: rumor.background || '',
            playerGoal: rumor.playerGoal || '',
            difficulty: rumor.difficulty || '普通',
            acceptedWeek: now,
            deadlineWeek: (dlWeeks > 0) ? now + dlWeeks : 0,
            relatedNpcs: sanitizeRelatedNpcs(rumor.relatedNpcs),
            relatedLocations: relatedLocations,
            rootNodeId: tree.rootNodeId,
            nodes: tree.nodes,
            currentNodeId: tree.rootNodeId,
            pendingInteraction: null,
            turnsInNode: 0,
            log: [],
            progressNotes: '',
            status: 'active',
            started: false,
            endingId: null,
            pendingEpilogue: false,
            lastJudgedUiIndex: -1
        };
        console.log('[SideQuest] 已接取支线「' + sq.active.title + '」，剧情树 ' + Object.keys(tree.nodes).length + ' 节点，时限至第 ' + (sq.active.deadlineWeek || '∞') + ' 周');
        _persist();
        return sq.active;
    }

    /**
     * 放弃支线（无惩罚，记 abandoned 入 history）
     */
    function abandonQuest() {
        var sq = _sq();
        if (!sq || !sq.active) return false;
        var title = sq.active.title;
        _archiveQuest('abandoned', null);
        sq.active = null;
        _persist();
        console.log('[SideQuest] 已放弃支线「' + title + '」');
        return true;
    }

    // =========================================================================
    // 判定结果应用（方案书 §5.3）
    // =========================================================================

    function _appendProgressNote(existing, note) {
        if (!note) return existing || '';
        var combined = (existing ? existing + '；' : '') + note;
        if (combined.length > PROGRESS_NOTES_CAP) {
            combined = '…' + combined.slice(combined.length - PROGRESS_NOTES_CAP);
        }
        return combined;
    }

    /**
     * 应用判定结果。调用前 runner 须已完成水位线与 questId 校验。
     * 阶段只由 continue/success/fail 推进；choice/battle 的分支由玩家操作与战斗结果决定。
     * @param {object} judgeResult - { result, confidence, reason, progressNote }
     * @param {object} meta - { uiIndex, userMessage }
     * @returns {object} outcome - { action: 'continue'|'advance'|'fail'|'ending', ... }
     */
    function applyJudgement(judgeResult, meta) {
        var active = getActive();
        if (!active || active.status !== 'active') return { action: 'none' };
        var node = active.nodes[active.currentNodeId];
        if (!node) return failQuest('剧情树数据异常', meta);

        var result = judgeResult && judgeResult.result;
        var conf = Number(judgeResult && judgeResult.confidence);
        var threshold = _cfg().confidenceThreshold;
        if (!Number.isFinite(conf)) conf = 0;
        // 低置信一律按 continue（方案书 §4.3）
        if (result !== 'continue' && conf < threshold) {
            console.log('[SideQuest] 判定「' + result + '」置信度 ' + conf + ' < 阈值 ' + threshold + '，按 continue 处理');
            result = 'continue';
        }

        active.lastJudgedUiIndex = meta.uiIndex;

        if (result === 'success') {
            return _advanceToNode(node.onSuccess, 'success', judgeResult, meta);
        }
        if (result === 'fail') {
            return failQuest((judgeResult && judgeResult.reason) || '阶段目标失败', meta);
        }
        // continue
        active.turnsInNode++;
        active.progressNotes = _appendProgressNote(active.progressNotes, judgeResult && judgeResult.progressNote);
        _persist();
        return { action: 'continue', turns: active.turnsInNode, reason: judgeResult && judgeResult.reason };
    }

    /**
     * 推进到下一节点：揭示当前节点 title 入 log，处理 ending 结算 / choice|battle 进入 buildup
     */
    function _advanceToNode(nodeId, via, info, meta) {
        var active = getActive();
        if (!active) return { action: 'none' };
        var fromNode = active.nodes[active.currentNodeId];
        active.log.push({
            nodeId: active.currentNodeId,
            result: via,
            reason: (info && info.reason) || '',
            uiIndex: meta ? meta.uiIndex : -1,
            week: (typeof currentWeek !== 'undefined') ? currentWeek : 0,
            revealedTitle: fromNode ? fromNode.title : ''
        });
        if (!nodeId || !active.nodes[nodeId]) {
            console.error('[SideQuest] 推进目标节点不存在: ' + nodeId);
            return failQuest('剧情树数据异常', meta);
        }
        console.log('[SideQuest] 节点推进: ' + active.currentNodeId + ' → ' + nodeId + '（' + via + '）');
        active.currentNodeId = nodeId;
        active.turnsInNode = 0;
        active.progressNotes = '';  // 新节点新目标，证据重新累积

        var newNode = active.nodes[nodeId];
        if (newNode.type === 'ending') {
            return _settleEnding(newNode, meta);
        }
        if (newNode.interaction === 'choice' || newNode.interaction === 'battle') {
            active.pendingInteraction = { kind: newNode.interaction, nodeId: nodeId, state: 'buildup' };
        } else {
            active.pendingInteraction = null;
        }
        _persist();
        return { action: 'advance', nodeId: nodeId, interaction: newNode.interaction || 'none', revealedTitle: fromNode ? fromNode.title : '' };
    }

    /**
     * 抵达终点：仅标记 completed + pendingEpilogue 保留一轮写余韵、入 history；
     * 奖励与完成弹窗延后到收束轮 finalizeEpilogue 统一下发，避免刚到结局节点就结算
     */
    function _settleEnding(endingNode, meta) {
        var active = getActive();
        if (!active) return { action: 'none' };
        active.status = 'completed';
        active.endingId = active.currentNodeId;
        active.pendingEpilogue = true;
        active.pendingInteraction = null;
        _setCurrentWeekUsed(_sq());
        _archiveQuest('completed', null);
        _persist();
        console.log('[SideQuest] 支线「' + active.title + '」抵达结局「' + (endingNode.title || '') + '」（' + endingNode.endingType + '），奖励将于收束轮下发');
        return {
            action: 'endingReached',
            nodeId: active.currentNodeId,
            endingType: endingNode.endingType,
            endingTitle: endingNode.title || '',
            questTitle: active.title
        };
    }

    /**
     * 收束轮 finalize：pendingEpilogue 的那轮正文已写过余韵，
     * 此时下发 ending 奖励并清 active 回归日常
     * @returns {object|null} ending outcome（交 runner 弹完成结算）；无待收束时 null
     */
    function finalizeEpilogue() {
        var sq = _sq();
        if (!sq || !sq.active || !sq.active.pendingEpilogue) return null;
        var active = sq.active;
        var endingNode = (active.endingId && active.nodes) ? active.nodes[active.endingId] : null;
        var rewardDetails = endingNode ? applyRewards(endingNode.rewards) : [];
        console.log('[SideQuest] 支线「' + active.title + '」收束完毕，下发奖励并归档关闭');
        sq.active = null;
        _persist();
        if (!endingNode) return null;
        return {
            action: 'ending',
            endingType: endingNode.endingType,
            endingTitle: endingNode.title || '',
            epilogue: endingNode.epilogue || '',
            rewards: rewardDetails,
            questTitle: active.title
        };
    }

    /**
     * 为“中途返回门派”保留一轮剧情收束所需的现场快照。
     * active 会在 failQuest 中清空，因此不能在清理后再从 active 读取上下文。
     */
    function _buildReturnFailureContext(active, reason) {
        var node = active && active.nodes ? active.nodes[active.currentNodeId] : null;
        var companions = (typeof companionNPC !== 'undefined' && Array.isArray(companionNPC))
            ? companionNPC.map(function(value) {
                return typeof npcs !== 'undefined' && npcs[value] ? npcs[value].name : value;
            })
            : [];
        return {
            questId: active.questId,
            title: active.title || '未名支线',
            background: active.background || '',
            playerGoal: active.playerGoal || '',
            originLocation: (typeof mapLocation !== 'undefined' && mapLocation) ? mapLocation : '当前地点',
            companions: companions,
            relatedNpcs: Array.isArray(active.relatedNpcs) ? active.relatedNpcs.slice() : [],
            currentNodeId: active.currentNodeId || null,
            currentNodeTitle: node ? (node.title || '') : '',
            currentNodeType: node ? (node.type || '') : '',
            pendingInteraction: active.pendingInteraction ? {
                kind: active.pendingInteraction.kind || '',
                state: active.pendingInteraction.state || ''
            } : null,
            progressNotes: active.progressNotes || '',
            endingPending: !!active.pendingEpilogue,
            endingTitle: active.endingId && active.nodes && active.nodes[active.endingId]
                ? (active.nodes[active.endingId].title || '') : '',
            reason: reason || '中途放弃支线并返回门派',
            week: (typeof currentWeek !== 'undefined') ? currentWeek : 0
        };
    }

    function getPendingReturnFailure() {
        var sq = _sq();
        return sq && sq.pendingReturnFailure ? sq.pendingReturnFailure : null;
    }

    function clearPendingReturnFailure() {
        var sq = _sq();
        if (!sq || !sq.pendingReturnFailure) return false;
        sq.pendingReturnFailure = null;
        _persist();
        return true;
    }

    /**
     * 支线失败：声望 -3（写死，不交 LLM），入 history（可选 L2 归档），清 active。
     * returnToSect 会额外保留一次性剧情上下文，供“返回门派”这一轮主对话使用。
     */
    function failQuest(reason, meta) {
        var sq = _sq();
        if (!sq || !sq.active) return { action: 'none' };
        var active = sq.active;
        var returnFailure = meta && meta.returnToSect ? _buildReturnFailureContext(active, reason) : null;
        var wasPendingEpilogue = !!active.pendingEpilogue;
        active.status = 'failed';
        _setCurrentWeekUsed(sq);
        if (typeof playerStats !== 'undefined') {
            playerStats.声望 = Math.max(0, (playerStats.声望 || 0) - 3);
            if (typeof checkAllValueRanges === 'function') checkAllValueRanges();
        }
        active.log.push({
            nodeId: active.currentNodeId,
            result: 'fail',
            reason: reason || '',
            uiIndex: meta ? meta.uiIndex : -1,
            week: (typeof currentWeek !== 'undefined') ? currentWeek : 0,
            revealedTitle: null
        });
        // ending 节点已抵达但余韵尚未完成时，_settleEnding 已写过 completed 历史。
        // 将那条记录改为 failed，避免一次中途返回产生“完成+失败”两条相反归档。
        var replacedEndingHistory = false;
        if (wasPendingEpilogue && Array.isArray(sq.history)) {
            for (var hi = sq.history.length - 1; hi >= 0; hi--) {
                if (sq.history[hi] && sq.history[hi].questId === active.questId && sq.history[hi].outcome === 'completed') {
                    sq.history[hi].outcome = 'failed';
                    sq.history[hi].endingId = null;
                    sq.history[hi].finishedWeek = (typeof currentWeek !== 'undefined') ? currentWeek : 0;
                    sq.history[hi].failReason = reason || '中途放弃支线并返回门派';
                    replacedEndingHistory = true;
                    break;
                }
            }
        }
        active.pendingEpilogue = false;
        active.pendingInteraction = null;
        active.endingId = null;
        if (!replacedEndingHistory) _archiveQuest('failed', reason);
        if (returnFailure) sq.pendingReturnFailure = returnFailure;
        sq.active = null;
        _persist();
        console.log('[SideQuest] 支线「' + active.title + '」失败：' + reason);
        return { action: 'fail', reason: reason, questTitle: active.title, returnToSect: !!returnFailure,
            returnFailure: returnFailure };
    }

    /** 确定性处理“返回门派”：失败惩罚先落库，剧情收束交给下一轮主对话。 */
    function failQuestForReturn(expectedQuest) {
        var active = getReturnRisk();
        if (!active || (expectedQuest && active !== expectedQuest)) return { action: 'none' };
        return failQuest('中途放弃支线并返回门派', { returnToSect: true, uiIndex: -1 });
    }

    // =========================================================================
    // 抉择 / 战斗推进（玩家操作与战斗结果确定性推进，不经判定 LLM）
    // =========================================================================

    /**
     * 玩家点选抉择选项（由 displaySideQuestChoice 按钮回调）
     * @returns {object|null} 选中的 option（含 label/next），非法时 null
     */
    function applyChoice(optionId) {
        var active = getActive();
        if (!active || active.status !== 'active') return null;
        if (!checkStageGates(active)) {
            console.log('[SideQuest] 当前地点或随行 NPC 不满足条件，保留抉择等待状态');
            return null;
        }
        var pi = active.pendingInteraction;
        if (!pi || pi.kind !== 'choice') return null;
        var node = active.nodes[pi.nodeId];
        if (!node || !Array.isArray(node.options)) return null;
        var opt = null;
        for (var i = 0; i < node.options.length; i++) {
            if (node.options[i] && node.options[i].id === optionId) { opt = node.options[i]; break; }
        }
        if (!opt) return null;
        active.pendingInteraction = null;
        var outcome = _advanceToNode(opt.next, 'choice', { reason: '抉择：' + opt.label }, { uiIndex: -1 });
        return { option: opt, outcome: outcome };
    }

    /**
     * 战斗结算推进（battle-exit sidequest 分支 / fleeBattle / 强退三处统一出口）
     * @param {string} result - 'victory' | 'defeat' | 'quit'（quit 与 defeat 同等走 loseNext，对齐 bounty 口径）
     * @returns {object|null} outcome（_advanceToNode 的返回值；无进行中战斗节点时 null）
     */
    function settleBattle(result) {
        var active = getActive();
        if (!active || active.status !== 'active') return null;
        var pi = active.pendingInteraction;
        if (!pi || pi.kind !== 'battle') return null;
        var node = active.nodes[pi.nodeId];
        if (!node || !node.battle) return null;
        var victory = (result === 'victory');
        var next = victory ? node.battle.winNext : node.battle.loseNext;
        active.pendingInteraction = null;
        console.log('[SideQuest] 战斗结算: ' + result + ' → ' + next);
        return _advanceToNode(next, victory ? 'battle-win' : 'battle-lose', { reason: victory ? '战胜 ' + (node.battle.enemyName || '') : '败走 ' + (node.battle.enemyName || '') }, { uiIndex: -1 });
    }

    // =========================================================================
    // 奖励结算（白名单 + 夹紧，规避 playerStats.魅力 死键）
    // =========================================================================

    /**
     * 应用 ending 节点 rewards，返回可读明细 [{ label, add }]
     */
    function applyRewards(rewards) {
        var details = [];
        if (!rewards || typeof rewards !== 'object') return details;
        Object.keys(rewards).forEach(function(key) {
            if (!_isRewardKeyAllowed(key)) {
                // 与 validateTree 同款容错：playerStats.{根骨|悟性|心性|魅力} → playerTalents.*
                var m = /^playerStats\.(根骨|悟性|心性|魅力)$/.exec(key);
                if (m) {
                    var fixed = 'playerTalents.' + m[1];
                    rewards[fixed] = rewards[key];
                    delete rewards[key];
                    console.warn('[SideQuest] rewards 键自动纠正: ' + key + ' → ' + fixed);
                    key = fixed;
                } else {
                    console.warn('[SideQuest] rewards 非法键已忽略: ' + key);
                    return;
                }
            }
            var add = rewards[key] && Number(rewards[key].add);
            if (!Number.isFinite(add) || add === 0) return;
            var dotIdx = key.indexOf('.');
            var scope = key.slice(0, dotIdx), field = key.slice(dotIdx + 1);

            if (scope === 'playerStats') {
                var capS = REWARD_CAPS[key];
                add = Math.max(-capS, Math.min(capS, Math.round(add)));
                if (typeof playerStats === 'undefined') return;
                playerStats[field] = (playerStats[field] || 0) + add;
                details.push({ label: field, add: add });
            } else if (scope === 'playerTalents') {
                var capT = REWARD_CAPS[key];
                add = Math.max(-capT, Math.min(capT, Math.round(add)));
                if (typeof playerTalents === 'undefined') return;
                playerTalents[field] = (playerTalents[field] || 0) + add;
                details.push({ label: field, add: add });
            } else if (scope === 'npcFavorability') {
                add = Math.max(-FAVORABILITY_CAP, Math.min(FAVORABILITY_CAP, Math.round(add)));
                if (typeof npcFavorability === 'undefined') return;
                npcFavorability[field] = (npcFavorability[field] || 0) + add;
                var npcName = (typeof npcs !== 'undefined' && npcs[field]) ? npcs[field].name : field;
                details.push({ label: npcName + '好感', add: add });
            }
        });
        if (details.length > 0 && typeof checkAllValueRanges === 'function') checkAllValueRanges();
        return details;
    }

    // =========================================================================
    // 归档（sideQuest.history + 可选 eventHistoryService）
    // =========================================================================

    function _archiveQuest(outcome, failReason) {
        var sq = _sq();
        if (!sq || !sq.active) return;
        var active = sq.active;
        var wk = (typeof currentWeek !== 'undefined') ? currentWeek : 0;

        sq.history.push({
            questId: active.questId,
            title: active.title,
            outcome: outcome,
            endingId: active.endingId || null,
            acceptedWeek: active.acceptedWeek,
            finishedWeek: wk,
            failReason: failReason || null
        });
        if (sq.history.length > HISTORY_CAP) {
            sq.history = sq.history.slice(sq.history.length - HISTORY_CAP);
        }

        // 可选的支线结局 L2 归档。默认在上方 history 写入后直接返回，不生成
        // source:'sideQuest' 事件；保留下方实现供 ARCHIVE_SIDE_QUEST_TO_EVENT_HISTORY=true 时恢复。
        // 开启后事件自动进入向量化与 L2 召回；uiStart/uiEnd=null，不关联 L0 楼层。
        if (!ARCHIVE_SIDE_QUEST_TO_EVENT_HISTORY) return;
        try {
            if (typeof eventHistoryService !== 'undefined' && eventHistoryService.appendEvents) {
                var eid = 'evt-' + (eventHistoryService.getMaxEventId() + 1);
                var endingNode = active.endingId ? active.nodes[active.endingId] : null;
                var desc;
                if (outcome === 'completed') {
                    desc = '支线「' + active.title + '」达成结局「' + (endingNode ? endingNode.title : '') + '」：' + (endingNode ? endingNode.epilogue : '');
                } else if (outcome === 'failed') {
                    desc = '支线「' + active.title + '」失败：' + (failReason || '目标未达成');
                } else {
                    desc = '支线「' + active.title + '」中途放弃。';
                }
                var yr = Math.floor((wk - 1) / 48) + 1, rem = (wk - 1) % 48, mo = Math.floor(rem / 4) + 1, w2 = rem % 4 + 1;
                eventHistoryService.appendEvents([{
                    id: eid,
                    title: '支线·' + active.title,
                    timeLabel: '第' + yr + '年' + mo + '月第' + w2 + '周',
                    description: desc,
                    uiStart: null,
                    uiEnd: null,
                    week: wk,
                    keywords: ['支线', active.title],
                    npc: [],
                    location: (typeof mapLocation !== 'undefined' ? mapLocation : '') || '',
                    causedBy: [],
                    source: 'sideQuest',
                    createdAt: Date.now()
                }]);
            }
        } catch (e) {
            console.warn('[SideQuest] eventHistory 入档失败（不影响主流程）:', e);
        }
    }

    // =========================================================================
    // 主对话注入指导（PROMPT_SQ_GUIDE 五形态）
    // =========================================================================

    /**
     * 渲染 <SideQuestGuide> 注入文本；条件不满足时返回 ''。
     * 注意：ctx 不传 user 变量，模板中的 {{user}} 保持字面（renderTemplate 'keep' 模式）。
     */
    function buildGuideText() {
        if (!isAvailable()) return '';
        var sq = _sq();
        var pendingReturn = sq && sq.pendingReturnFailure;
        if (pendingReturn) {
            // 失败已经落库，即使关闭支线开关也必须交代返程；不依赖 active 或原地点门控。
            var text = function(value) {
                return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            };
            var companionText = Array.isArray(pendingReturn.companions) && pendingReturn.companions.length
                ? pendingReturn.companions.join('、') : '无，独自返程';
            return '<SideQuestGuide>\n' +
                '【支线中途放弃·失败返程】\n' +
                '支线标题：' + text(pendingReturn.title) + '\n' +
                '支线背景：' + text(pendingReturn.background) + '\n' +
                '原任务目标：' + text(pendingReturn.playerGoal) + '\n' +
                '原任务地点：' + text(pendingReturn.originLocation) + '\n' +
                '同行者：' + text(companionText) + '\n' +
                '中止阶段（仅供衔接，勿泄露隐藏节点）：' + text(pendingReturn.currentNodeTitle) + '\n' +
                '已发生的进展：' + text(pendingReturn.progressNotes) + '\n' +
                (pendingReturn.endingPending
                    ? '支线已抵达结局，但善后与结局余韵尚未完成。保留前文已经发生的事实，描写放弃善后收尾的后果；不得推翻已发生的胜负或冒充圆满完结。\n' : '') +
                '确定事实：玩家已确认主动放弃该支线并返回天山派，不得改写为成功、发放奖励、重复扣罚、重开该任务或让同伴代为完成。\n' +
                '写作要求：衔接前文，描写停止当前行动、离开原任务地点、返程以及抵达天山派的过程，适度交代实际同行者的反应与失败余波。无同行者时独自返程，不凭空添加同伴；不要擅自增加死亡、重伤、失去物品等未结算后果。\n' +
                '本轮结尾必须已回到天山派，使用第二人称；正文及总结应记住放弃与失败事实，不得泄露系统、变量、后台规则或本段指导。\n' +
                '</SideQuestGuide>';
        }
        if (!isEnabled()) return '';
        var active = getActive();
        if (!active) return '';
        // 收束轮（status='completed' + pendingEpilogue）仍需注入 ending 指导
        if (active.status !== 'active' && !active.pendingEpilogue) return '';
        // 与剧本链互斥（方案书 §1.3）
        if (typeof currentSpecialEvent !== 'undefined' && currentSpecialEvent) return '';

        var tpl = _poText('SQ_GUIDE', typeof PROMPT_SQ_GUIDE !== 'undefined' ? PROMPT_SQ_GUIDE : '');
        if (!tpl) return '';

        var ctx = { sqQuestTitle: active.title, sqBackground: active.background || '' };
        var form = 'stage';

        if (active.pendingEpilogue && active.endingId && active.nodes[active.endingId]) {
            form = 'ending';
            ctx.sqEpilogue = active.nodes[active.endingId].epilogue || '';
        } else {
            var pi = active.pendingInteraction;
            if (pi && pi.kind === 'choice' && active.nodes[pi.nodeId]) {
                var cn = active.nodes[pi.nodeId];
                form = (pi.state === 'awaiting') ? 'choice_awaiting' : 'choice_buildup';
                ctx.sqNodeTitle = cn.title || '';
                var labels = (cn.options || []).map(function(o) { return o && o.label; }).filter(Boolean);
                ctx.sqChoiceSituation = ((cn.guideHint || '') + ' 可选方向：' + labels.join('、')).trim();
            } else if (pi && pi.kind === 'battle' && active.nodes[pi.nodeId]) {
                var bn = active.nodes[pi.nodeId];
                form = 'battle_buildup';
                ctx.sqNodeTitle = bn.title || '';
                ctx.sqHiddenGoal = bn.hiddenGoal || '';
                ctx.sqGuideHint = bn.guideHint || '';
                ctx.sqBattleIntro = (bn.battle && bn.battle.introText) || '';
                ctx.sqBattleEnemyName = (bn.battle && bn.battle.enemyName) || '对手';
                ctx.sqBattleEnemyCategory = resolveBattleCategory(bn.battle);
                ctx.sqBattleEnemyAppearance = (bn.battle && typeof bn.battle.enemyAppearance === 'string')
                    ? bn.battle.enemyAppearance.trim() : '';
            } else {
                var node = active.nodes[active.currentNodeId];
                if (!node) return '';
                form = 'stage';
                ctx.sqNodeTitle = node.title || '';
                ctx.sqHiddenGoal = node.hiddenGoal || '';
                ctx.sqGuideHint = node.guideHint || '顺其自然，不做刻意铺垫';
            }
        }
        if (!checkStageGates(active)) return '';
        ctx.sqForm = form;

        try {
            return templateEngine.renderPromptTemplate(tpl, ctx).trim();
        } catch (e) {
            console.warn('[SideQuest] guide 渲染失败:', e);
            return '';
        }
    }

    /** 提示词覆盖读取（与 prompt-builder._po 同一约定：key 不带 PROMPT_ 前缀） */
    function _poText(key, fallback) {
        return (typeof promptOverrides !== 'undefined') ? promptOverrides.get(key, fallback) : fallback;
    }

    // =========================================================================
    // 212/213 共用门控：支线唯一地点 + 相关随行 NPC；旧 hardGates/keywords 不参与
    // =========================================================================

    function _companionNpcLetter(value) {
        if (typeof value !== 'string') return '';
        return (typeof npcNameToId !== 'undefined' && npcNameToId[value]) ? npcNameToId[value] : value;
    }

    /** relatedLocations 为空兼容旧支线；relatedNpcs 为空放行，否则任一交集即可。 */
    function checkStageGates(active) {
        var locations = active && Array.isArray(active.relatedLocations) ? active.relatedLocations : [];
        if (locations.length > 0) {
            var cur = (typeof mapLocation !== 'undefined' && mapLocation) ? mapLocation : '天山派';
            if (locations.indexOf(cur) === -1) return false;
        }
        var related = active && Array.isArray(active.relatedNpcs) ? active.relatedNpcs : [];
        if (related.length === 0) return true;
        var companions = (typeof companionNPC !== 'undefined' && Array.isArray(companionNPC))
            ? companionNPC
            : ((typeof gameData !== 'undefined' && gameData && Array.isArray(gameData.companionNPC)) ? gameData.companionNPC : []);
        if (companions.length === 0) return false;
        var companionIds = companions.map(_companionNpcLetter);
        return related.some(function(letter) { return companionIds.indexOf(letter) !== -1; });
    }

    // =========================================================================
    // 调用类模板的 sq* 上下文预计算（210/211/212）
    // =========================================================================

    /** 当前声望可前往的下山支线地点；天山派不进入新生成池。 */
    function getAccessibleLocations() {
        var gd = (typeof gameData !== 'undefined' && gameData) ? gameData : {};
        var reputation = Number(gd.playerStats && gd.playerStats.声望);
        if (!Number.isFinite(reputation) || reputation < 0) reputation = 0;
        return SQ_LOCATIONS.filter(function(loc) {
            return loc !== '天山派' && reputation >= (SQ_LOCATION_REPUTATION[loc] || 0);
        });
    }

    /** 新支线只保留第一个当前可前往的合法地点，整条支线在该地收束。 */
    function sanitizeRelatedLocations(value) {
        if (!Array.isArray(value)) return [];
        var accessibleLocations = getAccessibleLocations();
        for (var i = 0; i < value.length; i++) {
            if (accessibleLocations.indexOf(value[i]) !== -1) return [value[i]];
        }
        return [];
    }

    /** 新支线可选 NPC：神秘杂役 L 不进入传闻或建树素材。 */
    function _isGenerationNpc(letter) {
        return /^[A-O]$/.test(letter) && letter !== 'L';
    }

    function sanitizeRelatedNpcs(value) {
        return Array.isArray(value) ? value.filter(_isGenerationNpc) : [];
    }

    /** 210/211 共享上下文：时间（模板内自算）之外的 sq* 变量 */
    function buildSharedCtx() {
        var gd = (typeof gameData !== 'undefined' && gameData) ? gameData : {};
        var sq = _sq();

        var sqSeason = (typeof seasonNameMap !== 'undefined' && gd.seasonStatus && seasonNameMap[gd.seasonStatus]) || '冬天';
        var sqLocation = (typeof mapLocation !== 'undefined' && mapLocation) || '天山派';

        var ps = gd.playerStats || {};
        var pt = gd.playerTalents || {};
        var sqPlayerStats = '武学' + (ps.武学 || 0) + '、学识' + (ps.学识 || 0) + '、声望' + (ps.声望 || 0) + '、金钱' + (ps.金钱 || 0)
            + '；根骨' + (pt.根骨 || 0) + '、悟性' + (pt.悟性 || 0) + '、心性' + (pt.心性 || 0) + '、魅力' + (pt.魅力 || 0);

        // 已出场 NPC（npcVisibility 为 true 者）带好感度
        var vis = gd.npcVisibility || {};
        var fav = gd.npcFavorability || {};
        var rosterLines = [];
        var npcListLines = [];
        if (typeof npcs !== 'undefined') {
            Object.keys(npcs).forEach(function(letter) {
                if (!npcs[letter] || !npcs[letter].name || !_isGenerationNpc(letter)) return;
                npcListLines.push(letter + '=' + npcs[letter].name);
                if (vis[letter] === true) {
                    rosterLines.push(letter + '=' + npcs[letter].name + '（好感' + (fav[letter] || 0) + '）');
                }
            });
        }
        var sqNpcRoster = rosterLines.length ? rosterLines.join('、') : '（暂无）';
        var sqNpcList = npcListLines.join('、');

        var summaries = (typeof summaryHistoryService !== 'undefined') ? summaryHistoryService.getAll() : [];
        var recent = summaries.slice(-3).map(function(s) { return (s && s.summaryText) || ''; }).filter(Boolean);
        var sqRecentSummaries = recent.length ? recent.join('\n') : '（暂无）';

        var sqEventBaseline = '（暂无）';
        if (typeof eventHistoryService !== 'undefined' && eventHistoryService.getMetaBaseline) {
            try {
                var mb = eventHistoryService.getMetaBaseline('');
                if (mb && mb.trim()) {
                    // 支线编剧只需要客观世界事实；角色弧光与别名表是事件记录的内部写作约束
                    var worldLines = [];
                    var inWorldFacts = false;
                    mb.split(/\r?\n/).forEach(function(line) {
                        if (line.indexOf('【世界事实基线】') === 0) {
                            inWorldFacts = true;
                            worldLines.push(line);
                            return;
                        }
                        if (/^【[^】]+】/.test(line)) inWorldFacts = false;
                        if (inWorldFacts && line.trim()) worldLines.push(line);
                    });
                    if (worldLines.length) sqEventBaseline = worldLines.join('\n');
                }
            } catch (e) { /* 基线缺失不阻断 */ }
        }

        var hist = (sq && Array.isArray(sq.history)) ? sq.history : [];
        var sqHistoryTitles = hist.length ? hist.map(function(h) { return h.title; }).join('、') : '（无）';

        return {
            gameData: gd,
            sqSeason: sqSeason,
            sqLocation: sqLocation,
            sqPlayerStats: sqPlayerStats,
            sqNpcRoster: sqNpcRoster,
            sqRecentSummaries: sqRecentSummaries,
            sqEventBaseline: sqEventBaseline,
            sqHistoryTitles: sqHistoryTitles,
            sqLocationList: getAccessibleLocations().join('、'),
            sqNpcList: sqNpcList,
            sqEnemyBlacklist: ENEMY_NAME_BLACKLIST.join('、')
        };
    }

    /** 211 建树上下文：共享上下文 + 选中传闻字段 */
    function buildTreeCtx(rumor) {
        var ctx = buildSharedCtx();
        var npcNames = sanitizeRelatedNpcs(rumor.relatedNpcs).map(function(l) {
            return (typeof npcs !== 'undefined' && npcs[l]) ? (l + '=' + npcs[l].name) : l;
        });
        ctx.sqRumorTitle = rumor.title || '';
        ctx.sqRumorBackground = rumor.background || '';
        ctx.sqRumorGoal = rumor.playerGoal || '';
        ctx.sqRelatedNpcs = npcNames.length ? npcNames.join('、') : '（无）';
        ctx.sqRelatedLocations = (Array.isArray(rumor.relatedLocations) && rumor.relatedLocations.length) ? rumor.relatedLocations[0] : '（未指定）';
        ctx.sqDifficulty = rumor.difficulty || '普通';

        var rules = _getTreeRules(ctx.sqDifficulty);
        ctx.sqNodeMin = rules.profile.nodeMin;
        ctx.sqNodeMax = rules.profile.nodeMax;
        ctx.sqStageMin = rules.profile.stageMin;
        ctx.sqStageMax = rules.profile.stageMax;
        ctx.sqEndingMin = rules.profile.endingMin;
        ctx.sqEndingMax = rules.profile.endingMax;
        ctx.sqBattleRequired = rules.profile.battleMin === 1;
        ctx.sqPlayerStage = rules.playerStage;
        ctx.sqEnemyLevelMin = rules.enemyLevelMin;
        ctx.sqEnemyLevelMax = rules.enemyLevelMax;
        ctx.sqEnemyLevel = rules.enemyLevel;
        ctx.sqBattleRewardGold = rules.battleRewardGold;
        ctx.sqRewardStatCap = rules.rewardStatCap;
        ctx.sqRewardReputationCap = rules.rewardReputationCap;
        ctx.sqRewardGoldCap = rules.rewardGoldCap;
        ctx.sqRewardTalentCap = rules.rewardTalentCap;
        ctx.sqRewardFavorCap = rules.rewardFavorCap;
        return ctx;
    }

    /**
     * 212 判定上下文
     * @param {string} userInputText - 玩家输入（或占位「见上方素材」）
     * @param {string} mainTextText - 本轮正文（或占位「见上方素材」）
     */
    function buildJudgeCtx(active, node, userInputText, mainTextText) {
        var sumBlock = '';
        if (typeof summaryHistoryService !== 'undefined') {
            var all = summaryHistoryService.getAll();
            var last = all.slice(-2).map(function(s) { return (s && s.summaryText) || ''; }).filter(Boolean);
            if (last.length) sumBlock = '\n近期剧情摘要（背景参考）：\n' + last.join('\n') + '\n';
        }

        return {
            sqQuestTitle: active.title,
            sqNodeTitle: node.title || '',
            sqHiddenGoal: node.hiddenGoal || '',
            sqSuccessCriteria: node.successCriteria || '',
            sqFailCriteria: node.failCriteria || '',
            sqProgressNotes: active.progressNotes || '（暂无）',
            sqUserInput: userInputText,
            sqMainText: mainTextText,
            sqSummaryBlock: sumBlock
        };
    }

    // 支线限额在选择接取时记当周；完成/失败若跨周，再占用结算周，与悬赏一致。
    function _setCurrentWeekUsed(sq) {
        if (!sq) return;
        sq.lastRefreshWeek = (typeof currentWeek !== 'undefined') ? currentWeek : 0;
    }

    function markCurrentWeekUsed() {
        var sq = _sq();
        if (!sq) return;
        _setCurrentWeekUsed(sq);
        _persist();
    }

    // =========================================================================
    // 待建树传闻（接取已记账但剧情树尚未生成成功）
    // =========================================================================

    /** @returns {object|null} { rumor, index, week } */
    function getPendingTree() {
        var sq = _sq();
        return (sq && sq.pendingTree) ? sq.pendingTree : null;
    }

    function setPendingTree(rumor, index) {
        var sq = _sq();
        if (!sq) return;
        sq.pendingTree = {
            rumor: rumor,
            index: index,
            week: (typeof currentWeek !== 'undefined') ? currentWeek : 0
        };
        _persist();
    }

    function clearPendingTree() {
        var sq = _sq();
        if (!sq || !sq.pendingTree) return;
        sq.pendingTree = null;
        _persist();
    }

    function rumorRefreshUsed() {
        var sq = _sq();
        if (!sq) return true;
        return sq.lastRefreshWeek === ((typeof currentWeek !== 'undefined') ? currentWeek : -1);
    }

    function setJudgeDisabled(disabled) {
        var sq = _sq();
        if (!sq) return;
        sq.judgeDisabled = !!disabled;
        _persist();
    }

    return {
        isAvailable: isAvailable,
        isEnabled: isEnabled,
        getActive: getActive,
        suppressesRandomEvents: suppressesRandomEvents,
        getReturnRisk: getReturnRisk,
        markStarted: markStarted,
        getHistory: getHistory,
        getCurrentNode: getCurrentNode,
        resolveBattleCategory: resolveBattleCategory,
        validateTree: validateTree,
        acceptQuest: acceptQuest,
        abandonQuest: abandonQuest,
        applyJudgement: applyJudgement,
        applyChoice: applyChoice,
        settleBattle: settleBattle,
        applyRewards: applyRewards,
        failQuest: failQuest,
        failQuestForReturn: failQuestForReturn,
        getPendingReturnFailure: getPendingReturnFailure,
        clearPendingReturnFailure: clearPendingReturnFailure,
        finalizeEpilogue: finalizeEpilogue,
        buildGuideText: buildGuideText,
        checkStageGates: checkStageGates,
        getAccessibleLocations: getAccessibleLocations,
        sanitizeRelatedLocations: sanitizeRelatedLocations,
        sanitizeRelatedNpcs: sanitizeRelatedNpcs,
        buildSharedCtx: buildSharedCtx,
        buildTreeCtx: buildTreeCtx,
        buildJudgeCtx: buildJudgeCtx,
        rumorRefreshUsed: rumorRefreshUsed,
        markCurrentWeekUsed: markCurrentWeekUsed,
        getPendingTree: getPendingTree,
        setPendingTree: setPendingTree,
        clearPendingTree: clearPendingTree,
        setJudgeDisabled: setJudgeDisabled,
        ENEMY_NAME_BLACKLIST: ENEMY_NAME_BLACKLIST,
        SQ_LOCATIONS: SQ_LOCATIONS
    };
})();
