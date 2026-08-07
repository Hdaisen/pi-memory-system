const { createJiti } = require('C:/Users/10342/.pi/agent/npm/node_modules/jiti');
const jiti = createJiti(process.cwd() + '/_probe.js');
const u = jiti('F:/projects/pi-memory-system/extensions/memory/utils.ts');
const cfg = jiti('C:/Users/10342/.pi/agent/extensions/memory/config.ts');
const fs = require('node:fs');

const cwdJason = 'C:/Users/10342/.pi/agent/memory/projects/jason';
const kw = u.extractKeywords('记忆系统注入问题');
const target = cfg.PATHS.memoriesDir(cwdJason) + '/decisions/injection-separation.md';
const content = fs.readFileSync(target, 'utf-8');
const lines = content.split('\n');

console.log('=== 逐行模拟 searchMemories 的评分 ===');
let currentSection = '', score = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith('## ')) {
    console.log(`L${i}: [SECTION] "${line}" (上一节 score=${score})`);
    currentSection = line; score = 0; continue;
  }
  const lower = line.toLowerCase();
  let hits = 0;
  for (const k of kw) if (lower.includes(k)) hits++;
  if (hits) console.log(`L${i}: +${hits} "${line.slice(0, 40)}"`);
  score += hits;
}
console.log('final score:', score, 'section:', currentSection);

// 用 eval 直接调用 searchMemories 并加日志
console.log('\n=== 直接调用 ===');
const r = u.searchMemories('记忆系统注入问题', cwdJason, 3);
console.log('results:', r.length);
