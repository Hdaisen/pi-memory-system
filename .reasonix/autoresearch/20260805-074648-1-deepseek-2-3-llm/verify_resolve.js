const { createJiti } = require('C:/Users/10342/.pi/agent/npm/node_modules/jiti');
const jiti = createJiti(process.cwd() + '/_probe.js');
const u = jiti('F:/projects/pi-memory-system/extensions/memory/utils.ts');
const cfg = jiti('C:/Users/10342/.pi/agent/extensions/memory/config.ts');

const cwd = 'C:/Users/10342/.pi/agent/memory/projects/my-cv';
console.log('getProjectName:', cfg.getProjectName(cwd));
console.log('memoriesDir:', cfg.PATHS.memoriesDir(cwd));

const links = [
  'memories/decisions/design.md',
  'decisions/design.md',
  'memories/facts/facts.md',
  'facts/infrastructure.md',
];
for (const l of links) {
  const r = u.resolveLink(l, cwd);
  console.log(`  ${l} -> ${r ? 'OK ' + r : 'NULL'}`);
}

// 直接检查候选路径
const fs = require('node:fs');
const p = cfg.PATHS.memoriesDir(cwd) + '/decisions/design.md';
console.log('exists decisions/design.md:', fs.existsSync(p));
