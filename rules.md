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

### Confirmation
- Use `confirm` tool for interactive y/n prompts (not text questions)
- Only ask Daisen to confirm genuinely risky decisions
- Routine operations (push after commit, sync code) do NOT need confirmation
