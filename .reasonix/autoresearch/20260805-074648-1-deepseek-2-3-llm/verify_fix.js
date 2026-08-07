// 用 jiti 加载新 utils.ts 实测:链接解析 + 中文关键词 + 自动搜索
const { createJiti } = require('C:/Users/10342/.pi/agent/npm/node_modules/jiti');
const jiti = createJiti(process.cwd() + '/_probe.js');
const u = jiti('F:/projects/pi-memory-system/extensions/memory/utils.ts');

const cwdMyCv = String.raw`C:\Users\10342\Documents\项目\my-cv`; // 不一定存在,用存在的项目
const fs = require('node:fs');
const os = require('node:os');
const HOME = process.env.USERPROFILE;

function findProjectWithLinks() {
  const projects = HOME + '\\.pi\\agent\\memory\\projects';
  for (const name of fs.readdirSync(projects)) {
    const nb = projects + '\\' + name + '\\notebook.md';
    if (!fs.existsSync(nb)) continue;
    const links = u.extractLinks(fs.readFileSync(nb, 'utf-8'));
    if (links.length) return { name, links };
  }
  return null;
}

const proj = findProjectWithLinks();
if (!proj) { console.log('没有项目有 notebook 链接,跳过链接测试'); }
else {
  console.log('=== 1. resolveLink 修复验证 (项目: ' + proj.name + ') ===');
  const cwd = String.raw`C:\Users\10342\.pi\agent\memory\projects\${proj.name}`;
  for (const link of proj.links.slice(0, 3)) {
    const resolved = u.resolveLink(link, cwd);
    console.log(`  ${link.slice(0, 60)}... -> ${resolved ? '✅ ' + resolved : '❌ null'}`);
  }
}

console.log('\n=== 2. extractKeywords 中文拆分 ===');
const kw = u.extractKeywords('帮我优化一下这个项目的缓存命中率问题');
console.log('  ->', kw.join(', '));

console.log('\n=== 3. readLinkedContent 关键词匹配(修复后) ===');
if (proj) {
  const cwd = String.raw`C:\Users\10342\.pi\agent\memory\projects\${proj.name}`;
  const out = u.readLinkedContent([proj.links[0]], cwd, ['帮我优化这个项目的卡片样式']);
  const first = out[0] || '';
  console.log('  ', first.slice(0, 120).replace(/\n/g, ' | '));
}

console.log('\n=== 4. searchMemories 自动检索(pi-memory-system 项目) ===');
const cwd2 = String.raw`C:\Users\10342\.pi\agent\memory\projects\pi-memory-system`;
const res = u.searchMemories('记忆系统缓存优化', cwd2, 3);
console.log('  results:', res.length);
for (const r of res.slice(0, 2)) console.log('  ', r.split('\n')[0]);
