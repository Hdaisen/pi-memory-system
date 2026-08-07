const { createJiti } = require('C:/Users/10342/.pi/agent/npm/node_modules/jiti');
const path = require('node:path');
const fs = require('node:fs');
const HOME = process.env.USERPROFILE;
const AGENT = HOME + '/.pi/agent';
const jiti = createJiti(process.cwd() + '/_probe.js');
const u = jiti(AGENT + '/extensions/memory/utils.ts');
const mo = jiti(AGENT + '/extensions/memory/memory-ops.ts');
const cwd = 'F:/projects/pi-memory-system';
const projDir = AGENT + '/memory/projects/pi-memory-system';
const turnsDir = projDir + '/turns';
function safeRead(p) { try { return fs.readFileSync(p, 'utf-8'); } catch { return null; } }
function extractLinks(t) { const r = []; const re = /\[\[([^\]]+)\]\]/g; let m; while ((m = re.exec(t))) { const ref = m[1].split('#')[0].trim(); if (ref && !r.includes(ref)) r.push(ref); } return r; }
const coreSection = safeRead(AGENT + '/memory/core-prompt.md') || 'MISSING';
const rules = safeRead(AGENT + '/memory/rules.md');
const notebookContent = safeRead(projDir + '/notebook.md');
const notebookSection = notebookContent || '# Session Notebook\n';
const dialogueSummary = safeRead(turnsDir + '/dialogue-summary.md');
const summaryContent = dialogueSummary || safeRead(turnsDir + '/turn-summary.md');
const archiveHint = dialogueSummary ? '\n> 历史对话归档: `turns/summaries/` 下(不注入,可 `read` 查阅)\n' : '';
const summarySection = summaryContent ? '\n\n---\n\n## 最近对话摘要\n\n' + summaryContent.trim() + '\n' + archiveHint : '';
const essenceContent = safeRead(turnsDir + '/essence.md');
const essenceSection = essenceContent ? '\n\n---\n\n## 子代理分析\n\n' + essenceContent.trim() + '\n' : '';
let linkedSection = '';
const links = notebookContent ? extractLinks(notebookContent) : [];
const linkedContent = u.readLinkedContent(links, cwd, ['帮我看看这个项目的记忆系统']);
if (linkedContent.length > 0) linkedSection = '\n\n---\n\n## Related Memories\n' + linkedContent.join('\n\n');
let memoryIndexSection = '', searchResultsSection = '';
const indexContent = u.readMemoryIndex(cwd);
if (indexContent) memoryIndexSection = '\n\n---\n\n## Memory Index\n' + indexContent;
const searchResults = u.searchMemories('记忆系统', cwd, 5);
if (searchResults.length > 0) searchResultsSection = '\n\n---\n\n## Related Memories (Auto-Injected)\n' + searchResults.join('\n\n');
let memoryContext = coreSection + '\n';
if (rules) memoryContext += '\n' + rules + '\n';
memoryContext += '\n---\n\n' + memoryIndexSection + summarySection + essenceSection + notebookSection + linkedSection + searchResultsSection + mo.maintenanceSection() + '\n';
console.log('=== 注入段分析(真实本机文件) ===');
const sections = [
  ['core-prompt', coreSection.length], ['rules', rules ? rules.length : 0],
  ['Memory Index', memoryIndexSection.length], ['最近对话摘要', summarySection.length],
  ['essence', essenceSection.length], ['notebook', notebookSection.length],
  ['Related(链接)', linkedSection.length], ['Related Auto', searchResultsSection.length],
  ['维护日志', mo.maintenanceSection().length],
];
let total = 0;
for (const [n, l] of sections) { console.log('  ' + n.padEnd(18) + String(l).padStart(6) + ' B'); total += l; }
console.log('  合计 ≈ ' + total + ' 字符 ≈ ' + Math.round(total / 3) + ' tokens');
console.log('\n=== 段顺序 ===');
for (const marker of ['# 核心系统提示词', '## Memory Index', '## 最近对话摘要', '## 子代理分析', '# 会话小本本', '## Related Memories', '## 记忆维护日志']) {
  const idx = memoryContext.indexOf(marker);
  console.log('  ' + marker.padEnd(20) + ' @ ' + (idx >= 0 ? idx : 'MISSING'));
}
const iN = memoryContext.indexOf('# 会话小本本'), iS = memoryContext.indexOf('## 最近对话摘要');
console.log('\n摘要(@' + iS + ') 在 notebook(@' + iN + ') 之前: ' + (iS > 0 && iS < iN));