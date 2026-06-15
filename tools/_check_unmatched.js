// 检查 JSONL 中无法匹配 summary_Backup 的消息的 SUMMARY 内容
const fs = require('fs');

const lines = fs.readFileSync('开发文档/姬侠传 - 2026-04-23@00h19m31s454ms.jsonl','utf8').split('\n').filter(l=>l.trim());
let meta;
try { meta = JSON.parse(lines[0]); } catch(e) { process.exit(1); }
const vars = meta?.chat_metadata?.variables;
const gameData = JSON.parse(vars.gameData);

// 重建 lookup
function cnNum(s) {
  if (!s) return 0;
  const map = {零:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  s = String(s).trim();
  if (/^\d+$/.test(s)) return parseInt(s);
  if (s==='十') return 10;
  if (s.startsWith('十')) return 10+(map[s[1]]||0);
  if (s.includes('十')) { const p=s.split('十'); return (map[p[0]]||0)*10+(map[p[1]]||0); }
  return map[s]||0;
}
function weekLabelToNum(label) {
  const m = label.match(/第([零一二三四五六七八九十百\d]+)年第([零一二三四五六七八九十百\d]+)月第([零一二三四五六七八九十百\d]+)周/);
  if (!m) return null;
  return (cnNum(m[1])-1)*52 + (cnNum(m[2])-1)*4 + cnNum(m[3]);
}
function extractTag(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}

const lookup = {};
const summaryBackup = gameData.summary_Backup || '';
const sections = summaryBackup.split(/\n(?=\[第[^\]]+\])/);
for (const sec of sections) {
  const hm = sec.match(/^\[([^\]]+)\]\n([\s\S]*)/);
  if (!hm) continue;
  const wn = weekLabelToNum(hm[1]);
  if (!wn) continue;
  const text = hm[2].trim();
  if (text) lookup[text.substring(0,30)] = wn;
}
console.log('lookup 条数:', Object.keys(lookup).length);

// 遍历消息，找出 SUMMARY 无法匹配的条目
let unmatched = 0;
for (let i=1; i<lines.length; i++) {
  let msg;
  try { msg = JSON.parse(lines[i]); } catch(e) { continue; }
  if (msg.is_user) continue;
  const mes = (msg.mes||'').replace(/<ANAL_for_JXZ>[\s\S]*?<\/ANAL_for_JXZ>/g,'').trim();
  if (!mes.includes('<SLG_MODE>')) continue;
  const summary = extractTag(mes, 'SUMMARY') || '';
  if (!summary) continue;

  const key30 = summary.substring(0,30);
  let found = !!lookup[key30];
  if (!found) {
    const key15 = summary.substring(0,15);
    for (const k of Object.keys(lookup)) {
      if (k.startsWith(key15) || key15.startsWith(k.substring(0,15))) { found=true; break; }
    }
  }

  if (!found) {
    unmatched++;
    // 尝试从 SUMMARY 文本中直接提取 [第X年第X月第X周] 标签
    const weekInSummary = summary.match(/\[?(第[零一二三四五六七八九十百\d]+年第[零一二三四五六七八九十百\d]+月第[零一二三四五六七八九十百\d]+周)\]?/);
    console.log('--- 行'+i+' 无法匹配 | summary 前50字: '+summary.slice(0,50).replace(/\n/g,' '));
    if (weekInSummary) console.log('   -> summary内含周标: '+weekInSummary[1]+' => week='+weekLabelToNum(weekInSummary[1]));
    else console.log('   -> summary内无周标');
  }
}
console.log('\n共', unmatched, '条无法匹配');
