# -*- coding: utf-8 -*-
"""验证 before_agent_start 注入的实际内容与大小分布"""
import os, re, json
from pathlib import Path

HOME = Path.home()
MEM = HOME / '.pi' / 'agent' / 'memory'

def safe_read(p):
    try:
        return Path(p).read_text(encoding='utf-8')
    except Exception:
        return None

print('=== 1. memoryContext 各段大小(pi-memory-system 项目) ===')
cwd = r'F:\projects\pi-memory-system'
proj = os.path.basename(cwd)
core = safe_read(MEM / 'core-prompt.md') or ''
rules = safe_read(MEM / 'rules.md') or ''
notebook = safe_read(MEM / 'projects' / proj / 'notebook.md') or ''
turns = MEM / 'projects' / proj / 'turns'
summary = safe_read(turns / 'turn-summary.md') or ''
essence = safe_read(turns / 'essence.md') or ''
sizes = {'core-prompt(稳定)': len(core), 'rules(稳定)': len(rules),
         'notebook(每轮变)': len(notebook), 'turn-summary(每轮变)': len(summary),
         'essence(每轮变)': len(essence)}
for k, v in sizes.items():
    print(f'  {k}: {v} B')
stable = len(core) + len(rules)
volatile = len(notebook) + len(summary) + len(essence)
print(f'  稳定段 = {stable} B, 易变段 = {volatile} B')

print('\n=== 2. notebook 中的 [[链接]] ===')
for proj_dir in sorted((MEM / 'projects').iterdir()):
    if not proj_dir.is_dir():
        continue
    nb = safe_read(proj_dir / 'notebook.md') or ''
    links = re.findall(r'\[\[([^\]]+)\]\]', nb)
    print(f'  {proj_dir.name}: {len(links)} links -> {links[:5]}')

print('\n=== 3. 模拟 readLinkedContent(链接 + 当前 prompt 关键词) ===')
# 构造典型场景:notebook 有链接, 用户消息是一整句
def simulate(link, prompt, memdir):
    """复制 utils.ts 的逻辑"""
    resolved = None
    for base in (memdir, Path(cwd), MEM / 'personal'):
        p = base / (link if link.endswith('.md') else link + '.md')
        if p.exists():
            resolved = p
            break
    if not resolved:
        return f'- [[{link}]] → ⚠️ Not found'
    content = safe_read(resolved)
    lines = content.split('\n')
    keywords = [prompt]  # 实际代码: event.prompt 整个作为单个 keyword
    matched = []
    in_header = False
    for i, line in enumerate(lines):
        if line.strip() == '---':
            in_header = not in_header
            continue
        if in_header:
            continue
        low = line.lower()
        if keywords and any(k.lower() in low for k in keywords):
            matched.append(line)
    if matched:
        return f'匹配 {len(matched)} 行'
    return '（File exists but no matching sections found for current keywords）'

# 取第一个有链接的项目做样例
sample_proj = None
for proj_dir in sorted((MEM / 'projects').iterdir()):
    nb = safe_read(proj_dir / 'notebook.md') or ''
    links = re.findall(r'\[\[([^\]]+)\]\]', nb)
    if links:
        sample_proj = (proj_dir.name, links)
        break
if sample_proj:
    name, links = sample_proj
    print(f'  样例项目 {name}, 链接 {links[:3]}')
    for prompt in ['请继续', '帮我优化一下这个项目的缓存问题', 'git push 失败怎么办', '继续']:
        out = simulate(links[0], prompt, MEM / 'projects' / name / 'memories')
        print(f'  prompt={prompt!r:40} -> {out}')
else:
    print('  没有任何 notebook 包含 [[链接]] → related memories 永远不会注入')

print('\n=== 4. recall 中文关键词匹配验证 ===')
# 从真实记忆里挑一段, 用不同表述查询
proj = 'jason'
idx = safe_read(MEM / 'projects' / proj / 'memories' / 'decisions' / 'architecture.md')
if idx:
    sample = idx[:800]
    print('  记忆样本(前 300B):', sample[:300].replace('\n', ' | '))
    for q in ['缓存', 'context caching', 'DeepSeek', '供应商', '省钱']:
        hit = q.lower() in sample.lower()
        print(f'  query={q!r:20} 直接子串命中: {hit}')
