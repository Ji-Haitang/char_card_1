const fs = require('fs');
const lines = fs.readFileSync('开发文档/姬侠传 - 2026-04-23@00h19m31s454ms.jsonl','utf8').split('\n').filter(l=>l.trim());
console.log('总行数:', lines.length);
for(let i = Math.max(1, lines.length-8); i < lines.length; i++) {
  try {
    const m = JSON.parse(lines[i]);
    const mes = m.mes || '';
    const hasSLG = mes.includes('<SLG_MODE>');
    const hasMAIN = mes.includes('<MAIN_TEXT>');
    const hasSUM = mes.includes('<SUMMARY>');
    console.log('--- 行' + i + ' is_user=' + m.is_user + ' SLG=' + hasSLG + ' MAIN=' + hasMAIN + ' SUM=' + hasSUM);
    console.log('  内容前120字:', mes.slice(0,120).replace(/\n/g,' '));
  } catch(e) { console.log('行'+i+': 解析失败'); }
}
