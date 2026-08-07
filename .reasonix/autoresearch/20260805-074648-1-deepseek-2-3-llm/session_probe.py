import json, os, sys

sessions_dir = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\10342\.pi\agent\sessions'

all_files = []
for root, dirs, files in os.walk(sessions_dir):
    for fn in files:
        if fn.endswith('.jsonl'):
            p = os.path.join(root, fn)
            all_files.append((os.path.getmtime(p), p))
all_files.sort(reverse=True)
print('jsonl count:', len(all_files))
if not all_files:
    sys.exit(0)

f = all_files[0][1]
print('session:', os.path.relpath(f, sessions_dir))

lines = [json.loads(l) for l in open(f, encoding='utf-8') if l.strip()]
print('total lines:', len(lines))

systems = []
for l in lines:
    m = l.get('message') or l
    if m.get('role') == 'system':
        c = m.get('content')
        if isinstance(c, list):
            c = ''.join(x.get('text', '') for x in c if isinstance(x, dict))
        systems.append(str(c))

print('system messages:', len(systems))

def common_prefix(a, b):
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n

if len(systems) >= 2:
    for i in range(min(len(systems) - 1, 6)):
        cp = common_prefix(systems[i], systems[i + 1])
        print(f'system[{i}] len={len(systems[i])} vs [{i+1}] len={len(systems[i+1])} common={cp} ({100*cp/max(1,len(systems[i])):.1f}%)')

if systems:
    s0 = systems[0]
    print('\n=== system[0] head 400 ===')
    print(s0[:400])
    for marker in ['# 核心系统提示词', '会话小本本', 'Related Memories', '上轮摘要', '子代理分析', '## 行为规则', 'notebook']:
        idx = s0.find(marker)
        if idx >= 0:
            seg = s0[idx:idx + 250].replace('\n', ' | ')
            print(f'\n--- marker "{marker}" @ {idx} ---')
            print(seg)
