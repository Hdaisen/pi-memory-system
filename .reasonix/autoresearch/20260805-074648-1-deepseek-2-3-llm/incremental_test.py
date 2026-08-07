# 端到端:模拟 5 轮 → 固化点生成 consolidation-input.md(只含最后 5 节)
import json, os, subprocess, sys

TEST_DIR = os.path.expandvars(r"%USERPROFILE%\.pi\agent\memory\projects\pi-incremental-test")
SESSION = os.path.join(TEST_DIR, "turns", "sessions", "test-1")
SCRIPT = r"F:\projects\pi-memory-system\scripts\run_extraction.py"

env = os.environ.copy()
env["PI_SESSION_DIR"] = SESSION

for rnd in range(1, 6):
    msgs = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": f"第{rnd}轮用户消息"},
        {"role": "assistant", "content": f"第{rnd}轮助手回复"},
    ]
    p = subprocess.run(
        ["python3", SCRIPT],
        input=json.dumps(msgs), capture_output=True, text=True, encoding="utf-8",
        env=env,
    )
    last = p.stderr.strip().splitlines()[-1] if p.stderr.strip() else "(no stderr)"
    print(f"round {rnd}: {last}")

print("\n=== dialogue-summary 节数(应 5) ===")
ds = open(os.path.join(SESSION, "dialogue-summary.md"), encoding="utf-8").read()
print("sections:", len(ds.split("\n### 轮次 ")) - 1)

print("=== consolidation-input.md 是否存在(固化点应生成) ===")
inp_path = os.path.join(SESSION, "consolidation-input.md")
print("exists:", os.path.exists(inp_path))
if os.path.exists(inp_path):
    inp = open(inp_path, encoding="utf-8").read()
    sections = [s.split("\n")[0] for s in inp.split("\n### 轮次 ") if s.strip()]
    print("input sections:", sections)
    print("只含 1-5 节:", all(s in ("### 轮次 1 ",) or s.startswith(("### 轮次 1", "### 轮次 2", "### 轮次 3", "### 轮次 4", "### 轮次 5")) for s in sections))
