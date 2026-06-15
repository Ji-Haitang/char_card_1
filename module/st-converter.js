/**
 * st-converter.js
 * 浏览器端：将 SillyTavern 导出的 .jsonl 文本转换为姬侠传独立前端/APK 存档 payload
 *
 * 暴露 window.convertSTJsonl(text) → { success, payload, saveName, warnings } | { success:false, error }
 */
(function() {
    'use strict';

    // ── 工具函数 ──────────────────────────────────────────

    function nanoid(prefix) {
        return prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function extractTag(text, tag) {
        const m = text.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
        return m ? m[1].trim() : null;
    }

    function parseDate(dateStr) {
        if (!dateStr) return Date.now();
        return new Date(dateStr).getTime();
    }

    // 中文数字 → 阿拉伯数字（支持到99）
    function cnNum(s) {
        if (!s) return 0;
        const map = {零:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
        s = String(s).trim();
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        if (s === '十') return 10;
        if (s.startsWith('十')) return 10 + (map[s[1]] || 0);
        if (s.includes('十')) {
            const parts = s.split('十');
            return (map[parts[0]] || 0) * 10 + (map[parts[1]] || 0);
        }
        return map[s] || 0;
    }

    // "第X年第X月第X周" → 绝对周号
    function weekLabelToNum(label) {
        const m = label.match(/第([零一二三四五六七八九十百\d]+)年第([零一二三四五六七八九十百\d]+)月第([零一二三四五六七八九十百\d]+)周/);
        if (!m) return null;
        const year = cnNum(m[1]), month = cnNum(m[2]), week = cnNum(m[3]);
        return (year - 1) * 52 + (month - 1) * 4 + week;
    }

    const WEEK_MAP = ['一','二','三','四','五','六','七','八','九','十',
        '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
        '二十一','二十二','二十三','二十四','二十五','二十六','二十七','二十八',
        '二十九','三十','三十一','三十二','三十三','三十四','三十五','三十六',
        '三十七','三十八','三十九','四十','四十一','四十二','四十三','四十四',
        '四十五','四十六','四十七','四十八','四十九','五十','五十一','五十二'];

    function weekToLabel(week) {
        const year  = Math.ceil(week / 52);
        const wiy   = ((week - 1) % 52) + 1;
        const month = Math.ceil(wiy / 4);
        const wim   = ((wiy - 1) % 4) + 1;
        return '第' + (WEEK_MAP[year-1] || year) + '年第' + (WEEK_MAP[month-1] || month) + '月第' + (WEEK_MAP[wim-1] || wim) + '周';
    }

    const LOCATION_NAMES = {
        shanmen:'山门', yanwuchang:'演武场', cangjingge:'藏经阁',
        yishiting:'议事厅', danfang:'丹房', tiejiangpu:'铁匠铺',
        houshan:'后山', huofang:'伙房', nvdizi:'女弟子房',
        nandizi:'男弟子房', gongtian:'公田', none:'未知',
    };

    // ── summary_Backup → 查找表 ──────────────────────────

    function buildBackupLookup(summaryBackup) {
        if (!summaryBackup) return {};
        const lookup = {};
        const sections = summaryBackup.split(/\n(?=\[第[^\]]+\])/);
        for (const sec of sections) {
            const hm = sec.match(/^\[([^\]]+)\]\n([\s\S]*)/);
            if (!hm) continue;
            const weekNum = weekLabelToNum(hm[1]);
            if (!weekNum) continue;
            const text = hm[2].trim();
            if (text) lookup[text.substring(0, 30)] = weekNum;
        }
        return lookup;
    }

    function findWeekForSummary(summaryText, lookup) {
        if (!summaryText) return null;
        const key30 = summaryText.substring(0, 30);
        if (lookup[key30] !== undefined) return lookup[key30];
        const key15 = summaryText.substring(0, 15);
        for (const k of Object.keys(lookup)) {
            if (k.startsWith(key15) || key15.startsWith(k.substring(0, 15))) return lookup[k];
        }
        return null;
    }

    // ── summary_Week + summary_Small → weekHistory ───────

    function buildWeekHistory(summaryWeek, summarySmall) {
        const result = [];
        if (!summaryWeek) return result;
        const lines = summaryWeek.split('\n').filter(function(l){ return l.trim(); });
        const byWeek = new Map();
        for (const line of lines) {
            const m = line.match(/^(第[零一二三四五六七八九十百\d]+年第[零一二三四五六七八九十百\d]+月第[零一二三四五六七八九十百\d]+周)[，,、\s]/);
            if (!m) continue;
            const weekNum = weekLabelToNum(m[1]);
            if (!weekNum) continue;
            if (!byWeek.has(weekNum)) byWeek.set(weekNum, []);
            byWeek.get(weekNum).push(line);
        }
        if (summarySmall) {
            const sections = summarySmall.split(/\n(?=\[第[^\]]+\])/);
            for (const sec of sections) {
                const hm = sec.match(/^\[([^\]]+)\]\n([\s\S]*)/);
                if (!hm) continue;
                const weekNum = weekLabelToNum(hm[1]);
                if (!weekNum) continue;
                const text = hm[2].trim();
                if (!text) continue;
                if (!byWeek.has(weekNum)) byWeek.set(weekNum, []);
                const existing = byWeek.get(weekNum).join('');
                if (!existing.includes(text.substring(0, 20))) {
                    byWeek.get(weekNum).push('[' + hm[1] + ']\n' + text);
                }
            }
        }
        const now = Date.now();
        const sorted = Array.from(byWeek.entries()).sort(function(a, b){ return a[0] - b[0]; });
        for (const [weekNum, weekLines] of sorted) {
            result.push({
                id: nanoid('wm'),
                week: weekNum + 1,
                markWeek: weekNum,
                summaryText: weekLines.join('\n'),
                source: 'converted',
                createdAt: now,
            });
        }
        return result;
    }

    // ── 主转换函数 ────────────────────────────────────────

    /**
     * 将 SillyTavern .jsonl 文本转换为姬侠传存档 payload
     * @param {string} text - .jsonl 文件的文本内容
     * @returns {{ success: true, payload: object, saveName: string, warnings: string[] }
     *          | { success: false, error: string }}
     */
    function convertSTJsonl(text) {
        const warnings = [];
        const rawLines = text.split('\n').filter(function(l){ return l.trim(); });

        // 解析元数据行
        let meta;
        try { meta = JSON.parse(rawLines[0]); } catch(e) {
            return { success: false, error: '解析 JSONL 失败，请确认是有效的 SillyTavern 聊天导出文件' };
        }
        const vars = meta && meta.chat_metadata && meta.chat_metadata.variables;
        if (!vars || !vars.gameData) {
            return { success: false, error: '未找到 gameData，该文件可能不是姬侠传的聊天记录' };
        }
        let gameData;
        try { gameData = JSON.parse(vars.gameData); } catch(e) {
            return { success: false, error: 'gameData 解析失败：' + e.message };
        }

        const backupLookup = buildBackupLookup(gameData.summary_Backup);

        const summaryHistory = [];
        const uiConversation = [];
        let lastKnownWeek = 0;

        for (let i = 1; i < rawLines.length; i++) {
            let msg;
            try { msg = JSON.parse(rawLines[i]); } catch(e) { continue; }

            // 剔除分析块
            const mes = (msg.mes || '').replace(/<ANAL_for_JXZ>[\s\S]*?<\/ANAL_for_JXZ>/g, '').trim();
            const ts     = parseDate(msg.send_date);
            const hasApi = !!(msg.extra && msg.extra.api);

            if (msg.is_user) {
                uiConversation.push({ id:'u'+ts, role:'user', content:mes, week:1, createdAt:ts });
                continue;
            }

            if (!mes.includes('<SLG_MODE>')) continue;

            const mainText = extractTag(mes, 'MAIN_TEXT') || '';
            const summary  = extractTag(mes, 'SUMMARY')   || '';
            const sideRaw  = extractTag(mes, 'SIDE_NOTE') || '';
            let sideNote = null;
            try { if (sideRaw) sideNote = JSON.parse(sideRaw); } catch(e) {}

            const gameTime = sideNote && sideNote['时间'] ? sideNote['时间'] : '';
            const source   = hasApi ? 'llm' : 'special_event';
            const uiId     = 'a' + ts;

            // 三级周号推断
            let weekNum = findWeekForSummary(summary, backupLookup);
            if (!weekNum && summary) {
                const inlineMatch = summary.match(/第([零一二三四五六七八九十百\d]+)年第([零一二三四五六七八九十百\d]+)月第([零一二三四五六七八九十百\d]+)周/);
                if (inlineMatch) weekNum = weekLabelToNum(inlineMatch[0]);
            }
            if (!weekNum) weekNum = lastKnownWeek || 1;
            if (weekNum) lastKnownWeek = weekNum;

            if (mainText) {
                uiConversation.push({ id:uiId, role:'assistant', content:mainText, week:weekNum, createdAt:ts });
            }
            if (summary) {
                const entry = { id:nanoid('sm'), week:weekNum, gameTime:gameTime, summaryText:summary, source:source, createdAt:ts };
                if (source === 'llm') entry.UIid = uiId;
                summaryHistory.push(entry);
            }

            // 从 SIDE_NOTE 重建用户操作消息（插入到 assistant 消息之前）
            if (sideNote && mainText) {
                const parts = [];
                if (weekNum) parts.push('时间：' + weekToLabel(weekNum));
                if (sideNote['时间']) parts.push('游戏时间：' + sideNote['时间']);
                if (sideNote['用户'] && sideNote['用户']['位置变动']) parts.push('地点：' + sideNote['用户']['位置变动']);
                const npcNames = sideNote['当前NPC'] ? Object.keys(sideNote['当前NPC']).join('、') : '';
                if (npcNames) parts.push('在场NPC：' + npcNames);
                if (parts.length > 1) {
                    uiConversation.splice(uiConversation.length - 1, 0, {
                        id: 'u' + (ts - 1), role:'user',
                        content: parts.join('<br>'),
                        week: weekNum, createdAt: ts - 1,
                    });
                }
            }
        }

        // 修正 week=1 的 user 消息（跟随下一条 assistant）
        for (let i = 0; i < uiConversation.length; i++) {
            if (uiConversation[i].role === 'user' && uiConversation[i].week === 1) {
                for (let j = i + 1; j < uiConversation.length; j++) {
                    if (uiConversation[j].role === 'assistant' && uiConversation[j].week > 1) {
                        uiConversation[i].week = uiConversation[j].week;
                        break;
                    }
                }
            }
        }

        const weekHistory    = buildWeekHistory(gameData.summary_Week, gameData.summary_Small);
        const markWeekUiIndex = uiConversation.length > 0 ? uiConversation.length - 1 : 0;

        const week    = gameData.currentWeek || 1;
        const locKey  = gameData.userLocation || '';
        const locName = LOCATION_NAMES[locKey] || locKey;
        const saveName = weekToLabel(week) + '_所在地' + locName;

        if (!gameData.playerName || gameData.playerName === '主角' || gameData.playerName === '{{user}}') {
            warnings.push('playerName 为占位符，建议导入后在游戏内修改角色名');
        }

        const payload = {
            saveName:        saveName,
            gameData:        gameData,
            summaryHistory:  summaryHistory,
            weekHistory:     weekHistory,
            markWeekUiIndex: markWeekUiIndex,
            summaryBuff:     null,
            uiConversation:  uiConversation,
        };

        return { success: true, payload: payload, saveName: saveName, warnings: warnings };
    }

    // 暴露到全局
    window.convertSTJsonl = convertSTJsonl;
})();
