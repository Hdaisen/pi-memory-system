const { createJiti } = require('C:/Users/10342/.pi/agent/npm/node_modules/jiti');
const jiti = createJiti(process.cwd() + '/_probe.js');
const u = jiti('F:/projects/pi-memory-system/extensions/memory/utils.ts');
const fs = require('node:fs');

// 1. readLinkedContent:my-cv 的链接 + 相关 prompt
const cwdMyCv = 'C:/Users/10342/.pi/agent/memory/projects/my-cv';
const nb = fs.readFileSync('C:/Users/10342/.pi/agent/memory/projects/my-cv/notebook.md', 'utf-8');
const links = u.extractLinks(nb);
console.log('=== readLinkedContent 修复验证(my-cv, ' + links.length + ' 链接) ===');
const out = u.readLinkedContent(links.slice(0, 3), cwdMyCv, ['优化卡片样式和设计']);
for (const o of out) {
  const head = o.split('\n')[0];
  const hasContent = !o.includes('⚠️ Not found') && !o.includes('no matching sections');
  console.log(`  ${head.slice(0, 70)} -> ${hasContent ? '✅ 匹配到内容' : '❌ 空'}`);
}

// 2. searchMemories:jason 项目(记忆 35KB)按真实主题检索
const cwdJason = 'C:/Users/10342/.pi/agent/memory/projects/jason';
console.log('\n=== searchMemories 自动检索(jason) ===');
for (const q of ['记忆系统注入问题', 'Git 分支工作流', 'token 统计']) {
  const res = u.searchMemories(q, cwdJason, 3);
  console.log(`  query=${q}: ${res.length} 条`);
  for (const r of res.slice(0, 2)) console.log('     -', r.split('\n')[0], `(${r.match(/\((\d+) matches\)/)?.[1] ?? '?'} hits)`);
}

// 3. readMemoryIndex 紧凑化:jason(原 _index 35KB)注入应 ≤2KB
const idx = u.readMemoryIndex(cwdJason, 2000);
console.log(`\n=== readMemoryIndex 紧凑化(jason) ===`);
console.log(`  注入长度: ${idx.length} 字符(原 _index.md: ${fs.statSync('C:/Users/10342/.pi/agent/memory/projects/jason/memories/_index.md').size} B)`);
console.log('  预览:', idx.slice(0, 150).replace(/\n/g, ' | '));
