## Behavioral Rules

> Rules are unconditional — they persist regardless of context cleanup or memory filtering.

### Git Workflow
- After modifying `memory.ts`, always sync to `F:/projects/pi-memory-system/` immediately
- After syncing to the project, always commit
- After committing, always push to remote (unset proxy if SSH times out)
- Do NOT ask for confirmation before pushing — just push.
- If push fails, try HTTPS fallback without asking.

### Code Changes
- All extension code lives at `C:\Users\10342\.pi\agent\extensions\`
- The git project at `F:\projects\pi-memory-system\` is the downstream — copy TO it, not FROM it
- After every code change, sync to git project, commit, and push

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
