## Behavioral Rules

> Rules are unconditional — they persist regardless of context cleanup or memory filtering.

### Git Workflow
- After modifying `memory.ts`, always sync to your project repo immediately
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

### Branch Management
- **main = 通用发布版**：只含通用机制与模板，**永不包含个人身份/路径**（用户名、本地路径、个人工作流规则）
- **personal = 本地个人版**（可选，不推送）：维护自己的身份、路径、专属规则。日常改动同步到 personal
- 通用改动（extensions/、scripts/、agents/ 机制、docs/）两分支保持一致；个人化内容（core-prompt.md 身份段、rules.md 个人路径、templates/ 对应段）只在 personal
- 向 main 提交前自查：grep 个人关键词（用户名、`C:\Users\`、`F:\projects\` 等本地路径）——有则改到 personal，不进 main

### Code Changes
- All extension code lives at `~/.pi/agent/extensions/`
- The git project repo is the downstream — copy TO it, not FROM it
- After every code change, sync to git project, commit, and push via branch + PR
- 代码改动后做**语义/运行时验证**（真实执行/测试），不只 grep/语法检查——grep 到函数名≠函数可用（注释吞函数教训）

### Design Process
- 设计方案/优化建议前，先 `recall` 查历史决策 + 先读相关代码再讨论——避免重复推荐已否掉的方案（重复推荐教训）

### Deletion Care
- 删除插件/包/文件前，先列出用户明确要删的清单并核对，避免误删

### WSL Path Conversion
- When user provides a Windows path (e.g., `C:\projects\...` or `C:\Users\<name>\...`), auto-convert to WSL format (`/mnt/c/projects/...` or `/mnt/c/Users/<name>/...`) when running bash/wsl commands
- Do NOT repeatedly fail trying to access Windows paths directly in WSL
- Conversion rule: `X:\path` → `/mnt/x/path` (lowercase drive letter)
- Exception: when using Windows-native tools (PowerShell, cmd), keep Windows paths as-is

### Communication
- No compliments, no fluff, no "好问题" / "好想法"
- Be concise — let one sentence do the work of three
- If uncertain, state your understanding first, then ask a specific question
- When getting corrected, extract the general lesson and record it as a rule if it's unconditional

### Notebook Maintenance (by main LLM, active)
- notebook.md 是活动白板，不是日志归档；**由你（主 LLM）主动维护**
- 任务状态变化时（开始新任务 / 完成待办 / 新增约束 / 关键决策），立即用 `edit` 更新 notebook.md，不要等轮次结束
- 只记：当前任务、活跃待办、跨轮约束、关键决策
- 不记对话细节（那是 dialogue-summary 的职责）
- 子代理（固化/海马体）**只读不写** notebook——异步并发写会互相覆盖；它是你独家维护的白板

### Confirmation
- Use `confirm` tool for interactive y/n prompts (not text questions)
- Only ask the user to confirm genuinely risky decisions
- Routine operations (push after commit, sync code) do NOT need confirmation
