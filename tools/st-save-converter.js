/**
 * st-save-converter.js
 * 将 SillyTavern 导出的 .jsonl 聊天文件转换为姬侠传独立前端/APK 存档格式
 *
 * 用法：
 *   node st-save-converter.js <输入.jsonl> [输出.json]
 */

const fs   = require('fs');
const path = require('path');

// ── 工具函数 ──────────────────────────────────────────────

function nanoid(prefix) {
    return prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function extractTag(text, tag) {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : null;
}

function parseDate(dateStr) {
    if (!dateStr) return Date.now();
    return new Date(dateStr).getTime();
}

// 中文数字 → 阿拉伯数字（支持到99）
function cnNum(s) {
    if (!s) return 0;
    const map = { 零:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9 };
    s = String(s).trim();
    if (/^\d+$/.test(s)) return parseInt(s);
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
    return `第${WEEK_MAP[year-1]||year}年第${WEEK_MAP[month-1]||month}月第${WEEK_MAP[wim-1]||wim}周`;
}

const LOCATION_NAMES = {
    shanmen:'山门', yanwuchang:'演武场', cangjingge:'藏经阁',
    yishiting:'议事厅', danfang:'丹房', tiejiangpu:'铁匠铺',
    houshan:'后山', huofang:'伙房', nvdizi:'女弟子房',
    nandizi:'男弟子房', gongtian:'公田', none:'未知',
};

// ── 解析 summary_Backup → { 前N字 → weekNum } 查找表 ──────
/**
 * summary_Backup 格式：
 * [第X年第X月第X周]\n摘要文本\n\n[第X年第X月第X周]\n摘要文本...
 */
function buildBackupLookup(summaryBackup) {
    if (!summaryBackup) return {};
    const lookup = {}; // key = 摘要前30字, value = weekNum
    // 按 [第X年第X月第X周] 分割
    const sections = summaryBackup.split(/\n(?=\[第[^\]]+\])/);
    for (const sec of sections) {
        const headerMatch = sec.match(/^\[([^\]]+)\]\n([\s\S]*)/);
        if (!headerMatch) continue;
        const weekNum = weekLabelToNum(headerMatch[1]);
        if (!weekNum) continue;
        const text = headerMatch[2].trim();
        if (!text) continue;
        // 用前30字作为key（足够唯一）
        lookup[text.substring(0, 30)] = weekNum;
    }
    return lookup;
}

/**
 * 在 lookup 中查找与 summaryText 最匹配的 weekNum
 * 策略：取前30字在lookup中精确查找；找不到则取前15字做前缀匹配
 */
function findWeekForSummary(summaryText, lookup) {
    if (!summaryText) return null;
    const key30 = summaryText.substring(0, 30);
    if (lookup[key30] !== undefined) return lookup[key30];
    // 前缀匹配（部分LLM可能措辞略有不同）
    const key15 = summaryText.substring(0, 15);
    for (const [k, v] of Object.entries(lookup)) {
        if (k.startsWith(key15) || key15.startsWith(k.substring(0, 15))) return v;
    }
    return null;
}

// ── 解析 summary_Week → weekHistory ───────────────────────
/**
 * summary_Week 格式：每行 "第X年第X月第X周，摘要内容"
 * 按周号聚合，生成 weekHistory 数组
 */
function buildWeekHistory(summaryWeek, summarySmall) {
    const result = [];
    if (!summaryWeek) return result;

    const lines = summaryWeek.split('\n').filter(l => l.trim());
    const byWeek = new Map(); // weekNum → string[]

    for (const line of lines) {
        const m = line.match(/^(第[零一二三四五六七八九十百\d]+年第[零一二三四五六七八九十百\d]+月第[零一二三四五六七八九十百\d]+周)[，,、\s]/);
        if (!m) continue;
        const weekNum = weekLabelToNum(m[1]);
        if (!weekNum) continue;
        if (!byWeek.has(weekNum)) byWeek.set(weekNum, []);
        byWeek.get(weekNum).push(line);
    }

    // 将 summary_Small 中的内容也合并（按 [第X年第X月第X周] 分块）
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
            // small 摘要合并到该周（只追加如果不重复）
            const existing = byWeek.get(weekNum).join('');
            if (!existing.includes(text.substring(0, 20))) {
                byWeek.get(weekNum).push(`[${hm[1]}]\n${text}`);
            }
        }
    }

    const now = Date.now();
    for (const [weekNum, lines] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
        result.push({
            id: nanoid('wm'),
            week: weekNum + 1,
            markWeek: weekNum,
            summaryText: lines.join('\n'),
            source: 'converted',
            createdAt: now,
        });
    }
    return result;
}

// ── 主逻辑 ────────────────────────────────────────────────

const inputPath = process.argv[2];
if (!inputPath) {
    console.error('用法: node st-save-converter.js <输入.jsonl> [输出.json]');
    process.exit(1);
}

const rawLines = fs.readFileSync(inputPath, 'utf8').split('\n').filter(l => l.trim());

let meta;
try { meta = JSON.parse(rawLines[0]); } catch (e) {
    console.error('解析 JSONL 失败，请确认是有效的 SillyTavern 聊天导出文件');
    process.exit(1);
}
const vars = meta?.chat_metadata?.variables;
if (!vars?.gameData) {
    console.error('未找到 gameData，该文件可能不是姬侠传的聊天记录');
    process.exit(1);
}
let gameData;
try { gameData = JSON.parse(vars.gameData); } catch (e) {
    console.error('gameData 解析失败'); process.exit(1);
}

// 从 gameData 构建摘要查找表
const backupLookup = buildBackupLookup(gameData.summary_Backup);
console.log(`[info] summary_Backup 解析出 ${Object.keys(backupLookup).length} 条摘要->周号映射`);

// ── 遍历聊天消息 ──────────────────────────────────────────
const summaryHistory = [];
const uiConversation = [];
let lastKnownWeek = 0; // carry-forward 周号

for (let i = 1; i < rawLines.length; i++) {
    let msg;
    try { msg = JSON.parse(rawLines[i]); } catch(e) { continue; }

    // 剔除 <ANAL_for_JXZ>...</ANAL_for_JXZ> 分析块，保留其余正文
    const mes    = (msg.mes || '').replace(/<ANAL_for_JXZ>[\s\S]*?<\/ANAL_for_JXZ>/g, '').trim();
    const ts     = parseDate(msg.send_date);
    const hasApi = !!msg.extra?.api;

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

    const gameTime = sideNote?.时间 || '';
    const source   = hasApi ? 'llm' : 'special_event';
    const uiId     = 'a' + ts;

    // 用 backupLookup 确定正确的周号
    let weekNum = findWeekForSummary(summary, backupLookup);

    // 降级①：从 SUMMARY 文本本身提取 "第X年第X月第X周" 标签
    if (!weekNum && summary) {
        const inlineMatch = summary.match(/第([零一二三四五六七八九十百\d]+)年第([零一二三四五六七八九十百\d]+)月第([零一二三四五六七八九十百\d]+)周/);
        if (inlineMatch) weekNum = weekLabelToNum(inlineMatch[0]);
    }

    // 降级②：carry-forward，沿用上一条已知周号
    if (!weekNum) weekNum = lastKnownWeek || 1;
    if (weekNum) lastKnownWeek = weekNum;

    if (mainText) {
        uiConversation.push({
            id: uiId, role:'assistant', content:mainText,
            week: weekNum, createdAt: ts,
        });
    }

    if (summary) {
        const entry = { id:nanoid('sm'), week:weekNum, gameTime, summaryText:summary, source, createdAt:ts };
        if (source === 'llm') entry.UIid = uiId;
        summaryHistory.push(entry);
    }

    // 从 SIDE_NOTE 重建用户操作消息（插到对应 assistant 消息之前）
    if (sideNote && mainText) {
        const parts = [];
        if (weekNum) parts.push('时间：' + weekToLabel(weekNum));
        if (sideNote.时间) parts.push('游戏时间：' + sideNote.时间);
        if (sideNote.用户?.位置变动) parts.push('地点：' + sideNote.用户.位置变动);
        const npcNames = sideNote.当前NPC ? Object.keys(sideNote.当前NPC).join('、') : '';
        if (npcNames) parts.push('在场NPC：' + npcNames);
        if (parts.length > 1) {
            uiConversation.splice(uiConversation.length - 1, 0, {
                id: 'u' + (ts - 1), role: 'user',
                content: parts.join('<br>'),
                week: weekNum, createdAt: ts - 1,
            });
        }
    }
}

// ── 修正 user 消息的 week（跟随前后 assistant 消息）─────────
for (let i = 0; i < uiConversation.length; i++) {
    if (uiConversation[i].role === 'user' && uiConversation[i].week === 1) {
        // 找下一条 assistant 消息的 week
        for (let j = i + 1; j < uiConversation.length; j++) {
            if (uiConversation[j].role === 'assistant' && uiConversation[j].week > 1) {
                uiConversation[i].week = uiConversation[j].week;
                break;
            }
        }
    }
}

// ── weekHistory ───────────────────────────────────────────
const weekHistory = buildWeekHistory(gameData.summary_Week, gameData.summary_Small);

// ── markWeekUiIndex = 最后一条对话的索引 ──────────────────
const markWeekUiIndex = uiConversation.length > 0 ? uiConversation.length - 1 : 0;

// ── 存档名 ────────────────────────────────────────────────
const week    = gameData.currentWeek || 1;
const locKey  = gameData.userLocation || '';
const locName = LOCATION_NAMES[locKey] || locKey;
const saveName = `${weekToLabel(week)}_所在地${locName}`;

if (!gameData.playerName || gameData.playerName === '主角' || gameData.playerName === '{{user}}') {
    console.warn('[提示] playerName 为占位符，建议导入后在游戏内修改角色名');
}

// ── 输出 ──────────────────────────────────────────────────
const save = { saveName, gameData, summaryHistory, weekHistory, markWeekUiIndex, summaryBuff: null, uiConversation };

let outputPath = process.argv[3];
if (!outputPath) outputPath = path.join(path.dirname(inputPath), `jxz_save_${saveName}.json`);

fs.writeFileSync(outputPath, JSON.stringify(save, null, 2), 'utf8');

// 诊断：输出前5条 summaryHistory 的周号
console.log('转换成功！');
console.log('  存档名：'    + saveName);
console.log('  第几周：'    + week);
console.log('  摘要条数：'  + summaryHistory.length);
console.log('  对话条数：'  + uiConversation.length);
console.log('  周历史条数：'+ weekHistory.length);
console.log('  markWeekUiIndex：' + markWeekUiIndex);
console.log('  输出文件：'  + outputPath);
console.log('\n  [诊断] summaryHistory 周号分布（前10条）:');
summaryHistory.slice(0, 10).forEach((s, i) =>
    console.log(`    [${i}] week=${s.week} ${s.summaryText.substring(0, 30)}`)
);


// ── 工具函数 ──────────────────────────────────────────────

function nanoid(prefix) {
    return prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/** 从 <TAG>...</TAG> 中提取内容（跨行） */
function extractTag(text, tag) {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : null;
}

/** 解析 ST 存档的 send_date 为 timestamp（ms） */

