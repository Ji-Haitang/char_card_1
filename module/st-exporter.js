/**
 * st-exporter.js
 * 浏览器端：将姬侠传独立前端/APK 的 IndexedDB 游戏数据导出为 SillyTavern .jsonl 存档
 *
 * 暴露 window.exportToSTJsonl() → 触发 .jsonl 文件下载
 *
 * 设计要点（与 st-converter.js 互逆，保证导出→再导入 round-trip）：
 *  - 元数据行：user_name/character_name/create_date + chat_metadata.variables.gameData
 *    （JSON 字符串）+ lastMessage_jxz + chat_metadata.jxz_extra（事件层/地点层，
 *    酒馆忽略但会原样保留，供回导游戏时直接恢复）
 *  - assistant 消息：mes 重组为 <SLG_MODE><MAIN_TEXT><SUMMARY><SIDE_NOTE(最小)>
 *    最小 SIDE_NOTE 只含 时间/用户.位置变动/当前NPC 三项（好感变化/随机事件明细游戏侧不存，无法还原）
 *  - user 消息：玩家自由输入原文回写；"时间：…"伪 user 消息跳过（酒馆里它们本是隐藏提示）
 *  - source==='llm' → extra.api='custom'（供 st-converter 识别来源）
 */
(function() {
    'use strict';

    // ── 周号 → 周标签（52周/年，与 st-converter.weekToLabel 一致）──
    var WEEK_MAP = ['一','二','三','四','五','六','七','八','九','十',
        '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
        '二十一','二十二','二十三','二十四','二十五','二十六','二十七','二十八',
        '二十九','三十','三十一','三十二','三十三','三十四','三十五','三十六',
        '三十七','三十八','三十九','四十','四十一','四十二','四十三','四十四',
        '四十五','四十六','四十七','四十八','四十九','五十','五十一','五十二'];

    function weekToLabel(week) {
        var year  = Math.ceil(week / 52);
        var wiy   = ((week - 1) % 52) + 1;
        var month = Math.ceil(wiy / 4);
        var wim   = ((wiy - 1) % 4) + 1;
        return '第' + (WEEK_MAP[year-1] || year) + '年第' + (WEEK_MAP[month-1] || month) + '月第' + (WEEK_MAP[wim-1] || wim) + '周';
    }

    // ── 时间戳 → 酒馆 send_date 格式（"June 20, 2026 11:36pm"）──
    var MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    function formatSendDate(ts) {
        var d = (typeof ts === 'number' && isFinite(ts) && ts > 0) ? new Date(ts) : new Date();
        var h = d.getHours();
        var ampm = h >= 12 ? 'pm' : 'am';
        var h12 = h % 12; if (h12 === 0) h12 = 12;
        var min = d.getMinutes();
        var minStr = (min < 10 ? '0' : '') + min;
        return MONTHS_EN[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' ' + h12 + ':' + minStr + ampm;
    }

    // 兜底时间戳：createdAt 可能为 null（st-converter 历史遗留），用导出时刻兜底
    function tsOr(now, ts) {
        return (typeof ts === 'number' && isFinite(ts) && ts > 0) ? ts : now;
    }

    // ── 从"时间：…"伪 user 消息反拼最小 SIDE_NOTE 的 位置变动/当前NPC ──
    // 该消息本就是 st-converter 从原始 SIDE_NOTE 生成的，格式固定，互逆可还原
    function parsePseudoUser(content) {
        var out = { location: null, npcNames: [] };
        if (!content) return out;
        var locM = content.match(/地点：([^<]+)/);
        if (locM) out.location = locM[1].trim();
        var npcM = content.match(/在场NPC：([^<]+)/);
        if (npcM) {
            out.npcNames = npcM[1].trim().split('、').map(function(s){ return s.trim(); }).filter(Boolean);
        }
        return out;
    }

    function escapeCdata(s) { return s == null ? '' : String(s); }

    /**
     * 主导出函数：读取 IndexedDB（经 storageService 缓存），生成 jsonl 并下载
     */
    function exportToSTJsonl() {
        if (typeof storageService === 'undefined') {
            if (typeof showModal === 'function') showModal('存储服务未就绪，请稍后重试');
            return;
        }
        // 同步独立运行时变量回 gameData，并挂当前活跃事件（与 exportSave 一致）
        if (typeof syncGameDataFromVariables === 'function') syncGameDataFromVariables();
        gameData._activeEvent = (typeof currentRandomEvent !== 'undefined' ? currentRandomEvent : null)
            || (typeof currentBattleEvent !== 'undefined' ? currentBattleEvent : null) || null;

        try {
            var now = Date.now();
            var saveName = (typeof buildSaveName === 'function') ? buildSaveName() : ('第' + (gameData.currentWeek||1) + '周');

            var uiConv  = storageService.loadUIConversation() || [];
            var summary = (typeof summaryHistoryService !== 'undefined' && summaryHistoryService.getAll)
                ? summaryHistoryService.getAll() : [];

            // assistant 正文与摘要按"顺序"对齐（不用 id 匹配：转换存档的 id 可能因 createdAt=null 退化为 'aNaN' 而重复）
            // 摘要数可能比 assistant 正文多（被截断/只有思考链没有正文的回合只留摘要，st-converter 导入时不生成正文）。
            // 这类无正文的孤儿摘要直接跳过丢弃（与原始 st-converter 行为一致：当初导入时它就没生成正文和伪 user），
            // 保证回导后 assistant/伪 user 条数与原存档完全一致
            var summaryQueue = summary.slice();

            // ── 元数据行 ──
            var jxzExtra = {
                eventHistory:    storageService.loadEventHistory ? storageService.loadEventHistory() : [],
                eventMeta:       storageService.loadEventMeta ? storageService.loadEventMeta() : { arcs:{}, facts:{} },
                eventWatermark:  storageService.loadEventWatermark ? storageService.loadEventWatermark() : 0,
                eventStep:       storageService.loadEventStep ? storageService.loadEventStep() : 0,
                locationMemory:  storageService.loadLocationMemory ? storageService.loadLocationMemory() : {},
                locationBuff:    storageService.loadLocationBuffQueue ? storageService.loadLocationBuffQueue() : []
            };
            var earliestTs = now;
            for (var ei = 0; ei < uiConv.length; ei++) {
                var c = uiConv[ei];
                if (c && typeof c.createdAt === 'number' && c.createdAt > 0 && c.createdAt < earliestTs) earliestTs = c.createdAt;
            }
            var meta = {
                user_name: gameData.playerName || '主角',
                character_name: '姬侠传',
                create_date: formatSendDate(earliestTs),
                chat_metadata: {
                    variables: {
                        gameData: JSON.stringify(gameData),
                        lastMessage_jxz: gameData.lastUserMessage || ''
                    },
                    jxz_extra: jxzExtra
                }
            };

            var lines = [JSON.stringify(meta)];

            // ── 消息行 ──
            for (var i = 0; i < uiConv.length; i++) {
                var m = uiConv[i];
                if (!m || typeof m.content !== 'string') continue;
                var ts = tsOr(now, m.createdAt);

                if (m.role === 'user') {
                    // 伪 user 行动头跳过；玩家自由输入原文回写
                    if (m.content.indexOf('时间：') === 0) continue;
                    lines.push(JSON.stringify({
                        name: gameData.playerName || '主角',
                        is_user: true,
                        is_system: false,
                        send_date: formatSendDate(ts),
                        mes: m.content,
                        extra: {}
                    }));
                    continue;
                }

                // assistant：反拼最小 SIDE_NOTE（位置变动/当前NPC 取自该 assistant 前最近的"时间头"伪 user 消息）
                var location = null, npcNames = [], pseudoGameTime = null;
                for (var j = i - 1; j >= 0; j--) {
                    var prev = uiConv[j];
                    if (prev && prev.role === 'user') {
                        if (prev.content && prev.content.indexOf('时间：') === 0) {
                            var parsed = parsePseudoUser(prev.content);
                            location = parsed.location;
                            npcNames = parsed.npcNames;
                            var gtM = prev.content.match(/游戏时间：([^<]+)/);
                            if (gtM) pseudoGameTime = gtM[1].trim();
                        }
                        break; // 只看最近一条 user（无论是否伪消息）
                    }
                }

                // 对齐校验：仅当伪 user 游戏时间与队首摘要 gameTime 都存在且不同，才说明队首摘要
                // 是一条无正文的孤儿摘要（截断/思考链回合，当初导入时就没生成正文），丢弃它继续对齐。
                // 双重保险：只有"丢弃后下一条摘要 gameTime 恰好等于伪 user 时间"才确认是孤儿，
                // 避免把 gameTime 为空的正常摘要（如原始 SIDE_NOTE 截断无时间）误判成孤儿连续丢弃
                while (summaryQueue.length > 1 && pseudoGameTime && summaryQueue[0].gameTime
                    && summaryQueue[0].gameTime !== pseudoGameTime
                    && summaryQueue[1].gameTime && summaryQueue[1].gameTime === pseudoGameTime) {
                    summaryQueue.shift(); // 丢弃无正文孤儿摘要
                }

                // 取当前 assistant 对应的摘要。
                // 注意：gameTime 可能与伪 user 时间不一致（如原始 SIDE_NOTE 截断导致 gameTime 缺失，
                // 或后接自由输入打断了正文↔伪 user 的相邻关系）。此时仍以队列顺序为准配对，不二次校验，
                // 否则会误丢正常摘要。该分支摘要已按上述孤儿校验尽力对齐，剩余不一致属源数据本身残缺。
                var sEntry = summaryQueue.length > 0 ? summaryQueue.shift() : null;
                var summaryText = sEntry ? (sEntry.summaryText || '') : '';
                var gameTime    = sEntry ? (sEntry.gameTime || '') : '';
                var source      = sEntry ? (sEntry.source || 'llm') : 'llm';
                var sideNote = { '时间': gameTime };
                if (location) sideNote['用户'] = { '位置变动': location };
                if (npcNames.length > 0) {
                    var npcObj = {};
                    for (var ni = 0; ni < npcNames.length; ni++) npcObj[npcNames[ni]] = {};
                    sideNote['当前NPC'] = npcObj;
                }

                var mes = '<SLG_MODE>\n<MAIN_TEXT>\n' + escapeCdata(m.content) + '\n</MAIN_TEXT>';
                if (summaryText) mes += '\n<SUMMARY>\n' + escapeCdata(summaryText) + '\n</SUMMARY>';
                mes += '\n<SIDE_NOTE>\n' + JSON.stringify(sideNote, null, 2) + '\n</SIDE_NOTE>\n</SLG_MODE>';

                var msg = {
                    name: '姬侠传',
                    is_user: false,
                    is_system: false,
                    send_date: formatSendDate(ts),
                    mes: mes,
                    extra: source === 'llm' ? { api: 'custom' } : {}
                };
                lines.push(JSON.stringify(msg));
            }

            var jsonl = lines.join('\n');
            var filename = 'jxz_st_' + saveName.replace(/[^a-zA-Z0-9一-龥]/g, '_') + '.jsonl';
            var p = storageService.downloadJson(filename, jsonl);
            if (p && typeof p.then === 'function') {
                p.then(function(result) {
                    if (result !== 'modal' && result !== 'abort' && typeof showModal === 'function') showModal('SillyTavern 存档已导出！');
                });
            } else if (typeof showModal === 'function') {
                showModal('SillyTavern 存档已导出！');
            }
        } finally {
            delete gameData._activeEvent;
        }
    }

    window.exportToSTJsonl = exportToSTJsonl;
})();
