/**
 * summary-runner.js - 周总结异步优化模块（仅 index 独立前端链路）
 *
 * 在每次新周（newWeek=1）提交后，异步调用独立 LLM 请求，
 * 基于本周完整 uiConversation 原始正文，生成高质量周总结，
 * 替换 weekHistory 中的初版（runTurn）总结。
 *
 * 依赖：storageService, weekHistoryService, apiService（在本文件之前加载）
 */

var summaryRunner = (function() {

    var _running = false;
    var _retryDelay = 5000;
    var _abortController = null; // 当前飞行中的 LLM 请求取消句柄

    // =========================================================================
    // System Prompt
    // =========================================================================

    var SUMMARY_SYSTEM_PROMPT = '你是游戏"瀚海归义录"的故事记录者。你的任务是将一周内的游戏对话原文，拆解为若干条具体可检索的事件记录。\n\n【输出格式，严格遵守】\n<SUMMARY>\n[第x年第x月第x周]\n事件描述（50字以内）\n\n[第x年第x月第x周]\n事件描述（50字以内）\n</SUMMARY>\n\n【时间标注】\n从对话原文中提取该事件的游戏内时间（如"第一年二月第三周"）。若当前事件原文未明确提及，沿用本段最近出现的时间标记。\n\n【事件描述写法】\n用朴实白描的叙述句，记录原文中实际发生的事，不要抽象总结腔。\n- 必须保留：正式人名/称呼、地点、关键物件/道具、具体动作\n- 写清楚：谁在什么地方、对谁、做了什么、结果如何\n- 有则尽量保留：情绪/态度、约定/承诺、关系变化、可供玩家日后提起的线索\n- 不要为了凑足字数而编造原文没有的信息\n\n禁止空泛写法：\n- 禁止："主角与NPC交谈，关系升温。"\n- 禁止："两人发生冲突，气氛剑拔弩张。"\n- 禁止："主角探索了某地区，有所收获。"\n\n合格写法：\n- 合格："主角携鹿茸酒前往萧白瑚的药庐，以探病为由登门，萧白瑚接受药酒但态度疏离，临走前主角以\'欠一次问诊\'为借口约定下周再来，萧白瑚未明确拒绝。"\n- 合格："呼延显在教场当众考校主角剑法，主角用破阵七式接下前三招，第四招被打落木剑，呼延显令其闭门三日重修基础，未给明确点评。"\n\n【数量规则】\n- 依叙事价值决定，通常每轮不超过3条，无重要内容可省略\n- 场景切换、人物变化时拆分条目\n- 可省略：纯机械操作（查看背包、刷新商店）、无实质互动的过场、门派内参/武林动态/陇右新闻等八卦新闻内容';

    // =========================================================================
    // 公开接口
    // =========================================================================

    function isRunning() { return _running; }

    /**
     * 调度：检查是否有待处理的 buff，若有则异步触发 runSummary
     */
    function scheduleSummary() {
        var buff = storageService.getSummaryBuff();
        if (!buff || !buff.text || !buff.targetMarkWeek) return;
        if (_running) {
            console.log('[SummaryRunner] scheduleSummary: 上次尚未完成，跳过本次调度');
            return;
        }
        console.log('[SummaryRunner] scheduleSummary: 发现待处理 buff, targetMarkWeek=' + buff.targetMarkWeek);
        setTimeout(function() { runSummary(buff); }, 0);
    }

    /**
     * 页面加载时恢复：若有未完成的 buff 则自动触发
     * （在 storageService.init() 之后调用）
     */
    function resumeOnLoad() {
        var buff = storageService.getSummaryBuff();
        if (!buff || !buff.text || !buff.targetMarkWeek) return;
        console.log('[SummaryRunner] resumeOnLoad: 发现未完成 buff, targetMarkWeek=' + buff.targetMarkWeek + ', 将自动重试');
        if (!_running) scheduleSummary();
    }

    // =========================================================================
    // 核心执行
    // =========================================================================

    async function runSummary(buff) {
        _running = true;
        _abortController = new AbortController();
        var _signal = _abortController.signal;
        console.log('[SummaryRunner] ▶ runSummary 开始, targetMarkWeek=' + buff.targetMarkWeek + ', turnCount=' + (buff.turnCount || '?') + ', chars=' + (buff.text ? buff.text.length : 0));

        try {
            // 前置检查：是否已有 runSummary 最终版本
            if (typeof weekHistoryService !== 'undefined' &&
                weekHistoryService.hasRunSummaryEntry &&
                weekHistoryService.hasRunSummaryEntry(buff.targetMarkWeek)) {
                storageService.clearSummaryBuff();
                console.log('[SummaryRunner] 已存在 runSummary 条目, markWeek=' + buff.targetMarkWeek + ', 清空 buff 并退出');
                _running = false;
                _abortController = null;
                return;
            }

            // 字符上限截取（取末尾，最近内容更重要）
            var apiCfg = apiService.getConfig();
            var charLimit = Math.floor((apiCfg.maxContextTokens || 500000) * 1.5 * 0.6);
            var text = buff.text;
            if (text.length > charLimit) {
                console.log('[SummaryRunner] buff 超出字符上限 (' + text.length + ' > ' + charLimit + '), 截取末尾');
                text = text.slice(text.length - charLimit);
            }

            // 构建 user prompt
            var userPrompt = '以下是本周（共' + (buff.turnCount || '若干') + '轮）的游戏对话原文：\n\n'
                + text
                + '\n\n请将上述内容拆解为若干条事件记录，严格按格式输出，确保以</SUMMARY>结束。';

            var messages = [
                { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
                { role: 'user',   content: userPrompt }
            ];

            // ── 完整打印 prompt ──
            console.groupCollapsed('[SummaryRunner] ══ 发起周总结请求 ══ markWeek=' + buff.targetMarkWeek);
            console.log('[SummaryRunner] System Prompt:\n' + SUMMARY_SYSTEM_PROMPT);
            console.log('[SummaryRunner] User Prompt (' + userPrompt.length + ' chars):\n' + userPrompt);
            console.groupEnd();

            // 调用 API（传入中断信号，点击重生成时可即时取消）
            var apiResult = await apiService.sendMessages(messages, { signal: _signal });

            // LLM 返回后再次确认未被取消（防止在返回前极短时间内点击重生成）
            if (_signal.aborted) {
                console.log('[SummaryRunner] runSummary 已被取消（LLM 返回后检测），放弃写入 markWeek=' + buff.targetMarkWeek);
                _running = false;
                _abortController = null;
                return;
            }

            var result = apiResult && apiResult.content ? apiResult.content : '';

            // ── 完整打印回复 ──
            console.groupCollapsed('[SummaryRunner] ══ 收到周总结回复 ══ markWeek=' + buff.targetMarkWeek);
            console.log('[SummaryRunner] usage:', apiResult && apiResult.usage);
            console.log('[SummaryRunner] 原始回复 (' + result.length + ' chars):\n' + result);
            console.groupEnd();

            // 截断检测：</SUMMARY> 缺失则视为失败，走 catch 重试
            if (!result || !result.includes('</SUMMARY>')) {
                throw new Error('SUMMARY 输出被截断，缺少 </SUMMARY>（实际长度=' + (result ? result.length : 0) + '）');
            }

            // 提取 <SUMMARY>...</SUMMARY> 内层正文
            var summaryMatch = result.match(/<SUMMARY>([\s\S]*?)<\/SUMMARY>/);
            var summaryText = summaryMatch ? summaryMatch[1].trim() : '';
            if (!summaryText) {
                throw new Error('SUMMARY 内容为空，提取失败');
            }

            console.log('[SummaryRunner] ══ 提取结果 ══\n' + summaryText);

            // 替换 weekHistory 中的初版总结
            weekHistoryService.replaceByMarkWeek(buff.targetMarkWeek, summaryText, 'runSummary');

            // 校验 targetMarkWeek 匹配后再清空 buff（防止重生成期间错误清空新 buff）
            var currentBuff = storageService.getSummaryBuff();
            if (currentBuff && currentBuff.targetMarkWeek === buff.targetMarkWeek) {
                storageService.clearSummaryBuff();
                console.log('[SummaryRunner] ✓ 周总结替换成功，已清空 buff, markWeek=' + buff.targetMarkWeek);
            } else {
                console.log('[SummaryRunner] buff 已被更新为新 markWeek，跳过 clear（旧=' + buff.targetMarkWeek + ', 新=' + (currentBuff ? currentBuff.targetMarkWeek : 'null') + '）');
            }

        } catch (e) {
            _abortController = null;
            // 若是被主动取消（点击重生成），不重试，直接退出
            if (e.name === 'AbortError' || (_signal && _signal.aborted)) {
                console.log('[SummaryRunner] runSummary 已被主动取消，不重试 markWeek=' + buff.targetMarkWeek);
                _running = false;
                return;
            }
            console.warn('[SummaryRunner] ✗ 总结失败，' + _retryDelay + 'ms 后重试:', e.message);
            setTimeout(function() {
                _running = false;
                scheduleSummary();
            }, _retryDelay);
            return;
        }

        _running = false;
        _abortController = null;
        // 检查在本次运行期间是否有新 buff 写入（如连续多周）
        scheduleSummary();
    }

    /**
     * 取消正在进行的 runSummary 请求（重生成时调用）
     * 中止飞行中的 LLM 请求，防止旧结果写入已还原的 weekHistory
     */
    function cancel() {
        if (_abortController) {
            _abortController.abort();
            _abortController = null;
            console.log('[SummaryRunner] cancel() 已中止飞行中的 LLM 请求，_running → false');
        } else {
            console.log('[SummaryRunner] cancel() 调用时无飞行中的请求（_abortController=null），仅重置 _running');
        }
        _running = false;
    }

    return {
        scheduleSummary: scheduleSummary,
        resumeOnLoad: resumeOnLoad,
        isRunning: isRunning,
        cancel: cancel
    };
})();
