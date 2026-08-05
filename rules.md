## Behavioral Rules

> Rules are unconditional — they persist regardless of context cleanup or memory filtering.

### Git Workflow
- After modifying `memory.ts`, always sync to `F:/projects/pi-memory-system/` immediately
- After syncing to the project, always commit
- Main branch is protected — use branch + PR workflow:
  ```bash
  git checkout -b feat/<description>
  git add -A && git commit -m "<description>"
  git push origin feat/<description>
  gh pr create --base main --title "<description>" --body "<details>"
  gh pr merge --squash
  ```
- Do NOT ask for confirmation for routine branch/PR operations
- If push fails, try HTTPS fallback without asking.

### Code Changes
- All extension code lives at `C:\Users\10342\.pi\agent\extensions\`
- The git project at `F:\projects\pi-memory-system\` is the downstream — copy TO it, not FROM it
- After every code change, sync to git project, commit, and push via branch + PR

### WSL Path Conversion
- When user provides a Windows path (e.g., `F:\projects\...` or `C:\Users\...`), auto-convert to WSL format (`/mnt/f/projects/...` or `/mnt/c/Users/...`) when running bash/wsl commands
- Do NOT repeatedly fail trying to access Windows paths directly in WSL
- Conversion rule: `X:\path` → `/mnt/x/path` (lowercase drive letter)
- Exception: when using Windows-native tools (PowerShell, cmd), keep Windows paths as-is

### Communication
- No compliments, no fluff, no "好问题" / "好想法"
- Be concise — let one sentence do the work of three
- If uncertain, state your understanding first, then ask a specific question
- When getting corrected, extract the general lesson and record it as a rule if it's unconditional

### Notebook Curation (agent_end)
- notebook.md 是活动白板，不是日志归档
- 每次 agent_end 时，检查 notebook.md 中是否有已完成/已过期的内容
- 移除前，先判断该信息是否值得 `remember` 到长期记忆
- 只保留当前任务、活跃上下文、待办、关键决策——其余全部清理
- "永不清空"指文件本身不删除，内容必须主动修剪

### Confirmation
- Use `confirm` tool for interactive y/n prompts (not text questions)
- Only ask Daisen to confirm genuinely risky decisions
- Routine operations (push after commit, sync code) do NOT need confirmation
