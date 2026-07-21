/**
 * location-runner.js - 地点更新异步模块（仅 index 独立前端链路）
 *
 * 每次角色离开某"下山地点"、返回天山派时，把这次访问期间的剧情摘要喂给一次独立的 LLM 请求，
 * 在保持地点核心设定基本不变的前提下，输出结构化 JSON，整体替换该地点的 危险度/友善度/行动建议/子场景。
 *
 * 架构完全照抄 summary-runner.js / event-runner.js 的异步 Runner 范式：
 * _running 互斥锁 + _abortController + scheduleXxx()/resumeOnLoad()/cancel() 三件套。
 *
 * 与 summaryBuff 的关键差异（讨论后确认）：
 * - locationBuff 不去重、不合并，同一地点连续两次访问会产生两条独立记录，严格按入队顺序 FIFO 串行处理
 * - prevText（当前地点信息）不随 buff 固化，而是在真正处理这条记录时才实时读取 locationMemory，
 *   这样后一次访问处理时天然读到前一次访问已经写完的最新结果
 * - 失败时不做队列轮转（暂定），原地按同款延迟节奏重试
 *
 * 依赖：storageService, prompt-builder.js（getPromptLocationDefault/renderLocationText）, apiService（在本文件之前加载）
 */

var locationRunner = (function() {

    var _running = false;
    var _retryDelay = 5000;
    var _abortController = null; // 当前飞行中的 LLM 请求取消句柄

    // =========================================================================
    // System Prompt
    // =========================================================================

    var LOCATION_SYSTEM_PROMPT = [
        '你是游戏"瀚海归义录"的地点记录官。你会拿到【当前地点信息】（含结构化的危险度/友善度/行动建议 + 各子场景描述）和【本次访问期间发生的剧情摘要】，任务是输出一个更新后的完整地点信息 JSON。',
        '',
        '【一、输出格式（最重要，严格遵守）】',
        '只输出一个合法 JSON 对象，不要 markdown 代码围栏，不要任何解释文字。结构必须是：',
        '{',
        '  "危险度": { "评级": "低|较低|中|较高|高", "说明": "string" },',
        '  "友善度": { "评级": "低|较低|中|较高|高", "说明": "string" },',
        '  "行动建议": ["string", "..."],',
        '  "子场景": {',
        '    "子场景名": { "介绍": "string", "备注": "string", "任意其它标题": ["string", "..."] },',
        '    "...": { "..." }',
        '  }',
        '}',
        '"危险度"/"友善度"的"评级"必须严格是"低/较低/中/较高/高"这五档之一，不得自造新档位。',
        '字符串值内部禁止出现英文双引号 ""，会破坏 JSON 结构；需要引用称呼、地名、物件名等场合一律使用「」书名号代替，不得使用 ""。',
        '',
        '【二、格式规则：结构化字段与结构层级】',
        '除非剧情明确导致某个子场景被彻底摧毁、不复存在，否则不要删除已有的子场景条目，也不要改变其内部字段名称（"介绍""备注"等标题原样保留）；已有子场景的描述可以在原基础上追加/微调，但不要整段替换或改变行文风格。"行动建议"和整个"子场景"字典都是整体替换——你需要把没有变化的条目也原样输出一遍，而不是只输出变化的部分。',
        '',
        '【三、核心原则：只写地点本身的状态变化，不写主角的行为】',
        '本次访问的剧情摘要只是判断依据，最终写出来的每一句话都必须是"这个地方现在是什么样子"，不能是"发生了什么事"。凡是带有主谓宾、能看出"谁对谁做了什么"的句子都不合格。',
        '- 判断标准：句子里不能出现"{{user}}""主角""大侠"等称呼，也不能出现"来到/前来/帮助/打了/击退/离开"这类描述访客行为的动词。',
        '- 合格写法：主角在村里打了一口井 → 在"子场景"里新增"新井"条目（或在最相关的现有子场景里追加一句），客观描述井的位置、水质、村民如何取用，不提「是谁挖的」。',
        '- 合格写法：主角帮当地剿灭了马匪 → 在相关子场景"备注"里补一句"近来匪患已平息，商队渐多"，不写「马匪被剿灭」这件事的经过。',
        '- 禁止写法："{{user}}来到迪坎儿村，帮村民打了一口井，村民感激不尽"（这是叙事，不是设定更新）。',
        '- 禁止写法：任何带有时间顺序、因果连接词描述"发生了什么事"的句子——只保留事情沉淀下来的最终状态。',
        '',
        '【四、篇幅与改动幅度】',
        '- 更新后总篇幅应与原文大致相当（浮动控制在 ±20% 以内），不要大幅扩写或大幅删减',
        '- 允许追加新的子场景条目，允许修改/更新现有设定（包括"危险度""友善度"的评级和说明文字），但改动要克制、循序渐进，符合"逐步演变"而非"一次性推翻重写"',
        '- 剧情不足以支撑一个全新子场景时，优先在最相关的现有子场景里追加一两句，不要为了体现变化硬造新条目'
    ].join('\n');

    var _VALID_LEVELS = ['低', '较低', '中', '较高', '高'];

    // =========================================================================
    // 公开接口
    // =========================================================================

    function isRunning() { return _running; }

    /**
     * 调度：检查是否有待处理的访问记录，若有则异步触发 runLocationUpdate
     */
    function scheduleLocationUpdate() {
        // 系统设置-游戏设置-总结管理：关闭「地点更新」开关时，直接跳过（触发时机不变，仅多了个开关控制）
        if (typeof gameData !== 'undefined' && gameData && gameData.summaryConfig
            && gameData.summaryConfig.location && gameData.summaryConfig.location.enabled === false) {
            console.log('[LocationRunner] scheduleLocationUpdate: 「地点更新」开关已关闭，跳过');
            return;
        }
        var buff = storageService.peekLocationBuff();
        if (!buff || !buff.location || !buff.targetVisitId) return;
        if (_running) {
            console.log('[LocationRunner] scheduleLocationUpdate: 上次尚未完成，跳过本次调度');
            return;
        }
        console.log('[LocationRunner] scheduleLocationUpdate: 发现待处理访问, location=' + buff.location + ', targetVisitId=' + buff.targetVisitId + ', 队列长度=' + storageService.loadLocationBuffQueue().length);
        setTimeout(function() { runLocationUpdate(buff); }, 0);
    }

    /**
     * 页面加载时恢复：若有未完成的访问记录则自动触发
     * （在 storageService.init() 之后调用；调用方需按 !launchIntent 守卫 + loadSave 分支恢复完数据后补触发，见文档 §6）
     */
    function resumeOnLoad() {
        var buff = storageService.peekLocationBuff();
        if (!buff || !buff.location || !buff.targetVisitId) return;
        console.log('[LocationRunner] resumeOnLoad: 发现未完成访问, location=' + buff.location + ', targetVisitId=' + buff.targetVisitId + ', 将自动重试');
        if (!_running) scheduleLocationUpdate();
    }

    /**
     * 取消正在进行的 runLocationUpdate 请求（重生成/切换存档时调用）
     * 中止飞行中的 LLM 请求，防止旧结果写入已回滚/已切换的 locationMemory
     */
    function cancel() {
        if (_abortController) {
            _abortController.abort();
            _abortController = null;
            console.log('[LocationRunner] cancel() 已中止飞行中的 LLM 请求，_running → false');
        } else {
            console.log('[LocationRunner] cancel() 调用时无飞行中的请求（_abortController=null），仅重置 _running');
        }
        _running = false;
    }

    // =========================================================================
    // 解析 / 校验
    // =========================================================================

    /**
     * 从 LLM 原始回复中提取单个 JSON 对象（容错：去 code fence、取首尾大括号切片、修复中文引号）
     * 仿 event-runner.js 的 _parseEventJson
     */
    function parseLocationJson(raw) {
        if (!raw) return null;
        var text = String(raw).trim();
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
        try { return JSON.parse(text); } catch (e) {}
        var first = text.indexOf('{');
        var last = text.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            var slice = text.slice(first, last + 1);
            try { return JSON.parse(slice); } catch (e2) {}
            var CJK = '\u4e00-\u9fff\uff00-\uffef\u3000-\u303f';
            var PUNC = '，。、：；！？…—～';
            var SURR = '[' + CJK + PUNC + ']';
            var fixed = slice.replace(/\u201c/g, '\u300c').replace(/\u201d/g, '\u300d');
            fixed = fixed.replace(new RegExp('(' + SURR + ')"', 'g'), '$1\u300c');
            fixed = fixed.replace(new RegExp('"(' + SURR + ')', 'g'), '\u300d$1');
            try { return JSON.parse(fixed); } catch (e3) {}
        }
        return null;
    }

    /**
     * 防御性校验：危险度/友善度评级必须在五档枚举里，不在就整条弃用（返回 null，由调用方保留旧值）；
     * 行动建议必须是字符串数组；子场景必须是对象且每个 value 也是对象。
     * 只有整体解析失败（parsed为null）或核心字段完全缺失才视为整体失败；个别字段形状不对做字段级兜底。
     * @returns {object|null} 校验/清洗后的对象，字段缺失时置 null（调用方保留旧值）
     */
    function _validateLocationJson(parsed) {
        if (!parsed || typeof parsed !== 'object') return null;

        var result = { 危险度: null, 友善度: null, 行动建议: null, 子场景: null };

        if (parsed['危险度'] && typeof parsed['危险度'] === 'object'
            && _VALID_LEVELS.indexOf(parsed['危险度']['评级']) !== -1) {
            result['危险度'] = { 评级: parsed['危险度']['评级'], 说明: String(parsed['危险度']['说明'] || '') };
        }
        if (parsed['友善度'] && typeof parsed['友善度'] === 'object'
            && _VALID_LEVELS.indexOf(parsed['友善度']['评级']) !== -1) {
            result['友善度'] = { 评级: parsed['友善度']['评级'], 说明: String(parsed['友善度']['说明'] || '') };
        }
        if (Array.isArray(parsed['行动建议'])) {
            result['行动建议'] = parsed['行动建议'].filter(function(x) { return typeof x === 'string'; });
        }
        if (parsed['子场景'] && typeof parsed['子场景'] === 'object' && !Array.isArray(parsed['子场景'])) {
            var scenes = {};
            Object.keys(parsed['子场景']).forEach(function(name) {
                var entry = parsed['子场景'][name];
                if (entry && typeof entry === 'object' && !Array.isArray(entry)) scenes[name] = entry;
            });
            if (Object.keys(scenes).length > 0) result['子场景'] = scenes;
        }

        // 至少要有一个字段校验通过，否则视为整体解析失败（很可能是彻底跑偏的回复）
        if (!result['危险度'] && !result['友善度'] && !result['行动建议'] && !result['子场景']) return null;
        return result;
    }

    // =========================================================================
    // 核心执行
    // =========================================================================

    /**
     * 按 API 配置决定流式 / 非流式（与正文请求共用 streamMode 开关），不受弹窗最大输出 Token 限制
     */
    function _sendForLocation(messages, signal) {
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

    async function runLocationUpdate(buff) {
        _running = true;
        _abortController = new AbortController();
        var _signal = _abortController.signal;
        var location = buff.location; // 目的地：来自 buff，不是 gameData.locationVisit（见文档 §5.3）
        console.log('[LocationRunner] ▶ runLocationUpdate 开始, location=' + location + ', targetVisitId=' + buff.targetVisitId + ', turnCount=' + (buff.turnCount || '?') + ', chars=' + (buff.text ? buff.text.length : 0));

        try {
            // prevText 实时读取（讨论后确认）：不合并同地点的多次访问，严格按入队顺序串行处理，
            // 这样后一次访问处理时，locationMemory 里必然已经是前一次访问处理完的最新结果
            var memoryBefore = storageService.loadLocationMemory();
            var prevData = memoryBefore[location];
            var prevText = prevData
                ? ((typeof renderLocationText === 'function') ? renderLocationText(location, prevData) : '')
                : ((typeof getPromptLocationDefault === 'function') ? getPromptLocationDefault(location) : '');

            var userPrompt = '【当前地点信息】\n' + prevText +
                '\n\n【本次访问期间发生的剧情摘要】\n' + (buff.text || '') +
                '\n\n请严格按 system prompt 的规则，重写一份更新后的完整地点信息 JSON。';

            var messages = [
                { role: 'system', content: LOCATION_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt }
            ];

            console.groupCollapsed('[LocationRunner] ══ 发起地点更新请求 ══ location=' + location);
            console.log('[LocationRunner] System Prompt:\n' + LOCATION_SYSTEM_PROMPT);
            console.log('[LocationRunner] User Prompt (' + userPrompt.length + ' chars):\n' + userPrompt);
            console.groupEnd();

            var apiResult = await _sendForLocation(messages, _signal);

            if (_signal.aborted) {
                console.log('[LocationRunner] runLocationUpdate 已被取消（LLM 返回后检测），放弃写入 location=' + location);
                _running = false;
                _abortController = null;
                return;
            }

            var rawContent = apiResult && apiResult.content ? apiResult.content : '';
            console.groupCollapsed('[LocationRunner] ══ 收到地点更新回复 ══ location=' + location);
            console.log('[LocationRunner] usage:', apiResult && apiResult.usage);
            console.log('[LocationRunner] 原始回复 (' + rawContent.length + ' chars):\n' + rawContent);
            console.groupEnd();

            var parsed = parseLocationJson(rawContent);
            var validated = _validateLocationJson(parsed);
            if (!validated) {
                throw new Error('地点更新 JSON 解析/校验失败（长度=' + rawContent.length + '）');
            }

            // 重新取一次，防止请求耗时期间被其它流程动过（如快照回滚/重生成）
            var memory = storageService.loadLocationMemory();
            var oldEntry = memory[location];
            var oldVersion = (oldEntry && oldEntry.version) || 0;
            memory[location] = {
                危险度: validated['危险度'] || (oldEntry && oldEntry['危险度']) || null,
                友善度: validated['友善度'] || (oldEntry && oldEntry['友善度']) || null,
                行动建议: validated['行动建议'] || (oldEntry && oldEntry['行动建议']) || [],
                子场景: validated['子场景'] || (oldEntry && oldEntry['子场景']) || {},
                version: oldVersion + 1,
                lastUpdatedWeek: (typeof currentWeek !== 'undefined') ? currentWeek : 0,
                lastUpdatedAt: Date.now()
            };
            storageService.saveLocationMemory(memory);
            storageService.dequeueLocationBuff(buff.targetVisitId);
            console.log('[LocationRunner] ✓ 地点更新成功，已出队, location=' + location + ', version=' + memory[location].version);

        } catch (e) {
            _abortController = null;
            if (e.name === 'AbortError' || (_signal && _signal.aborted)) {
                console.log('[LocationRunner] runLocationUpdate 已被主动取消，不重试 location=' + location);
                _running = false;
                return;
            }
            console.warn('[LocationRunner] ✗ 地点更新失败，' + _retryDelay + 'ms 后重试:', e.message);
            // 暂不做队列轮转（讨论后确认）：原地重试，不把失败的这一条挪到队尾
            setTimeout(function() {
                _running = false;
                scheduleLocationUpdate();
            }, _retryDelay);
            return;
        }

        _running = false;
        _abortController = null;
        // 检查在本次运行期间是否有新访问记录写入（如连续多次下山访问）
        scheduleLocationUpdate();
    }

    return {
        scheduleLocationUpdate: scheduleLocationUpdate,
        resumeOnLoad: resumeOnLoad,
        isRunning: isRunning,
        cancel: cancel,
        parseLocationJson: parseLocationJson
    };
})();
