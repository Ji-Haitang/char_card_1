const fs = require('fs');
const j = JSON.parse(fs.readFileSync('开发文档/jxz_save_第一年第六月第一周_所在地山门.json','utf8'));
const c = j.uiConversation;
console.log('总条数:', c.length);
c.slice(-15).forEach((item, i) => {
  const idx = c.length - 15 + i;
  console.log('['+idx+'] role='+item.role+' week='+item.week+' | 前60字: '+item.content.slice(0,60).replace(/\n/g,' '));
});
