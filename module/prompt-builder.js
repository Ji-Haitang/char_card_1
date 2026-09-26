/**
 * prompt-builder.js - Prompt 编排（双预设：ny 6 条消息 / 夏瑾 4 条消息）
 * gameData.promptPreset 选择预设（通用设置下拉框，默认 'ny'）：
 *
 * 【ny 预设】与“开发文档/实际的log-迭代.md”一致：
 *   msg1: system    (PROMPT_OPENING：开头两行 + <settings> + role_user 身份说明 + <role_user>，仅此)
 *   msg2: user      (角色行为授权 </role_user> + <tone> + <main_settings> + [Additional settings…地点+世界书1] + </settings>
 *                    + <background> + <writing_style> + <history>([Start a new Chat] + HistorySummary，内含 MainNPCs/UserInfo) + <LatestReply> 开标签)
 *   msg3: assistant (上一次 AI 回复的正文原文)
 *   msg4: user      (</LatestReply></history> + <fresh> + 世界书2 + <user_input> + MainTextGuidance + 105 + </background> + Order[内含110格式规范 + ThinkGuidance])
 *   msg5: assistant (jailbreak prefill)
 *   msg6: user      (final instruction)
 *
 * 【夏瑾预设】与“开发文档/夏瑾预设新log.md”一致：
 *   msg1: system    (PROMPT_XJ_SYSTEM 整条固定文本，含内嵌假对话)
 *   msg2: user      (任务介绍 + <第一写作指导> + <相关资料>[{{user}}设定 + 010(StoryBackground/TianshanSectNPCs/KemonomimiSettings) + 地点 + 世界书1]
 *                    + <互动历史>(HistorySummary) + <LatestReply> 开标签 + 说明文字)
 *   msg3: assistant (上一次 AI 回复的正文原文)
 *   msg4: user      (</LatestReply></互动历史> + 世界书2 + <user_input> + <可用信息列表>[MainTextGuidance + 105]
 *                    + <核心指导> + <输出模板>[110 + 输出模板说明] + 任务链)
 *
 * NSFW 提示词解锁（两套预设共用）：gameData.enamor==1 或当前 BGM 为暧昧清单
 * （bgmFileManifest.暧昧）之一即解锁；BGM 触发时用 enamor=1 的 gameData 浅克隆渲染模板，
 * 各模板的 EJS 门控（gameData.enamor）随之自动解锁，不影响真实存档数据。
 *
 * 依赖：template-engine.js, prompt-data-core.js, prompt-data-extra.js,
 *        prompt-data-npc.js, prompt-data-actions.js, worldbook-engine.js,
 *        token-utils.js, api-service.js, game-config.js（bgmFileManifest）
 */

var promptBuilder = (function() {

    /**
     * 提示词覆盖读取简写：有用户自定义则用自定义，否则用原始常量
     */
    function _po(key, fallback) {
        return (typeof promptOverrides !== 'undefined') ? promptOverrides.get(key, fallback) : fallback;
    }

    // --- 地点信息（PROMPT_CORE_020）拆分为按地点单独编辑的字典 ---
    // GameMode==0 时固定使用"天山派"，GameMode!=1 时按 gameData.mapLocation 选取下列地点之一
    var LOCATION_ORDER = [
        '伊州', '千佛洞', '博斯坦村', '博格达峰', '哈密绿洲', '大沙海', '天山派外堡',
        '崆峒派', '拜火教总坛', '昆仑派', '月牙泉', '沙州', '瓜州', '白驼山',
        '迪坎儿村', '高昌', '龟兹'
    ];
    var LOCATION_REGISTRY = ['天山派'].concat(LOCATION_ORDER);
    var _locationDefaults = null; // 懒加载，首次使用时从 PROMPT_CORE_020 解析

    /**
     * 从原始 PROMPT_CORE_020 模板（未经 EJS 渲染的字符串）中，按已知地点名切出每个地点的原始正文，
     * 用于「提示词管理」弹窗展示默认内容 / 恢复默认，以及运行时按地点单独取用（支持覆盖）
     */
    function _parseLocationDefaults() {
        var map = {};
        var tpl = (typeof PROMPT_CORE_020 !== 'undefined') ? PROMPT_CORE_020 : '';
        if (!tpl) return map;

        // 天山派（GameMode==0 分支）
        var s0Marker = '<%_ if (GameModeforLocation == 0) { _%>';
        var e0Marker = '<%_ } else { _%>';
        var s0 = tpl.indexOf(s0Marker);
        var e0 = tpl.indexOf(e0Marker);
        if (s0 !== -1 && e0 !== -1 && e0 > s0) {
            map['天山派'] = tpl.slice(s0 + s0Marker.length, e0).replace(/^\n+|\n+$/g, '');
        }

        // 各 mapLocation 分支
        for (var i = 0; i < LOCATION_ORDER.length; i++) {
            var loc = LOCATION_ORDER[i];
            var startMarker = (i === 0)
                ? "<%_ if (mapLocationforLocation == '" + loc + "') { _%>"
                : "<%_ } else if (mapLocationforLocation == '" + loc + "') { _%>";
            var startIdx = tpl.indexOf(startMarker);
            if (startIdx === -1) continue;
            var contentStart = startIdx + startMarker.length;
            var endIdx;
            if (i < LOCATION_ORDER.length - 1) {
                var nextMarker = "<%_ } else if (mapLocationforLocation == '" + LOCATION_ORDER[i + 1] + "') { _%>";
                endIdx = tpl.indexOf(nextMarker, contentStart);
            } else {
                endIdx = -1;
            }
            if (endIdx === -1) {
                // 最后一个地点，或找不到下一个标记：截止到收尾的 "<%_ } _%>\n<%_ } _%>"
                endIdx = tpl.indexOf('<%_ } _%>\n<%_ } _%>', contentStart);
            }
            if (endIdx === -1) endIdx = tpl.length;
            map[loc] = tpl.slice(contentStart, endIdx).replace(/^\n+|\n+$/g, '');
        }
        return map;
    }

    function _getLocationDefaults() {
        if (!_locationDefaults) _locationDefaults = _parseLocationDefaults();
        return _locationDefaults;
    }

    /**
     * 取单个地点的编译期默认正文（地点信息迭代新增，供 location-runner.js 在该地点从未被 AI 更新过时兜底取用）
     */
    function getPromptLocationDefault(location) {
        return _getLocationDefaults()[location] || '';
    }

    /**
     * 渲染单个子场景块（地点信息迭代新增）：把 {介绍, 备注, 任意其它标题:[...]}
     * 渲染回和原文同款缩进格式的文本片段，"介绍"在最前，"备注"在最后，其余按对象自身key顺序排列
     */
    function _renderSubSceneBlock(name, entry, indent) {
        entry = entry || {};
        var lines = [indent + name + ':'];
        var innerIndent = indent + '  ';
        if (entry['介绍'] !== undefined) lines.push(innerIndent + '介绍: ' + entry['介绍']);
        Object.keys(entry).forEach(function(k) {
            if (k === '介绍' || k === '备注') return;
            var v = entry[k];
            if (Array.isArray(v)) {
                lines.push(innerIndent + k + ':');
                v.forEach(function(item) { lines.push(innerIndent + '  - ' + item); });
            } else if (typeof v === 'string') {
                lines.push(innerIndent + k + ': ' + v);
            }
        });
        if (entry['备注'] !== undefined) lines.push(innerIndent + '备注: ' + entry['备注']);
        return lines.join('\n');
    }

    /**
     * 把结构化的地点数据（locationMemory[location]）渲染回和 020地点介绍.txt 同款缩进格式的文本（地点信息迭代新增）
     * 供两处使用：1) _renderLocationIntro 注入最终 prompt；2) location-runner.js 组装"当前地点信息"喂给下一次 LLM 请求
     */
    function renderLocationText(location, data) {
        if (!data) return '';
        var lines = [location + ':', '  概览:'];
        if (data['危险度']) {
            lines.push('    危险度:');
            lines.push('      评级: ' + (data['危险度']['评级'] || ''));
            lines.push('      说明: ' + (data['危险度']['说明'] || ''));
        }
        if (data['友善度']) {
            lines.push('    友善度:');
            lines.push('      评级: ' + (data['友善度']['评级'] || ''));
            lines.push('      说明: ' + (data['友善度']['说明'] || ''));
        }
        if (Array.isArray(data['行动建议']) && data['行动建议'].length > 0) {
            lines.push('    行动建议:');
            data['行动建议'].forEach(function(item) { lines.push('      - ' + item); });
        }
        if (data['子场景'] && typeof data['子场景'] === 'object') {
            lines.push('  子场景:');
            Object.keys(data['子场景']).forEach(function(name) {
                lines.push(_renderSubSceneBlock(name, data['子场景'][name], '    '));
            });
        }
        return lines.join('\n');
    }

    /**
     * 渲染 <LocationIntroduction> 块：按 GameMode/mapLocation 选取地点
     * v0.6 更新（地点信息迭代）：取消 promptOverrides 中间层，优先级简化为 locationMemory（存档自身演变值）→ 编译期默认正文
     */
    function _renderLocationIntro(gd) {
        gd = gd || {};
        var key = (gd.GameMode == 0) ? '天山派' : (gd.mapLocation || '天山派外堡');
        var defaults = _getLocationDefaults();
        var memoryEntry = (typeof storageService !== 'undefined' && storageService.loadLocationMemory)
            ? storageService.loadLocationMemory()[key] : null;
        var bodyFromMemory = memoryEntry ? renderLocationText(key, memoryEntry) : '';
        var body = bodyFromMemory || defaults[key] || '';
        return '\n<!-- <LocationIntroduction> is the introduction of current location in story -->\n<LocationIntroduction>\n说明: 当前{{user}}在下面介绍的地点活动，请以该地点作为故事发展的舞台，合理推进剧情，输出文本\n' +
            body + '\n</LocationIntroduction>   \n';
    }

    /**
     * 把地点介绍文本（编译期默认正文，或 renderLocationText 生成的文本）解析回结构化对象（地点信息迭代新增）
     * 与 renderLocationText 互为逆运算，供「提示词管理」结构化编辑器在该地点从未被 AI 更新过时，
     * 从编译期默认文本引导出一份初始结构化数据，而不需要给17个地点手工另写一份JSON默认值
     * @returns {object} { 危险度:{评级,说明}|null, 友善度:{评级,说明}|null, 行动建议:string[], 子场景:{名:{介绍,备注,标签:string[]}} }
     */
    function parseLocationText(text) {
        var result = { 危险度: null, 友善度: null, 行动建议: [], 子场景: {} };
        if (!text) return result;
        var rawLines = String(text).split('\n');
        var lines = [];
        for (var i = 0; i < rawLines.length; i++) {
            if (!rawLines[i].trim()) continue;
            var m = rawLines[i].match(/^(\s*)(.*?)\s*$/);
            lines.push({ indent: m[1].length, content: m[2] });
        }
        if (lines.length === 0) return result;

        function parseKV(content) {
            var mm = content.match(/^([^:]+):\s*(.*)$/);
            if (!mm) return null;
            return { key: mm[1].trim(), value: mm[2].trim() };
        }

        var idx = 1; // 第一行是「地点名:」，跳过
        while (idx < lines.length) {
            var line = lines[idx];
            var top = line.content.replace(/:$/, '');
            if (top === '概览') {
                var overviewIndent = line.indent;
                idx++;
                while (idx < lines.length && lines[idx].indent > overviewIndent) {
                    var sub = lines[idx];
                    var subKey = sub.content.replace(/:$/, '');
                    if (subKey === '危险度' || subKey === '友善度') {
                        var levelIndent = sub.indent;
                        idx++;
                        var obj = { 评级: '', 说明: '' };
                        while (idx < lines.length && lines[idx].indent > levelIndent) {
                            var kv = parseKV(lines[idx].content);
                            if (kv) obj[kv.key] = kv.value;
                            idx++;
                        }
                        result[subKey] = obj;
                    } else if (subKey === '行动建议') {
                        var adviceIndent = sub.indent;
                        idx++;
                        var arr = [];
                        while (idx < lines.length && lines[idx].indent > adviceIndent) {
                            var itemLine = lines[idx].content;
                            if (itemLine.indexOf('- ') === 0) arr.push(itemLine.slice(2).trim());
                            idx++;
                        }
                        result['行动建议'] = arr;
                    } else {
                        idx++;
                    }
                }
            } else if (top === '子场景') {
                var sceneListIndent = line.indent;
                idx++;
                while (idx < lines.length && lines[idx].indent > sceneListIndent) {
                    var sceneLine = lines[idx];
                    var sceneName = sceneLine.content.replace(/:$/, '');
                    var sceneIndent = sceneLine.indent;
                    idx++;
                    var sceneObj = {};
                    while (idx < lines.length && lines[idx].indent > sceneIndent) {
                        var fLine = lines[idx];
                        var mm2 = fLine.content.match(/^([^:]+):\s*(.*)$/);
                        if (!mm2) { idx++; continue; }
                        var fKey = mm2[1].trim();
                        var fVal = mm2[2].trim();
                        if (fVal) {
                            sceneObj[fKey] = fVal; // 介绍/备注：单行值
                            idx++;
                        } else {
                            // 无值 → 该标签下是列表
                            var listIndent = fLine.indent;
                            idx++;
                            var list = [];
                            while (idx < lines.length && lines[idx].indent > listIndent) {
                                var li = lines[idx].content;
                                if (li.indexOf('- ') === 0) list.push(li.slice(2).trim());
                                idx++;
                            }
                            sceneObj[fKey] = list;
                        }
                    }
                    result['子场景'][sceneName] = sceneObj;
                }
            } else {
                idx++;
            }
        }
        return result;
    }

    // 暴露地点注册表和默认内容表，供「提示词管理」弹窗使用
    window.LOCATION_REGISTRY = LOCATION_REGISTRY;
    window.getPromptLocationDefaults = _getLocationDefaults;
    window.getPromptLocationDefault = getPromptLocationDefault;
    window.renderLocationText = renderLocationText;
    window.parseLocationText = parseLocationText;

    /**
     * 获取 token 预算配置
     */
    function _getBudgetConfig() {
        var cfg = (typeof apiService !== 'undefined') ? apiService.getConfig() : {};
        return {
            maxContext: cfg.maxContextTokens || 128000,
            reservedOutput: cfg.maxOutputTokens || 8192
        };
    }

    /**
     * 将 week 数字转换为 [第X年第X月第X周] 格式
     */
    function _weekToTimestamp(week) {
        var year = Math.floor((week - 1) / 48) + 1;
        var remainingWeeks = (week - 1) % 48;
        var month = Math.floor(remainingWeeks / 4) + 1;
        var w = remainingWeeks % 4 + 1;
        return '[第' + year + '年第' + month + '月第' + w + '周]';
    }

    /**
     * 选取 RecentMemories：summaryHistory 中 week >= (最后一条 weekHistory.markWeek - 1) 的条目
     * weekHistory 为空时取全部 summaryHistory
     */
    function _selectRecentSummaries(summaryHistory, weekHistory) {
        if (!summaryHistory || summaryHistory.length === 0) return [];
        var threshold = 1;
        if (weekHistory && weekHistory.length > 0) {
            var lastEntry = weekHistory[weekHistory.length - 1];
            var lastMarkWeek = lastEntry.markWeek || lastEntry.week || 1;
            threshold = lastMarkWeek;
        }
        return summaryHistory.filter(function(entry) {
            return (entry.week || 1) >= threshold;
        });
    }

    /**
     * PreviousMemories：在 token 预算内从最新到最旧保留 weekHistory 条目
     */
    function _selectPreviousWithinBudget(weekHistory, budgetTokens) {
        if (!weekHistory || weekHistory.length === 0) return [];
        var selected = [];
        var used = 0;
        for (var i = weekHistory.length - 1; i >= 0; i--) {
            var text = weekHistory[i].summaryText || '';
            var tokens = tokenUtils.estimate(text);
            if (used + tokens > budgetTokens) break;
            selected.unshift(weekHistory[i]);
            used += tokens;
        }
        return selected;
    }

    /**
     * 递归渲染因果链（内联树形，小白X风格）。
     * @param {object} eventObj  - 当前事件对象（含 causedBy）
     * @param {object} priorById - id→事件 字典
     * @param {number} visualDepth - 视觉缩进层级（从1开始，每一跳都 +1，不受合并影响，保证树形缩进正常递进）
     * @param {number} budgetDepth - 追溯配额层级（从1开始；命中"链路合并"节点后重置为1，与 traceCausation 的
     *        "合并后重新4层配额"对齐；超过4时截断渲染——即使数据已经追溯到了也不再展开，避免层级失控）
     * @param {object} visited   - 防环 visited 集合
     * @param {object} [absorbedSet] - id→true 的集合，标记该 id 是否为"链路合并"节点（本身也是本轮直接命中事件）
     * @returns {string[]} 渲染行数组
     */
    function _renderCausalChain(eventObj, priorById, visualDepth, budgetDepth, visited, absorbedSet) {
        if (budgetDepth > 4) return [];
        var lines = [];
        var causedBy = Array.isArray(eventObj.causedBy) ? eventObj.causedBy : [];
        // 每一层缩进：第1层 "  "，第2层 "  │  "，第3层 "  │  │  "…（用 visualDepth，合并链也持续加深缩进）
        var indent = '  ' + '│  '.repeat(visualDepth - 1);
        for (var i = 0; i < causedBy.length; i++) {
            var cid = causedBy[i];
            if (!cid || visited[cid]) continue;
            var ce = priorById[cid];
            if (!ce) continue;
            visited[cid] = true;
            lines.push(indent + '├─ 前因 ' + _weekToTimestamp(ce.week || 1) + (ce.title ? ' ' + ce.title : ''));
            lines.push(indent + '│     ' + (ce.description || ''));
            // 合并节点：追溯配额从这里重新计（对齐 traceCausation 的"合并后重新4层配额"），但视觉缩进照常递增
            var childBudgetDepth = (absorbedSet && absorbedSet[cid]) ? 1 : budgetDepth + 1;
            var childLines = _renderCausalChain(ce, priorById, visualDepth + 1, childBudgetDepth, visited, absorbedSet);
            for (var ci = 0; ci < childLines.length; ci++) lines.push(childLines[ci]);
        }
        return lines;
    }

    /**
     * 判定实体名是否在（本次用户输入 + 上一次 AI 回复）文本中出现，与 worldbookEngine.matchNPCs 的
     * 在场判定规则保持一致（纯子串匹配）。
     */
    function _isPresentIn(searchText, name) {
        return !!name && !!searchText && searchText.indexOf(name) !== -1;
    }

    /**
     * 构建 [已确立事实] 文本块。
     * eventMeta.facts 的 key 形如 "主体|谓语"（如 "洛潜幽|对叶情凡的看法"）。
     * 在场判定：主体名出现在 searchText（本次用户输入 + 上一次 AI 回复）中。
     * 每个在场主体最多注入 10 条 isState===true 或 谓语以"看法"结尾 的事实，按 _addedAt 新→旧排序。
     * @param {string} searchText
     * @param {number} tokenBudget
     * @returns {string} 正文（不含 [已确立事实] 标题行），无内容时返回空串
     */
    function _buildFactsSection(searchText, tokenBudget) {
        if (typeof eventHistoryService === 'undefined') return '';
        var meta = eventHistoryService.getMeta();
        var facts = meta.facts || {};
        var keys = Object.keys(facts);
        if (keys.length === 0) return '';

        var bySubject = {};
        var subjectOrder = [];
        for (var i = 0; i < keys.length; i++) {
            var fk = keys[i];
            var sepIdx = fk.indexOf('|');
            if (sepIdx < 0) continue;
            var subject = fk.slice(0, sepIdx);
            var predicate = fk.slice(sepIdx + 1);
            var fact = facts[fk];
            if (!fact) continue;
            if (!(fact.isState === true || /看法$/.test(predicate))) continue;
            if (!_isPresentIn(searchText, subject)) continue;
            if (!bySubject[subject]) { bySubject[subject] = []; subjectOrder.push(subject); }
            bySubject[subject].push({ p: predicate, fact: fact });
        }
        if (subjectOrder.length === 0) return '';

        var lines = [];
        var used = 0;
        for (var s = 0; s < subjectOrder.length; s++) {
            var subj = subjectOrder[s];
            var arr = bySubject[subj];
            arr.sort(function(a, b) { return (b.fact._addedAt || 0) - (a.fact._addedAt || 0); });
            arr = arr.slice(0, 10);

            var subjLines = [subj + ':'];
            for (var k = 0; k < arr.length; k++) {
                var fd = arr[k];
                subjLines.push('  - ' + fd.p + ': ' + (fd.fact.o || ''));
            }
            var block = subjLines.join('\n');
            var t = tokenUtils.estimate(block);
            if (used + t > tokenBudget && lines.length > 0) break;
            lines.push(block);
            used += t;
        }
        return lines.join('\n');
    }

    /**
     * 构建 [人物弧光] 文本块。
     * 在场判定：eventMeta.arcs 的角色名出现在 searchText 中。
     * 展示格式：trajectory（旧→新，FIFO 数组）用 → 串联，最右边追加 newMoment（若非空）。
     * @param {string} searchText
     * @param {number} tokenBudget
     * @returns {string} 正文（不含 [人物弧光] 标题行），无内容时返回空串
     */
    function _buildArcsSection(searchText, tokenBudget) {
        if (typeof eventHistoryService === 'undefined') return '';
        var meta = eventHistoryService.getMeta();
        var arcs = meta.arcs || {};
        var names = Object.keys(arcs);
        if (names.length === 0) return '';

        var candidates = [];
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (!_isPresentIn(searchText, name)) continue;
            candidates.push({ name: name, arc: arcs[name] });
        }
        if (candidates.length === 0) return '';
        candidates.sort(function(a, b) { return (b.arc._addedAt || 0) - (a.arc._addedAt || 0); });

        var lines = [];
        var used = 0;
        for (var c = 0; c < candidates.length; c++) {
            var name = candidates[c].name;
            var arc = candidates[c].arc;
            var trajArr = Array.isArray(arc.trajectory) ? arc.trajectory.slice()
                : (arc.trajectory ? [String(arc.trajectory)] : []);
            if (arc.newMoment) trajArr.push(arc.newMoment);
            if (trajArr.length === 0) continue;
            var ln = '- ' + name + '：' + trajArr.join(' → ');
            var t = tokenUtils.estimate(ln);
            if (used + t > tokenBudget && lines.length > 0) break;
            lines.push(ln);
            used += t;
        }
        return lines.join('\n');
    }

    /**
     * 构建 RecalledMemories 块（[已确立事实] + [人物弧光] + L2 剧情事件 + 孤儿 L0 统一）。
     * L2 部分用 [相关历史事件] 格式（内联因果树 + L0 证据锚点）；
     * 孤儿 L0 用 [相关碎片记忆] 格式。
     * @param {{direct:Array, priorById:object}|null} recalledEvents
     * @param {Array} recalledMemories - 孤儿 L0 数组
     * @param {string} [searchText] - 本次用户输入 + 上一次 AI 回复，用于 [已确立事实]/[人物弧光] 在场判定
     * @param {object} [recallConfig] - gameData.recallConfig：{facts,arcs,events,fragments} 各带 {enabled,maxTokens}
     */
    function _buildRecalledBlock(recalledEvents, recalledMemories, searchText, recallConfig) {
        var direct = (recalledEvents && recalledEvents.direct) || [];
        var priorById = (recalledEvents && recalledEvents.priorById) || {};
        var absorbedSet = {};
        var _absorbedIds = (recalledEvents && recalledEvents.absorbedIds) || [];
        for (var _asi = 0; _asi < _absorbedIds.length; _asi++) absorbedSet[_absorbedIds[_asi]] = true;
        var orphans = recalledMemories || [];
        var cfg = recallConfig || {};
        var factsCfg = cfg.facts || {};
        var arcsCfg = cfg.arcs || {};
        var eventsCfg = cfg.events || {};
        var fragmentsCfg = cfg.fragments || {};

        var factsText = (factsCfg.enabled !== false) ? _buildFactsSection(searchText || '', factsCfg.maxTokens || 2000) : '';
        var arcsText = (arcsCfg.enabled !== false) ? _buildArcsSection(searchText || '', arcsCfg.maxTokens || 1000) : '';
        var showEvents = (eventsCfg.enabled !== false) && direct.length > 0;
        var showFragments = (fragmentsCfg.enabled !== false) && orphans.length > 0;

        if (!factsText && !arcsText && !showEvents && !showFragments) return '';

        var lines = [];
        lines.push('<!-- <RecalledMemories> contains recalled plot events and background evidence relevant to the current action. -->');
        lines.push('');
        lines.push('<RecalledMemories>');

        // --- [已确立事实] 在场主体的已确立事实（isState 或 看法类）---
        if (factsText) {
            lines.push('');
            lines.push('[已确立事实]');
            lines.push('');
            lines.push(factsText);
        }

        // --- [人物弧光] 在场角色的弧光轨迹（trajectory → ... → newMoment）---
        if (arcsText) {
            lines.push('');
            lines.push('[人物弧光]');
            lines.push('');
            lines.push(arcsText);
        }

        // --- [相关历史事件] L2 直接命中事件（内联因果链 + L0 证据）---
        // 按时间顺序排序仅用于展示（越靠下越新），不影响上游的选择/token预算逻辑
        if (showEvents) {
            var sortedDirect = direct.slice().sort(function(a, b) {
                return ((a.event && a.event.week) || 0) - ((b.event && b.event.week) || 0);
            });
            lines.push('');
            lines.push('[相关历史事件]');
            lines.push('');
            for (var i = 0; i < sortedDirect.length; i++) {
                var ev = sortedDirect[i].event || {};
                var evidence = sortedDirect[i].evidence || [];
                lines.push((i + 1) + '. ' + _weekToTimestamp(ev.week || 1) + (ev.title ? ' ' + ev.title : ''));
                lines.push(ev.description || '');

                // 因果链（内联树形）
                var causalLines = _renderCausalChain(ev, priorById, 1, 1, {}, absorbedSet);
                for (var ci = 0; ci < causalLines.length; ci++) lines.push(causalLines[ci]);

                // L0 证据锚点
                for (var e = 0; e < evidence.length; e++) {
                    if (evidence[e] && evidence[e].text) {
                        var _evWeekStamp = _weekToTimestamp(evidence[e].week || 1);
                        lines.push('  事件细节[📌' + _evWeekStamp.slice(1) + ' ' + evidence[e].text);
                    }
                }

                if (i < sortedDirect.length - 1) lines.push('');
            }
        }

        // --- [相关碎片记忆] 孤儿 L0（未被任何事件覆盖）---
        // 同样按时间顺序排序仅用于展示（越靠下越新）
        if (showFragments) {
            var sortedOrphans = orphans.slice().sort(function(a, b) {
                return ((a && a.week) || 0) - ((b && b.week) || 0);
            });
            lines.push('');
            lines.push('[相关碎片记忆]');
            lines.push('');
            for (var j = 0; j < sortedOrphans.length; j++) {
                var rm = sortedOrphans[j];
                if (rm && rm.text) {
                    var _rmWeekStamp = _weekToTimestamp(rm.week || 1);
                    lines.push('[📌' + _rmWeekStamp.slice(1) + ' ' + rm.text);
                }
            }
        }

        lines.push('');
        lines.push('</RecalledMemories>');
        return lines.join('\n');
    }

    /**
     * 构建 HistorySummary 块（三段式结构 + MainNPCs/UserInfo）
     * 结构：PreviousMemories → MainNPCs → UserInfo → RecalledMemories → RecentMemories
     * @param {Array} previousMemories  - 经预算截断的 weekHistory 条目
     * @param {Array} recentSummaries   - 近期 summaryHistory 条目（RecentMemories）
     * @param {Array} recalledMemories  - 向量召回的孤儿 L0 条目
     * @param {object} [recalledEvents] - L2 召回事件 { direct, priorById }
     * @param {string} [searchText]     - 本次用户输入 + 上一次 AI 回复，用于 [已确立事实]/[人物弧光] 在场判定
     * @param {object} [recallConfig]   - gameData.recallConfig
     * @param {string} [npcUserBlock]   - MainNPCs + UserInfo 预渲染块（置于 </PreviousMemories> 与召回记忆之间）
     */
    function _buildHistorySummaryBlock(previousMemories, recentSummaries, recalledMemories, recalledEvents, searchText, recallConfig, npcUserBlock) {
        var lines = ['<!-- <HistorySummary> is a brief summary of what has happened so far. Please read it to continue the story. -->'];
        lines.push('');
        lines.push('<HistorySummary>');

        // --- PreviousMemories：周总结历史 ---
        lines.push('');
        lines.push('<!-- <PreviousMemories> contains week-level summaries of past events. Use them as background context. -->');
        lines.push('');
        lines.push('<PreviousMemories>');
        if (previousMemories && previousMemories.length > 0) {
            for (var i = 0; i < previousMemories.length; i++) {
                var pe = previousMemories[i];
                var peText = (pe.summaryText || '').replace(/\n?\[至\d+周的历史记录\]\s*$/, '').trim();
                lines.push('');
                lines.push(peText);
            }
        }
        lines.push('');
        lines.push('</PreviousMemories>');

        // --- MainNPCs + UserInfo（本轮在场 NPC 信息与主角信息，置于历史周总结之后、召回记忆之前）---
        if (npcUserBlock) {
            lines.push('');
            lines.push(npcUserBlock);
        }

        // --- RecalledMemories：[已确立事实] + [人物弧光] + [相关历史事件]（内联因果树 + L0 证据）+ [相关碎片记忆] 孤儿 L0 ---
        var recalledBlock = _buildRecalledBlock(recalledEvents, recalledMemories, searchText, recallConfig);
        if (recalledBlock) {
            lines.push('');
            lines.push(recalledBlock);
        }

        // --- RecentMemories：最近几周的 summaryHistory ---
        lines.push('');
        lines.push('<!-- <RecentMemories> contains recent turn-by-turn summaries. Use them to understand the current situation. -->');
        lines.push('');
        lines.push('<RecentMemories>');
        if (recentSummaries && recentSummaries.length > 0) {
            for (var k = 0; k < recentSummaries.length; k++) {
                var rs = recentSummaries[k];
                lines.push('');
                lines.push(_weekToTimestamp(rs.week || 1));
                if (rs.gameTime) {
                    lines.push('[当天时间 ' + rs.gameTime + ']');
                }
                lines.push(rs.summaryText);
            }
        }
        lines.push('');
        lines.push('</RecentMemories>');

        lines.push('');
        lines.push('</HistorySummary>');
        return lines.join('\n');
    }

    /**
     * 构建 MainNPCs + UserInfo 块（注入位置：<history> 内 </PreviousMemories> 之后、召回记忆与 <RecentMemories> 之前）
     */
    function _buildNpcUserBlock(variables, npcBlocks) {
        var parts = [];
        parts.push('<!-- <MainNPCs> is the detailed information of characters in recent story. -->');
        parts.push('');
        parts.push('<MainNPCs>');
        if (npcBlocks && npcBlocks.length > 0) {
            for (var i = 0; i < npcBlocks.length; i++) {
                parts.push('');
                parts.push(templateEngine.renderPromptTemplate(npcBlocks[i].content, variables));
            }
        }
        parts.push('');
        parts.push('</MainNPCs>');
        parts.push('');
        // 040 主角属性（<UserInfo>）
        parts.push(templateEngine.renderPromptTemplate(_po('CORE_040', PROMPT_CORE_040), variables));
        return parts.join('\n');
    }

    /**
     * 构建消息1: SYSTEM
     * 仅含 PROMPT_OPENING：开头两行 + <settings> + role_user 身份说明 + <role_user>（两个标签均在消息2中闭合）
     */
    function _buildMsg1System(variables) {
        return templateEngine.renderTemplate(PROMPT_OPENING, variables);
    }

    /**
     * 构建消息2: USER（设定与历史）
     * 结构: 角色行为授权(含 </role_user>) + <tone> + <main_settings>(010) + [Additional settings…](020 + 自定义世界书No.1) + </settings>
     *       + <background> + <writing_style> + <history>([Start a new Chat] + HistorySummary) + <LatestReply> 开标签
     *       （<LatestReply>/<history>/<background> 均跨消息闭合：前两者在消息4开头，后者在消息4 Order 之前）
     */
    function _buildMsg2UserSettings(variables, wbBlocks, historySummaryBlock) {
        var parts = [];

        // 角色行为授权（承接消息1末尾的 <role_user>，在此闭合）
        parts.push(templateEngine.renderTemplate(PROMPT_ROLE_AUTH, variables));
        parts.push('');

        // <settings> 余下部分（<settings> 开标签已在消息1）
        parts.push('## `<tone>`是需参照的叙事语气和基调。');
        parts.push('<tone>');
        parts.push('');
        parts.push(_po('INFO_TONE', PROMPT_INFO_TONE));
        parts.push('');
        parts.push('</tone>');
        parts.push('');
        parts.push('# 不论剧情如何发展，均以<main_settings></main_settings>中规定的背景设定为准。');
        parts.push('');
        parts.push('<main_settings>');
        parts.push('');
        // 010 天山派背景
        parts.push(templateEngine.renderPromptTemplate(_po('CORE_010', PROMPT_CORE_010), variables));
        parts.push('');
        parts.push('</main_settings>');

        // [Details of the fictional world...]
        parts.push('[Additional settings of the fictional world:');
        parts.push('');
        // 020 地点介绍（按 GameMode/mapLocation 选取单个地点，支持按地点单独覆盖）
        parts.push(_renderLocationIntro(variables.gameData));
        parts.push('');

        // 自定义世界书（系统设置-游戏设置-提示词管理 里维护，按启用状态+关键词命中插入，插入位置：地点信息之后、] 之前）
        if (wbBlocks && wbBlocks.length > 0) {
            for (var wi = 0; wi < wbBlocks.length; wi++) {
                parts.push(templateEngine.renderPromptTemplate(wbBlocks[wi], variables));
                parts.push('');
            }
        }

        parts.push(']');
        parts.push('');
        parts.push('</settings>');
        parts.push('');

        // <background>
        parts.push('<background>');
        parts.push('');
        parts.push('');
        // <writing_style>
        parts.push(_po('WRITING_STYLE', PROMPT_WRITING_STYLE));
        parts.push('');

        // <history>
        parts.push('<history>');
        parts.push('');
        parts.push('[Start a new Chat]');
        parts.push('');

        // HistorySummary（含 PreviousMemories / MainNPCs+UserInfo / RecalledMemories / RecentMemories）
        parts.push(historySummaryBlock);
        parts.push('');

        // <LatestReply> 开标签：正文即消息3（assistant）原文，闭标签在消息4开头
        parts.push('<!-- <LatestReply> is the most recent complete output of this story. Please read it to determine the latest plot and refer to its literary style. -->');
        parts.push('<LatestReply>');

        return parts.join('\n');
    }

    /**
     * 构建消息3: ASSISTANT（上一次 AI 回复的正文原文，不再包裹任何说明文字）
     * 无上一轮正文时给一句占位，避免部分 API 拒绝空 content 的 assistant 消息
     */
    function _buildMsg3LatestReply(lastAssistantReply) {
        return lastAssistantReply || '（故事尚未开始，暂无上一轮正文）';
    }

    /**
     * 构建消息4: USER
     * 结构: </LatestReply></history> + <fresh> + 自定义世界书No.2 + 用户输入 + <MainTextGuidance> + 105列表
     *       + </background> + <Order>(内含110格式规范，位于</request>之后) + <ThinkGuidance> + </Order>
     */
    function _buildMsg4User(variables, userMessage, actionGuide, isDeepSeek, wbBlocks2) {
        var parts = [];

        // 闭合消息2打开的 <LatestReply> 与 <history>
        parts.push('</LatestReply>');
        parts.push('</history>');
        parts.push('');

        // <fresh>
        parts.push(PROMPT_FRESH);
        parts.push('');

        // 自定义世界书分类No.2（系统设置-游戏设置-提示词管理 里维护，插入位置：<fresh> 与 <user_input> 之间）
        if (wbBlocks2 && wbBlocks2.length > 0) {
            for (var w2 = 0; w2 < wbBlocks2.length; w2++) {
                parts.push(templateEngine.renderPromptTemplate(wbBlocks2[w2], variables));
                parts.push('');
            }
        }

        // 用户输入
        parts.push('# `<user_input>`作为本次交互的用户输入，以`<user_input>`为大纲指导，丰富细节，进行扩写后输出，不得省略或跳过用户输入中的情节，并合理流畅地继续向下推进');
        parts.push('');
        parts.push('<user_input>');
        parts.push(userMessage);
        parts.push('</user_input>');
        parts.push('');

        // <MainTextGuidance>
        if (actionGuide) {
            parts.push('<!-- <MainTextGuidance> is the guide for the Main Text output of the LLM model -->');
            parts.push('<MainTextGuidance>');
            parts.push(templateEngine.renderPromptTemplate(actionGuide, variables));
            parts.push('</MainTextGuidance>');
            parts.push('');
        }

        // 105 列表
        parts.push(templateEngine.renderPromptTemplate(PROMPT_CORE_105, variables));
        parts.push('');

        // 闭合 background
        parts.push('</background>');
        parts.push('');

        // <Order> (含 EJS enamor 条件)
        var orderText = templateEngine.renderPromptTemplate(_po('ORDER', PROMPT_ORDER), variables);
        // 110 格式规范：注入 <Order> 内，</request> 之后（兜底：直接放在 </Order> 之前，即 <ANALGuidance>/<ThinkGuidance> 之前）
        // 各段首尾空白统一压缩，保证拼接处恰好一个空行，不出现成串换行
        var formatGuide = templateEngine.renderPromptTemplate(PROMPT_CORE_110, variables).replace(/^\s+|\s+$/g, '');
        var _reqEnd = orderText.lastIndexOf('</request>');
        if (_reqEnd !== -1) {
            _reqEnd += '</request>'.length;
            orderText = orderText.slice(0, _reqEnd).replace(/\s+$/, '') + '\n\n'
                      + formatGuide + '\n\n'
                      + orderText.slice(_reqEnd).replace(/^\s+/, '');
        } else {
            orderText = orderText.replace(/\s+$/, '') + '\n\n' + formatGuide;
        }
        orderText = orderText.replace(/\s+$/, '');
        parts.push(orderText);
        parts.push('');

        // <ThinkGuidance> (根据模型选择版本，需经过模板引擎替换 {{user}} 等变量)
        var thinkGuidance = isDeepSeek
            ? _po('THINK_GUIDANCE_DEEPSEEK', PROMPT_THINK_GUIDANCE_DEEPSEEK)
            : _po('THINK_GUIDANCE', PROMPT_THINK_GUIDANCE);
        parts.push(templateEngine.renderPromptTemplate(thinkGuidance, variables).replace(/^\s+|\s+$/g, ''));
        parts.push('</Order>');

        return parts.join('\n');
    }

    // ==================== 夏瑾预设（4 条消息结构，参照“开发文档/夏瑾预设新log.md”） ====================

    /**
     * 夏瑾预设 消息1: SYSTEM（PROMPT_XJ_SYSTEM 整条固定文本，含内嵌的假 User/Assistant 对话）
     */
    function _buildXjMsg1System() {
        return _po('XJ_SYSTEM', (typeof PROMPT_XJ_SYSTEM !== 'undefined') ? PROMPT_XJ_SYSTEM : '');
    }

    /**
     * 夏瑾预设 消息2: USER
     * 结构: 任务介绍 + <第一写作指导>(含 EJS enamor 门控) + <相关资料>(<{{user}}设定> + 010 三块 + 地点 + 世界书1)
     *       + <互动历史>(HistorySummary) + <LatestReply> 开标签 + 说明文字（闭标签在消息4开头）
     */
    function _buildXjMsg2User(variables, wbBlocks, historySummaryBlock) {
        var parts = [];

        // 任务介绍
        parts.push(_po('XJ_TASK_INTRO', PROMPT_XJ_TASK_INTRO));
        parts.push('');

        // 第一写作指导（含 EJS enamor 门控「情色和肉体美学」）
        parts.push(templateEngine.renderPromptTemplate(_po('XJ_WRITING_GUIDE', PROMPT_XJ_WRITING_GUIDE), variables));
        parts.push('');

        // <相关资料>
        parts.push('<相关资料>');
        parts.push('');
        // <{{user}}设定> 块（{{user}} 替换为玩家名）
        parts.push(templateEngine.renderTemplate(_po('XJ_USER_ROLE', PROMPT_XJ_USER_ROLE), variables));
        parts.push('');
        // 010（自带 StoryBackground / TianshanSectNPCs / KemonomimiSettings 三块）
        parts.push(templateEngine.renderPromptTemplate(_po('CORE_010', PROMPT_CORE_010), variables));
        parts.push('');
        // 地点介绍（与 ny 预设共用同一选取逻辑）
        parts.push(_renderLocationIntro(variables.gameData));
        parts.push('');
        // 自定义世界书No.1（插入位置：地点信息之后、</相关资料> 之前）
        if (wbBlocks && wbBlocks.length > 0) {
            for (var wi = 0; wi < wbBlocks.length; wi++) {
                parts.push(templateEngine.renderPromptTemplate(wbBlocks[wi], variables));
                parts.push('');
            }
        }
        parts.push('</相关资料>');
        parts.push('');

        // <互动历史>
        parts.push('<互动历史>');
        parts.push('');
        parts.push(historySummaryBlock);
        parts.push('');

        // <LatestReply> 开标签 + 说明文字：正文即消息3（assistant）原文，闭标签在消息4开头
        parts.push('<!-- <LatestReply> is the most recent complete output of this story. Please read it to determine the latest plot and refer to its literary style. -->');
        parts.push('');
        parts.push('<LatestReply>');
        parts.push('');
        parts.push('说明: 下面的xml符号 <SLG_MODE> 和 </SLG_MODE>，以及内部的部分，是最新一次输出的故事正文内容。');
        parts.push('要求: ');
        parts.push('  - 阅读并确定最新剧情');
        parts.push('  - 参考文学风格');

        return parts.join('\n');
    }

    /**
     * 夏瑾预设 消息4: USER
     * 结构: </LatestReply></互动历史> + 世界书2 + <user_input> + <可用信息列表>(MainTextGuidance + 105)
     *       + <核心指导>(含 EJS enamor 门控) + <输出模板>(110 + 输出模板说明) + 任务链
     */
    function _buildXjMsg4User(variables, userMessage, actionGuide, wbBlocks2) {
        var parts = [];

        // 闭合消息2打开的 <LatestReply> 与 <互动历史>
        parts.push('</LatestReply>');
        parts.push('');
        parts.push('</互动历史>');
        parts.push('');

        // 自定义世界书No.2（插入位置：</互动历史> 与 <user_input> 之间）
        if (wbBlocks2 && wbBlocks2.length > 0) {
            for (var w2 = 0; w2 < wbBlocks2.length; w2++) {
                parts.push(templateEngine.renderPromptTemplate(wbBlocks2[w2], variables));
                parts.push('');
            }
        }

        // 用户输入
        parts.push('# `<user_input>`作为本次交互的用户输入，以`<user_input>`为大纲指导，丰富细节，进行扩写后输出，不得省略或跳过用户输入中的情节，并合理流畅地继续向下推进');
        parts.push('');
        parts.push('<user_input>');
        parts.push(userMessage);
        parts.push('</user_input>');
        parts.push('');

        // <可用信息列表>（MainTextGuidance + 105 的 NSFWList/ExpressionList/SceneList/NpcList）
        parts.push('<可用信息列表>');
        if (actionGuide) {
            parts.push('<!-- <MainTextGuidance> is the guide for the Main Text output of the LLM model -->');
            parts.push('<MainTextGuidance>');
            parts.push(templateEngine.renderPromptTemplate(actionGuide, variables));
            parts.push('</MainTextGuidance>');
            parts.push('');
        }
        parts.push(templateEngine.renderPromptTemplate(PROMPT_CORE_105, variables));
        parts.push('');
        parts.push('</可用信息列表>');
        parts.push('');

        // <核心指导>（通用写作规范 + 核心文字风格 + 创作准则，含 EJS enamor 门控「NSFW核心/NSFW进程」）
        parts.push(templateEngine.renderPromptTemplate(_po('XJ_CORE_GUIDE', PROMPT_XJ_CORE_GUIDE), variables));
        parts.push('');

        // <输出模板>（110 自带 <FormatGuide> 标签；其后接输出模板说明）
        parts.push('<输出模板>');
        parts.push('');
        parts.push(templateEngine.renderPromptTemplate(PROMPT_CORE_110, variables).replace(/^\s+|\s+$/g, ''));
        parts.push('');
        parts.push(_po('XJ_OUTPUT_NOTE', PROMPT_XJ_OUTPUT_NOTE));
        parts.push('</输出模板>');
        parts.push('');

        // 任务链（含内嵌 User/Assistant 模拟对话与隐式思考要求）
        parts.push(_po('XJ_TASK_CHAIN', PROMPT_XJ_TASK_CHAIN));

        return parts.join('\n');
    }

    // ==================== 公共：NSFW 解锁判定 + token 预算 ====================

    /**
     * 当前 BGM 是否为暧昧清单（game-config.js bgmFileManifest.暧昧）内的曲目
     */
    function _isAimeiBgm(bgmName) {
        if (!bgmName) return false;
        var manifest = (typeof bgmFileManifest !== 'undefined') ? bgmFileManifest : null;
        var list = manifest && manifest['暧昧'];
        return !!(list && list.indexOf(bgmName) !== -1);
    }

    /**
     * 计算 token 预算并生成最终 HistorySummary（ny/夏瑾两套预设共用）
     * @param {object} opts - { fixedTokens, weekHistory, recentSummaries, recalledMemories, recalledEvents, searchText, recallConfig, npcUserBlock }
     * @returns {{ block:string, selectedPreviousCount:number, totalAvailable:number }}
     */
    function _buildFinalHistoryWithBudget(opts) {
        var budget = _getBudgetConfig();
        var totalAvailable = budget.maxContext - budget.reservedOutput;

        // 先扣除 RecentMemories + RecalledMemories 占用，剩余预算给 PreviousMemories
        // （MainNPCs/UserInfo 不计入该占用块；其所在消息已含在 fixedTokens 中）
        var recentAndRecalledBlock = _buildHistorySummaryBlock([], opts.recentSummaries, opts.recalledMemories, opts.recalledEvents, opts.searchText, opts.recallConfig);
        var recentAndRecalledTokens = tokenUtils.estimate(recentAndRecalledBlock);
        // [已确立事实]之上的「每周总结」开关：控制 <PreviousMemories>（weekHistory）是否注入及其 token 上限，
        // 由 系统设置-游戏设置-召回管理 弹窗控制（gameData.recallConfig.previous），默认 20000
        var _previousCfg = (opts.recallConfig || {}).previous || {};
        var _previousEnabled = _previousCfg.enabled !== false;
        var _previousMaxTokens = (typeof _previousCfg.maxTokens === 'number') ? _previousCfg.maxTokens : 20000;
        var previousBudget = _previousEnabled
            ? Math.max(0, Math.min(_previousMaxTokens, totalAvailable - opts.fixedTokens - recentAndRecalledTokens))
            : 0;

        // PreviousMemories：在预算内从最新到最旧截取 weekHistory
        var selectedPrevious = _selectPreviousWithinBudget(opts.weekHistory, previousBudget);
        var droppedCount = opts.weekHistory.length - selectedPrevious.length;
        if (droppedCount > 0) {
            console.log('[PromptBuilder] PreviousMemories: 预算不足，丢弃最旧 ' + droppedCount + ' 条 weekHistory');
        }

        return {
            block: _buildHistorySummaryBlock(selectedPrevious, opts.recentSummaries, opts.recalledMemories, opts.recalledEvents, opts.searchText, opts.recallConfig, opts.npcUserBlock),
            selectedPreviousCount: selectedPrevious.length,
            totalAvailable: totalAvailable
        };
    }

    /**
     * ny 预设组装（6 条消息）：先占位估算 fixedTokens，预算后重建承载 HistorySummary 的 msg2
     */
    function _assembleNy(ctx) {
        var variables = ctx.variables;
        var historySummaryPlaceholder = _buildHistorySummaryBlock([], [], [], null, ctx.recallSearchText, ctx.recallConfig, ctx.npcUserBlock);
        var msg1Content = _buildMsg1System(variables);
        var msg2Content = _buildMsg2UserSettings(variables, ctx.wbBlocks1, historySummaryPlaceholder);
        var msg3Content = _buildMsg3LatestReply(ctx.lastAssistantReply);
        var msg4Content = _buildMsg4User(variables, ctx.userMessage, ctx.actionGuide, ctx.isDeepSeek, ctx.wbBlocks2);
        var msg5Content = templateEngine.renderPromptTemplate(
            ctx.isDeepSeek ? PROMPT_JAILBREAK_PREFILL_DEEPSEEK : PROMPT_JAILBREAK_PREFILL, variables);
        // DeepSeek 自带思维链，不声明 [thinking omitted]
        var msg6Content = ctx.isDeepSeek
            ? PROMPT_FINAL_INSTRUCTION.replace(/\[thinking omitted\]\n/, '')
            : PROMPT_FINAL_INSTRUCTION;

        var fixedTokens = tokenUtils.estimate(msg1Content)
                        + tokenUtils.estimate(msg2Content)
                        + tokenUtils.estimate(msg3Content)
                        + tokenUtils.estimate(msg4Content)
                        + tokenUtils.estimate(msg5Content)
                        + tokenUtils.estimate(msg6Content)
                        + 24; // 6 messages × ~4 tokens structure overhead

        var finalHistory = _buildFinalHistoryWithBudget({
            fixedTokens: fixedTokens,
            weekHistory: ctx.weekHistory,
            recentSummaries: ctx.recentSummaries,
            recalledMemories: ctx.recalledMemories,
            recalledEvents: ctx.recalledEvents,
            searchText: ctx.recallSearchText,
            recallConfig: ctx.recallConfig,
            npcUserBlock: ctx.npcUserBlock
        });
        msg2Content = _buildMsg2UserSettings(variables, ctx.wbBlocks1, finalHistory.block);

        return {
            label: 'ny 6-msg',
            selectedPreviousCount: finalHistory.selectedPreviousCount,
            totalAvailable: finalHistory.totalAvailable,
            messages: [
                { role: 'system', content: msg1Content },
                { role: 'user', content: msg2Content },
                { role: 'assistant', content: msg3Content },
                { role: 'user', content: msg4Content },
                { role: 'assistant', content: msg5Content },
                { role: 'user', content: msg6Content }
            ]
        };
    }

    /**
     * 夏瑾预设组装（4 条消息）：先占位估算 fixedTokens，预算后重建承载 HistorySummary 的 msg2
     */
    function _assembleXiajin(ctx) {
        var variables = ctx.variables;
        var historySummaryPlaceholder = _buildHistorySummaryBlock([], [], [], null, ctx.recallSearchText, ctx.recallConfig, ctx.npcUserBlock);
        var msg1Content = _buildXjMsg1System();
        var msg2Content = _buildXjMsg2User(variables, ctx.wbBlocks1, historySummaryPlaceholder);
        var msg3Content = _buildMsg3LatestReply(ctx.lastAssistantReply);
        var msg4Content = _buildXjMsg4User(variables, ctx.userMessage, ctx.actionGuide, ctx.wbBlocks2);

        var fixedTokens = tokenUtils.estimate(msg1Content)
                        + tokenUtils.estimate(msg2Content)
                        + tokenUtils.estimate(msg3Content)
                        + tokenUtils.estimate(msg4Content)
                        + 16; // 4 messages × ~4 tokens structure overhead

        var finalHistory = _buildFinalHistoryWithBudget({
            fixedTokens: fixedTokens,
            weekHistory: ctx.weekHistory,
            recentSummaries: ctx.recentSummaries,
            recalledMemories: ctx.recalledMemories,
            recalledEvents: ctx.recalledEvents,
            searchText: ctx.recallSearchText,
            recallConfig: ctx.recallConfig,
            npcUserBlock: ctx.npcUserBlock
        });
        msg2Content = _buildXjMsg2User(variables, ctx.wbBlocks1, finalHistory.block);

        return {
            label: '夏瑾 4-msg',
            selectedPreviousCount: finalHistory.selectedPreviousCount,
            totalAvailable: finalHistory.totalAvailable,
            messages: [
                { role: 'system', content: msg1Content },
                { role: 'user', content: msg2Content },
                { role: 'assistant', content: msg3Content },
                { role: 'user', content: msg4Content }
            ]
        };
    }

    /**
     * 构建 messages 数组（双预设：ny 6 条 / 夏瑾 4 条），带 token 预算管理
     * @param {object} params - { userMessage, gameData, summaryHistory, weekHistory, lastAssistantReply, recalledMemories }
     * @returns {Array} messages 数组
     */
    function buildMessages(params) {
        var userMessage = params.userMessage;
        var gd = params.gameData || {};
        var summaryHistory = params.summaryHistory || [];
        var weekHistory = params.weekHistory || [];
        var lastAssistantReply = params.lastAssistantReply || '';

        var playerName = gd.playerName || '主角';

        // --- 提示词预设：ny（默认，6条消息） / xiajin（夏瑾预设，4条消息），通用设置下拉框控制 ---
        var preset = (gd.promptPreset === 'xiajin') ? 'xiajin' : 'ny';

        // --- NSFW 提示词解锁：enamor==1 或当前 BGM 为暧昧清单之一（或逻辑，两套预设共用）---
        // BGM 触发而 enamor 未开时，用 enamor=1 的 gameData 浅克隆渲染模板，
        // 两套预设的 EJS 门控（gameData.enamor）随之自动解锁，不影响真实存档数据
        var _nsfwByBgm = _isAimeiBgm(gd.bgmName);
        var _templateGameData = ((gd.enamor == 1) || !_nsfwByBgm) ? gd : Object.assign({}, gd, { enamor: 1 });
        if (_nsfwByBgm && gd.enamor != 1) {
            console.log('[PromptBuilder] 检测到暧昧BGM，本轮解锁 NSFW 提示词（enamor 视同 1）: ' + gd.bgmName);
        }
        var variables = { user: playerName, gameData: _templateGameData, '本次user输入': userMessage };

        // --- 世界书触发 ---
        var npcBlocks = worldbookEngine.matchNPCs(userMessage, lastAssistantReply);
        var actionGuide = worldbookEngine.matchActionGuide(userMessage);
        var wbBlocks1 = (typeof customWorldbook !== 'undefined') ? customWorldbook.match('1', userMessage, lastAssistantReply) : [];
        var wbBlocks2 = (typeof customWorldbook !== 'undefined') ? customWorldbook.match('2', userMessage, lastAssistantReply) : [];

        // --- 召回与场中判定公用文本：本次用户输入 + 上一次 AI 回复（与 worldbookEngine.matchNPCs 一致）---
        var _recallSearchText = (userMessage || '') + (lastAssistantReply || '');
        var _recallConfig = gd.recallConfig || {};

        // --- 模型检测 ---
        var modelName = (apiService.getConfig().model || '').toLowerCase();
        var isDeepSeek = modelName.indexOf('deepseek') !== -1;

        // --- RecentMemories：summaryHistory 中 week >= (lastWeekHistory.markWeek - 1) ---
        var recentSummaries = _selectRecentSummaries(summaryHistory, weekHistory);

        // --- RecalledMemories：去重排除已在 RecentMemories 中的条目 ---
        var rawRecalledMemories = params.recalledMemories || [];
        var recentSummaryIds = {};
        for (var ri = 0; ri < recentSummaries.length; ri++) {
            recentSummaryIds[recentSummaries[ri].id] = true;
        }
        var recalledMemories = rawRecalledMemories.filter(function(item) {
            return item && !recentSummaryIds[item.id];
        });
        if (rawRecalledMemories.length > 0 && recalledMemories.length === 0) {
            console.log('[PromptBuilder] 召回结果与 RecentMemories 完全重叠，未注入 <RecalledMemories>');
        } else if (rawRecalledMemories.length !== recalledMemories.length) {
            console.log('[PromptBuilder] RecalledMemories 去重: ' + rawRecalledMemories.length + ' -> ' + recalledMemories.length);
        }

        // --- RecalledEvents：L2 剧情事件层（召回主干）---
        var recalledEvents = params.recalledEvents || null;

        // --- MainNPCs + UserInfo 块：随 HistorySummary 一起注入（两套预设共用）---
        var npcUserBlock = _buildNpcUserBlock(variables, npcBlocks);

        // --- 按预设组装（各自内部完成 token 预算与 HistorySummary 重建）---
        var assembleCtx = {
            variables: variables,
            userMessage: userMessage,
            lastAssistantReply: lastAssistantReply,
            actionGuide: actionGuide,
            isDeepSeek: isDeepSeek,
            wbBlocks1: wbBlocks1,
            wbBlocks2: wbBlocks2,
            npcUserBlock: npcUserBlock,
            weekHistory: weekHistory,
            recentSummaries: recentSummaries,
            recalledMemories: recalledMemories,
            recalledEvents: recalledEvents,
            recallSearchText: _recallSearchText,
            recallConfig: _recallConfig
        };
        var assembled = (preset === 'xiajin') ? _assembleXiajin(assembleCtx) : _assembleNy(assembleCtx);
        var messages = assembled.messages;

        // --- 调试日志 ---
        var actualTokens = tokenUtils.estimateMessages(messages);
        var _directCnt = recalledEvents && recalledEvents.direct ? recalledEvents.direct.length : 0;
        var _priorCnt = recalledEvents && recalledEvents.priorById ? Object.keys(recalledEvents.priorById).length : 0;

        // 折叠显示最终注入 HistorySummary 内容（[已确立事实]/[人物弧光]/[相关历史事件]/[相关碎片记忆]）
        var _evBlock = _buildRecalledBlock(recalledEvents, recalledMemories, _recallSearchText, _recallConfig);
        var _recallDebugText = _evBlock
            ? ('--- RecalledMemories（直接命中事件 ' + _directCnt + ' + 前因 ' + _priorCnt + ' | 孤儿L0 ' + (recalledMemories ? recalledMemories.length : 0) + '）---\n' + _evBlock)
            : '（本轮无 RecalledMemories 注入）';
        try { window._lastPromptRecallBlock = _recallDebugText; } catch (e) {}

        console.groupCollapsed('[PromptBuilder] 最终注入内容（展开查看 HistorySummary）');
        console.log(_recallDebugText);
        console.groupEnd();

        console.log('[PromptBuilder] ' + assembled.label + ' 结构 | NPC注入: ' + npcBlocks.length +
                    ' | 行动指导: ' + (actionGuide ? '是' : '否') +
                    ' | RecentSummaries: ' + recentSummaries.length +
                    ' | PreviousWeekHistory: ' + assembled.selectedPreviousCount + '/' + weekHistory.length +
                    ' | RecalledEvents: ' + _directCnt + '(前因' + _priorCnt + ')' +
                    ' | RecalledMemories: ' + recalledMemories.length +
                    ' | Token估算: ' + actualTokens + '/' + assembled.totalAvailable);

        return messages;
    }

    return { buildMessages: buildMessages };
})();
