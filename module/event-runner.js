/**
 * event-runner.js - L2 剧情事件抽取链路（runEventSum 滑动窗口）
 *
 * 在 embedding 开启时，按 uiConversation 的滑动窗口异步抽取「剧情事件」（L2 层），
 * 与周总结（summary-runner）完全独立、互不影响。设计沿用 summary-runner 的
 * 「异步 + 互斥锁 + 点火」，但不需要 FIFO 队列——每次都是「从 watermark 往后扫」，
 * 多次触发天然可合并。
 *
 * 产出：单个 JSON（events[] + arcUpdates[] + factUpdates[]）。
 *   events  → 逐条写 eventHistory + 逐条向量化写 wevt_<id> + addToCacheL2
 *   arc/fact→ applyMetaUpdates 合并进滚动状态 eventMeta
 *
 * 全链路统一用 uiConversation 总数组下标（整数）：watermark / uiStart / uiEnd。
 *
 * 依赖：storageService, eventHistoryService, embeddingService, memoryRecall, apiService
 *       （均在本文件之前加载）
 */

var eventRunner = (function() {

    var _running = false;
    var _pending = false;            // 运行期间又攒够楼层 → 跑完补跑一次
    var _abortController = null;     // 飞行中 LLM 请求取消句柄
    var _retryDelay = 5000;

    var STEP_DEFAULT = 20;
    var STEP_INCREMENT = 10;         // 卡长场景每轮 +10
    var FEED_CAP_MULT = 2;           // FEED_CAP = 2 × eventStep
    var BACKFILL_DISTANCE = 20;      // 回灌历史事件的距离阈值
    var CAUSE_MAX = 2;               // 单事件 causedBy 上限

    // =========================================================================
    // System Prompt（规格内化，参考 §6.1）
    // =========================================================================

    var EVENT_SYSTEM_PROMPT = [
        '你是游戏“瀚海归义录”的剧情事件记录官。你的任务是把游戏对话原文拆解为结构化「剧情事件」，并维护角色弧光与世界事实，最终只输出一个合法 JSON 对象。',
        '',
        '【一、事件粒度与白描骨架（最重要）】',
        '事件是原文的叙事骨架，不是逐楼实录。一个事件 = 一个有起承转合的完整叙事单元，以“目标/冲突的展开→收束”为边界，可横跨多个楼层。',
        '- 粒度：同一目标或同一冲突的连续过程，合并为一条事件（例：开锻、淬火、开刃、配鞘同属“锻造一把刀”这条线，合并为一条，而非拆成五条）。判定边界看“叙事线是否切换”，不是“动作是否变化”。',
        '- 骨架：description 只记叙事主干「谁·做了什么·结果如何」的起承转合，用朴实白描的客观句，不带情绪渲染。',
        '- 砍除：原文诗词/对话原句、比喻修辞、工艺与招式的分解步骤、细节性的环境与心理描写。',
        '- 字数：60~100 字，按叙事线长短弹性；要的是主干密度而非细节堆砌；不要为凑字数编造原文没有的信息。',
        '- description 不要内嵌楼层标注（如 (#1-3)）：楼层只走 uiStart/uiEnd 字段，正文保持纯叙述。',
        '禁止两个极端：',
        '- 禁止空泛总结腔：“主角与NPC交谈，关系升温。”／“两人发生冲突，气氛剑拔弩张。”／“主角探索某地，有所收获。”',
        '- 禁止逐楼实录堆细节：照抄诗词/对话原文、记录招式工序分解、堆砌比喻与环境描写。',
        '合格写法（跨多楼的叙事线，主干骨架）：',
        '- 合格：“主角在铁匠铺锻造仪刀『沐雪』作纳征之礼，岑师傅掌火把关，历经九叠折叠锻打、淬火、焊柄开刃、刀脊题诗、配硬枫木竖佩鞘数道工序，最终成刀交岑师傅温养。”',
        '- 合格：“呼延显在教场当众考校主角剑法，主角接下前三招后第四招被打落木剑，呼延显令其闭门三日重修基础，未给明确点评。”',
        '',
        '【二、关系趋势量表】（给 factUpdates 的关系类 trend 用）',
        '破裂 ← 厌恶 ← 反感 ← 陌生 → 投缘 → 亲密 → 交融',
        '',
        '【三、角色弧光追踪】',
        'arcUpdates = {name, trajectory, progress, newMoment}；只记本批有推进的角色。',
        '- name：正式人名；trajectory：当前阶段（15 字内）；progress：0.0~1.0；newMoment：本批新增的关键时刻',
        '',
        '【四、SPO 世界事实】',
        '维护一个小型 world state：{s, p, o, isState, trend?, retracted?}，s+p 为键覆盖旧值。',
        '- isState:true = 核心约束（位置/身份/生死/归属/关系），永不自动删；false = 软记忆，可被容量裁剪',
        '- 关系类 p 用“对X的看法”，必带 trend（取量表中的词）',
        '- 删除某事实用 {s, p, retracted:true}',
        '- 谓词复用、不造同义词；只输出 NEW/CHANGED 的事实',
        '- o 值要短、原子化、带标点：一条事实只承载一个要点（建议 ≤20 字），多个要点拆成多条 fact；写成带标点的完整短句，禁止长串无标点的叙事流水或省略号堆叠',
        '',
        '【五、输出 JSON 结构（严格遵守，只输出一个 JSON 对象）】',
        '{',
        '  "mindful_prelude": { "dedup_analysis": "已有X个事件；按叙事线梳理本批：①线A(#a-#b)…②线B(#c-#d)…；据此识别出Y条新事件", "fact_changes": "关系/事实变化概述" },',
        '  "events": [',
        '    {',
        '      "id": "evt-{$nextEventId}",',
        '      "title": "丹房·萧白瑚探病",',
        '      "timeLabel": "第一年二月第三周",',
        '      "description": "叙事主干骨架（60~100字）",',
        '      "uiStart": 1,',
        '      "uiEnd": 3,',
        '      "keywords": ["鹿茸酒","探病","复诊"],',
        '      "npc": ["萧白瑚"],',
        '      "location": "天山派丹房",',
        '      "causedBy": ["evt-87"]',
        '    }',
        '  ],',
        '  "arcUpdates": [ { "name": "萧白瑚", "trajectory": "从戒备转为试探性靠近", "progress": 0.35, "newMoment": "主动来丹房送药并久留" } ],',
        '  "factUpdates": [ { "s": "主角", "p": "对萧白瑚的看法", "o": "心存好奇又愧疚", "isState": true, "trend": "投缘" } ]',
        '}',
        '',
        '【字段规则】',
        '- id：从注入的 {$nextEventId} 起依次 +1；title：短标题「地点·事件」（8~12字）',
        '- uiStart/uiEnd：叙事线首尾楼层的「局部序号」（#1 起），跨多楼时取该线第一楼到最后一楼；不同叙事线的范围允许交叠；单楼事件 uiStart=uiEnd；不要碰真实 id',
        '- keywords：每条事件必带 3~6 个关键词（专名/物件/动作）',
        '- npc/location/causedBy 选填：causedBy 0~2 个，仅在因果明确（直接导致/明确动机/承接后果）时填，指向已记录或本批事件，不确定填 []',
        '- arcUpdates/factUpdates：只列本批有变化项，无变化给 []',
        '',
        '【六、正念前导】先在 mindful_prelude 的 dedup_analysis 里以“叙事线”为单位梳理本批（每条线一句话概括其起承转合、标注首尾楼层），每条叙事线对应产出一条事件；再自检哪些是新事件、哪些事实变了，压低重复与幻觉。',
        '',
        '【数量与取舍】按叙事线聚合：一条完整叙事线（含起承转合）对应一条事件，宁合勿拆，通常每轮 2~4 条；纯过场水（查背包/刷商店/无实质互动的过场、门派内参/武林动态等八卦）可省略，给空 events:[]。',
        '',
        '【最终约束】直接输出单个合法 JSON，勿加解释、勿加 markdown 代码围栏，字符串内避免英文双引号；引用对话原句、专有名称、物件名等需要加引号时，一律使用「」书名号，不得使用英文双引号 ""。'
    ].join('\n');

    // =========================================================================
    // 公开接口
    // =========================================================================

    function isRunning() { return _running; }

    /**
     * 调度：满足触发即点火；运行中则置 _pending，跑完补跑
     */
    function maybeSchedule() {
        if (_running) {
            _pending = true;
            console.log('[EventRunner] maybeSchedule: 已运行中，置 _pending');
            return;
        }
        var _wm = storageService.loadEventWatermark();
        var _st = storageService.loadEventStep();
        var _ul = (storageService.loadUIConversation() || []).length;
        console.log('[EventRunner] maybeSchedule → 点火 (uiConv=' + _ul + ', watermark=' + _wm + ', step=' + _st + ', diff=' + (_ul - _wm) + ')');
        setTimeout(function() { runEventSum(); }, 0);
    }

    /**
     * 触发判定：uiConversation.length − watermark > eventStep
     */
    function _shouldTrigger() {
        var uiConv = storageService.loadUIConversation() || [];
        var watermark = storageService.loadEventWatermark();
        var step = storageService.loadEventStep();
        return (uiConv.length - watermark) > step;
    }

    /**
     * 页面加载/读档/导入/embedding 开启后调用：检查并可能点火补建
     */
    function resumeOnLoad() {
        if (!_shouldTrigger()) return;
        console.log('[EventRunner] resumeOnLoad: 满足触发，准备点火补建');
        if (!_running) maybeSchedule();
    }

    /**
     * 取消飞行中的 runEventSum（重生成时调用），防止旧结果写回已回滚的事件层
     */
    function cancel() {
        if (_abortController) {
            _abortController.abort();
            _abortController = null;
            console.log('[EventRunner] cancel() 已中止飞行中的 LLM 请求');
        }
        _running = false;
        _pending = false;
    }

    // =========================================================================
    // 核心执行
    // =========================================================================

    /**
     * 按 API 配置决定流式/非流式（与正文请求共用 streamMode 开关），不受弹窗最大输出 Token 限制
     */
    function _sendForEvents(messages, signal) {
        var streamMode = (apiService.getConfig && apiService.getConfig().streamMode) || 'stream';
        if (streamMode !== 'stream') {
            return apiService.sendMessages(messages, { signal: signal, maxOutputTokens: null });
        }
        return new Promise(function(resolve, reject) {
            var handle = apiService.sendMessagesStream(messages, {
                onToken: function() {},
                onThinking: function() {},
                onComplete: function(fullText, usage) { resolve({ content: fullText, usage: usage }); },
                onError: function(err) { reject(err); }
            }, { maxOutputTokens: null });
            if (signal) {
                if (signal.aborted) { handle.abort(); }
                else { signal.addEventListener('abort', function() { handle.abort(); }, { once: true }); }
            }
        });
    }

    /**
     * 从 LLM 原始回复中提取单个 JSON 对象（容错：去 code fence、取首尾大括号切片）
     */
    function _parseEventJson(raw) {
        if (!raw) return null;
        var text = String(raw).trim();
        // 去掉 ```json ... ``` 围栏
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
        // 直接尝试
        try { return JSON.parse(text); } catch (e) {}
        // 取首个 { 到末个 } 之间切片
        var first = text.indexOf('{');
        var last = text.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            var slice = text.slice(first, last + 1);
            try { return JSON.parse(slice); } catch (e2) {}
            // 第三层：修复 LLM 在字符串值内用直引号表示中文引用的情况
            // 如：答"知道了" → 答「知道了」
            // 策略：将紧邻 CJK/中文标点的 " 及 Unicode 左右引号替换为书角引号
            var CJK = '\u4e00-\u9fff\uff00-\uffef\u3000-\u303f';
            var PUNC = '，。、：；！？…—～';
            var SURR = '[' + CJK + PUNC + ']';
            // U+201C / U+201D（弯引号）→ 直接替换
            var fixed = slice.replace(/\u201c/g, '\u300c').replace(/\u201d/g, '\u300d');
            // 直引号：左引号（前接 CJK/标点）
            fixed = fixed.replace(new RegExp('(' + SURR + ')"', 'g'), '$1\u300c');
            // 直引号：右引号（后接 CJK/标点）
            fixed = fixed.replace(new RegExp('"(' + SURR + ')', 'g'), '\u300d$1');
            try { return JSON.parse(fixed); } catch (e3) {}
        }
        return null;
    }

    /**
     * 解析 'evt-N' → 数值 N
     */
    function _eventNum(id) {
        if (!id) return 0;
        var m = String(id).match(/(\d+)\s*$/);
        return m ? parseInt(m[1], 10) : 0;
    }

    /**
     * causedBy 校验：保留指向「已存在事件 ∪ 本批事件」的引用，丢弃悬空；本批内环检测 → 断边
     * @param {Array} batch - 本批待入库事件（含 id/causedBy）
     * @param {object} existingIds - 已入库事件 id 集合
     */
    function _validateCausation(batch, existingIds) {
        var batchIds = {};
        for (var i = 0; i < batch.length; i++) batchIds[batch[i].id] = true;

        // ① 先过滤悬空引用
        for (var j = 0; j < batch.length; j++) {
            var ev = batch[j];
            var cb = Array.isArray(ev.causedBy) ? ev.causedBy : [];
            ev.causedBy = cb.filter(function(cid) {
                return cid && cid !== ev.id && (existingIds[cid] === true || batchIds[cid] === true);
            }).slice(0, CAUSE_MAX);
        }

        // ② 本批内环检测（仅看指向本批的边），成环则断开该边
        var byId = {};
        for (var k = 0; k < batch.length; k++) byId[batch[k].id] = batch[k];
        var state = {}; // 0=未访问 1=在栈 2=完成
        function dfs(id) {
            var node = byId[id];
            if (!node) return false;
            state[id] = 1;
            var deps = Array.isArray(node.causedBy) ? node.causedBy.slice() : [];
            for (var d = 0; d < deps.length; d++) {
                var dep = deps[d];
                if (!byId[dep]) continue; // 只查本批内的边
                if (state[dep] === 1) {
                    // 成环：断开 node → dep
                    node.causedBy = node.causedBy.filter(function(x) { return x !== dep; });
                    console.warn('[EventRunner] causedBy 环检测：断开 ' + id + ' → ' + dep);
                } else if (state[dep] !== 2) {
                    if (dfs(dep)) {
                        node.causedBy = node.causedBy.filter(function(x) { return x !== dep; });
                        console.warn('[EventRunner] causedBy 环检测：断开 ' + id + ' → ' + dep);
                    }
                }
            }
            state[id] = 2;
            return false;
        }
        for (var m2 = 0; m2 < batch.length; m2++) {
            if (state[batch[m2].id] !== 2) dfs(batch[m2].id);
        }
    }

    /**
     * 单轮执行：从 watermark 往后扫一窗，抽取事件并入库 + 向量化（§4.3）
     */
    async function runEventSum() {
        if (_running) { _pending = true; return; }
        _running = true;
        _pending = false;
        _abortController = new AbortController();
        var _signal = _abortController.signal;

        try {
            var uiConv = storageService.loadUIConversation() || [];
            var watermark = storageService.loadEventWatermark();
            var step = storageService.loadEventStep();

            // 触发条件复检（可能因回退/出队而不再满足）
            if ((uiConv.length - watermark) <= step) {
                console.log('[EventRunner] 触发条件已不满足，跳过 (len=' + uiConv.length + ', watermark=' + watermark + ', step=' + step + ')');
                _running = false; _abortController = null; return;
            }

            console.log('[EventRunner] ══ 开始 runEventSum: watermark=' + watermark + ', step=' + step + ', uiConv=' + uiConv.length + ', diff=' + (uiConv.length - watermark) + ' ══');
            var FEED_CAP = FEED_CAP_MULT * step;

            // ① 定窗（total index）
            var windowStart = watermark;
            var windowEnd = Math.min(uiConv.length - 1, windowStart + FEED_CAP);

            // ② 打局部序号（仅 assistant），维护 局部序号 → total index 映射
            var localToTotal = [];   // localToTotal[localNum-1] = totalIndex
            var numberedLines = [];
            var lastAsstIdx = -1;
            for (var i = windowStart; i <= windowEnd; i++) {
                var m = uiConv[i];
                if (!m || m.role !== 'assistant') continue;
                localToTotal.push(i);
                lastAsstIdx = i;
                numberedLines.push('#' + localToTotal.length + ' ' + (m.content || ''));
            }

            if (localToTotal.length === 0) {
                // 窗口内无 assistant（极端）→ 推进 watermark 越过该段，避免空转
                storageService.saveEventWatermark(windowEnd);
                console.log('[EventRunner] 窗口内无 assistant 楼层，watermark → ' + windowEnd);
                _running = false; _abortController = null;
                _afterRun();
                return;
            }

            // ③ 回灌历史事件（causedBy 引用 + 去重）
            var backfillMinUiEnd = windowStart - BACKFILL_DISTANCE;
            var recentEvents = eventHistoryService.getRecentEvents(backfillMinUiEnd);

            // ④ nextEventId
            var nextEventId = eventHistoryService.getMaxEventId() + 1;

            // 回灌全局基线（弧光 + 事实）—— 传入本批对话全文，按"在场实体"过滤，防膨胀
            var metaBaseline = eventHistoryService.getMetaBaseline(numberedLines.join('\n'));

            // 组装 user prompt
            var userPrompt = _buildUserPrompt(numberedLines, recentEvents, metaBaseline, nextEventId);
            var sysPrompt = EVENT_SYSTEM_PROMPT.replace(/\{\$nextEventId\}/g, String(nextEventId));

            var messages = [
                { role: 'system', content: sysPrompt },
                { role: 'user', content: userPrompt }
            ];

            console.groupCollapsed('[EventRunner] ══ 发起事件抽取 ══ window=' + windowStart + '..' + windowEnd + ' (assistant×' + localToTotal.length + ', nextId=evt-' + nextEventId + ')');
            console.log('[EventRunner] System Prompt (' + sysPrompt.length + ' chars):\n' + sysPrompt);
            console.log('[EventRunner] User Prompt (' + userPrompt.length + ' chars):\n' + userPrompt);
            console.groupEnd();

            // ⑤ 调 LLM
            var apiResult = await _sendForEvents(messages, _signal);

            // LLM 返回后再次确认未被取消（防止返回前极短时间内点击重生成）
            if (_signal.aborted) {
                console.log('[EventRunner] 已被取消（LLM 返回后检测），放弃写入');
                _running = false; _abortController = null; return;
            }

            var rawContent = apiResult && apiResult.content ? apiResult.content : '';
            console.groupCollapsed('[EventRunner] ══ 收到事件抽取回复 ══');
            console.log('[EventRunner] usage:', apiResult && apiResult.usage);
            console.log('[EventRunner] 原始回复 (' + rawContent.length + ' chars):\n' + rawContent);
            console.groupEnd();

            var parsed = _parseEventJson(rawContent);
            if (!parsed) {
                throw new Error('事件 JSON 解析失败（长度=' + rawContent.length + '）');
            }

            var rawEvents = Array.isArray(parsed.events) ? parsed.events : [];

            // ⑥ 局部序号 → total index 映射（映射失败的事件 uiStart/uiEnd=null，仍可召回但不挂 L0）
            var mapped = [];
            for (var e = 0; e < rawEvents.length; e++) {
                var rev = rawEvents[e];
                if (!rev) continue;
                var locStart = parseInt(rev.uiStart, 10);
                var locEnd = parseInt(rev.uiEnd, 10);
                var totalStart = (!isNaN(locStart) && locStart >= 1 && locStart <= localToTotal.length) ? localToTotal[locStart - 1] : null;
                var totalEnd = (!isNaN(locEnd) && locEnd >= 1 && locEnd <= localToTotal.length) ? localToTotal[locEnd - 1] : null;
                if (totalStart != null && totalEnd != null && totalStart > totalEnd) {
                    var tmp = totalStart; totalStart = totalEnd; totalEnd = tmp;
                }
                // 事件 week：取结尾楼层所在游戏周（用于召回阈值/展示）
                var wkIdx = (totalEnd != null) ? totalEnd : (totalStart != null ? totalStart : windowEnd);
                // ① 直接取 uiConv[wkIdx].week
                var wk = (uiConv[wkIdx] && typeof uiConv[wkIdx].week === 'number' && uiConv[wkIdx].week > 0)
                    ? uiConv[wkIdx].week : 0;
                // ② 老存档缺 week 字段：向前找最近一条 user 消息，解析 content 中的"第Y年第M月第W周"
                if (wk === 0) {
                    for (var _wki = wkIdx; _wki >= windowStart && wk === 0; _wki--) {
                        if (uiConv[_wki] && uiConv[_wki].role === 'user') {
                            wk = _parseWeekFromContent(uiConv[_wki].content);
                        }
                    }
                }
                // ③ 都找不到则留 0（近期过滤会以 uiEnd 位置兜底）

                mapped.push({
                    id: (rev.id && /^evt-/.test(rev.id)) ? rev.id : ('evt-' + (nextEventId + mapped.length)),
                    title: rev.title || '',
                    timeLabel: rev.timeLabel || '',
                    description: rev.description || '',
                    uiStart: totalStart,
                    uiEnd: totalEnd,
                    week: wk,
                    keywords: Array.isArray(rev.keywords) ? rev.keywords : [],
                    npc: Array.isArray(rev.npc) ? rev.npc : [],
                    location: rev.location || '',
                    causedBy: Array.isArray(rev.causedBy) ? rev.causedBy : [],
                    source: 'runEventSum',
                    createdAt: Date.now()
                });
            }

            // ⑦ 分支处理（§4.5）：决定 commit 集合、watermark、step
            var validEvents = mapped.filter(function(x) { return typeof x.uiStart === 'number' && typeof x.uiEnd === 'number'; });
            var invalidEvents = mapped.filter(function(x) { return !(typeof x.uiStart === 'number' && typeof x.uiEnd === 'number'); });

            var committed = [];
            var newWatermark = watermark;
            var newStep = step;
            var branch = '';

            if (mapped.length === 0) {
                // 0 条事件：纯过场水 → 推进到 windowEnd，step 归位
                newWatermark = windowEnd;
                newStep = STEP_DEFAULT;
                branch = '0事件→watermark=windowEnd';
            } else if (validEvents.length === 0) {
                // 全部映射失败：无法判定边界 → 全部入库、推进 windowEnd 避免停滞
                committed = invalidEvents;
                newWatermark = windowEnd;
                newStep = STEP_DEFAULT;
                branch = '全部映射失败→全入库,watermark=windowEnd';
            } else {
                var maxUiEnd = -Infinity;
                for (var v = 0; v < validEvents.length; v++) if (validEvents[v].uiEnd > maxUiEnd) maxUiEnd = validEvents[v].uiEnd;
                // 待缓提集合 D = { uiEnd >= lastAsstIdx } ∪ { uiEnd 最大 }
                var inD = {};
                for (var d2 = 0; d2 < validEvents.length; d2++) {
                    var ve = validEvents[d2];
                    if (ve.uiEnd >= lastAsstIdx || ve.uiEnd === maxUiEnd) inD[ve.id] = true;
                }
                var committedValid = validEvents.filter(function(x) { return !inD[x.id]; });
                committed = committedValid.concat(invalidEvents);

                if (committed.length === 0) {
                    // ≥1 产出但 0 入库（全在 D 里）：卡长场景 → step+=10，watermark 不动
                    newStep = step + STEP_INCREMENT;
                    newWatermark = watermark;
                    branch = '产出全缓提→step+=' + STEP_INCREMENT + ',watermark不动';
                } else {
                    // ≥1 入库：watermark = D 里最小 uiStart，step 归位
                    var minDStart = Infinity;
                    for (var d3 = 0; d3 < validEvents.length; d3++) {
                        if (inD[validEvents[d3].id] && validEvents[d3].uiStart < minDStart) minDStart = validEvents[d3].uiStart;
                    }
                    newWatermark = (minDStart === Infinity) ? windowEnd : minDStart;
                    newStep = STEP_DEFAULT;
                    branch = '正常入库→watermark=D最小uiStart(' + newWatermark + ')';
                }
            }

            // ⑧ 校验 + 入库 + 向量化
            if (committed.length > 0) {
                var existingIds = {};
                var allHistory = eventHistoryService.getAll();
                for (var h = 0; h < allHistory.length; h++) existingIds[allHistory[h].id] = true;
                _validateCausation(committed, existingIds);

                // 写 eventHistory
                eventHistoryService.appendEvents(committed);

                // 逐条向量化 → wevt_<id> + addToCacheL2（仅 embedding 开启时）
                if (typeof embeddingService !== 'undefined' && embeddingService.isEnabled && embeddingService.isEnabled()) {
                    await _vectorizeEvents(committed, _signal);
                }

                // 应用批次级增量（弧光/事实）
                eventHistoryService.applyMetaUpdates({
                    arcUpdates: Array.isArray(parsed.arcUpdates) ? parsed.arcUpdates : [],
                    factUpdates: Array.isArray(parsed.factUpdates) ? parsed.factUpdates : []
                }, windowEnd);
            } else if (mapped.length === 0) {
                // 纯过场：若 LLM 仍吐了弧光/事实变化，也应用（少见但无害）
                eventHistoryService.applyMetaUpdates({
                    arcUpdates: Array.isArray(parsed.arcUpdates) ? parsed.arcUpdates : [],
                    factUpdates: Array.isArray(parsed.factUpdates) ? parsed.factUpdates : []
                }, windowEnd);
            }
            // 注意：branch=「产出全缓提」时不应用 meta（下一轮重读会重新吐出），避免半截场景过早落状态

            // 写回 watermark / step
            storageService.saveEventWatermark(newWatermark);
            storageService.saveEventStep(newStep);

            console.log('[EventRunner] ✓ 完成: ' + branch
                + ' | 产出 ' + mapped.length + ' 入库 ' + committed.length
                + ' | watermark ' + watermark + '→' + newWatermark
                + ' | step ' + step + '→' + newStep);

        } catch (e) {
            _abortController = null;
            if (e.name === 'AbortError' || (_signal && _signal.aborted)) {
                console.log('[EventRunner] 已被主动取消，不重试');
                _running = false;
                return;
            }
            console.warn('[EventRunner] ✗ 抽取失败，' + _retryDelay + 'ms 后重试:', e.message);
            setTimeout(function() {
                _running = false;
                if (_shouldTrigger()) maybeSchedule();
            }, _retryDelay);
            return;
        }

        _running = false;
        _abortController = null;
        _afterRun();
    }

    /**
     * 跑完收尾：若 _pending 或仍满足触发条件，补跑一次
     */
    function _afterRun() {
        if (_pending || _shouldTrigger()) {
            _pending = false;
            maybeSchedule();
        }
    }

    /**
     * 从 user 消息 content 中解析累计周数。
     * 格式：第Y年第M月第W周（与 game-helpers.js calculateSeason 同一套换算）
     * @returns {number} 累计 week，解析失败返回 0
     */
    function _parseWeekFromContent(content) {
        if (!content) return 0;
        var m = String(content).match(/第(\d+)年第(\d+)月第(\d+)周/);
        if (!m) return 0;
        var y = parseInt(m[1], 10);
        var mo = parseInt(m[2], 10);
        var w = parseInt(m[3], 10);
        if (isNaN(y) || isNaN(mo) || isNaN(w)) return 0;
        return (y - 1) * 48 + (mo - 1) * 4 + w;
    }

    /**
     * 逐条向量化事件，写 wevt_<id> + 加入 L2 缓存（单条失败不阻断其余）
     */
    async function _vectorizeEvents(events, signal) {
        var fp = embeddingService.getFingerprint ? embeddingService.getFingerprint() : '';
        var _successCount = 0;
        for (var i = 0; i < events.length; i++) {
            if (signal && signal.aborted) {
                console.log('[EventRunner] 向量化中检测到取消，停止');
                return;
            }
            var ev = events[i];
            var text = eventHistoryService.buildEventEmbedText(ev);
            try {
                var vecs = await embeddingService.embed([text]);
                if (signal && signal.aborted) return;
                var vec = vecs && vecs[0] ? vecs[0] : null;
                if (!vec) { console.warn('[EventRunner] 事件 ' + ev.id + ' 向量为空，跳过'); continue; }
                var meta = { text: text, week: ev.week || 0, fingerprint: fp, createdAt: ev.createdAt || Date.now() };
                storageService.saveL2Embedding(ev.id, vec, meta);
                if (memoryRecall.addToCacheL2) {
                    memoryRecall.addToCacheL2({ id: ev.id, vector: vec, text: text, week: ev.week || 0, fingerprint: fp, createdAt: meta.createdAt });
                }
                _successCount++;
            } catch (err) {
                console.warn('[EventRunner] 事件 ' + ev.id + ' 向量化失败（下一轮 _syncL2 自愈）:', err.message);
            }
        }
        if (events.length > 0) console.log('[EventRunner] 向量化完成 ' + _successCount + '/' + events.length + ' 条');
    }

    /**
     * 组装 user prompt（原文带局部序号 + 回灌事件 + 全局基线 + 注入起始号 + 正念前导，§6.2）
     */
    function _buildUserPrompt(numberedLines, recentEvents, metaBaseline, nextEventId) {
        var parts = [];
        parts.push('【任务】把下列对话原文拆解为结构化剧情事件，并维护角色弧光与世界事实，按系统规范输出单个 JSON。');
        parts.push('');
        parts.push('【对话原文（每条 assistant 楼层前已标局部序号 #n，用于填 uiStart/uiEnd）】');
        parts.push(numberedLines.join('\n\n'));
        parts.push('');

        if (recentEvents && recentEvents.length > 0) {
            parts.push('【已记录事件（勿重复输出，可作 causedBy 引用）】');
            for (var i = 0; i < recentEvents.length; i++) {
                var re = recentEvents[i];
                parts.push(re.id + ' [' + (re.timeLabel || '') + '] ' + (re.description || ''));
            }
            parts.push('');
        }

        if (metaBaseline && metaBaseline.trim()) {
            parts.push('【全局基线（只吐真正新增/变化的弧光与事实，未变化项不要重复）】');
            parts.push(metaBaseline);
            parts.push('');
        }

        parts.push('【起始事件号】本批 events[0].id 从 evt-' + nextEventId + ' 起依次 +1。');
        parts.push('【提醒】先在 mindful_prelude 自检本批边界与新增项，再产出 events/arcUpdates/factUpdates；每条事件必带 3~6 个 keywords；无新增弧光/事实则给 []。直接输出单个合法 JSON。');

        return parts.join('\n');
    }

    return {
        maybeSchedule: maybeSchedule,
        resumeOnLoad: resumeOnLoad,
        isRunning: isRunning,
        cancel: cancel,
        runEventSum: runEventSum
    };
})();
