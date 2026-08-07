const { createJiti } = require('C:/Users/10342/.pi/agent/npm/node_modules/jiti');
const jiti = createJiti(process.cwd() + '/_probe.js');
const u = jiti('F:/projects/pi-memory-system/extensions/memory/utils.ts');
const cfg = jiti('C:/Users/10342/.pi/agent/extensions/memory/config.ts');
const fs = require('node:fs');

const cwdJason = 'C:/Users/10342/.pi/agent/memory/projects/jason';
console.log('getProjectName:', cfg.getProjectName(cwdJason));
const md = cfg.PATHS.memoriesDir(cwdJason);
console.log('memoriesDir:', md, 'exists:', fs.existsSync(md));
const files = u.walkMarkdownFiles(md);
console.log('walkMarkdownFiles count:', files.length);
console.log('sample:', files.slice(0, 5));

const kw = u.extractKeywords('记忆系统注入问题');
console.log('extractKeywords:', JSON.stringify(kw));

// 手动检查 injection-separation.md 内容是否含关键词
const target = md + '/decisions/injection-separation.md';
if (fs.existsSync(target)) {
  const c = fs.readFileSync(target, 'utf-8');
  console.log('injection-separation.md len:', c.length);
  for (const k of kw) {
    if (c.toLowerCase().includes(k)) console.log('  contains:', k);
  }
}

// 直接调 searchMemories 看返回
const res = u.searchMemories('记忆系统注入问题', cwdJason, 3);
console.log('searchMemories result:', res.length);
