# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pi Memory System is a memory extension for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent). It gives the AI assistant persistent, layered memory using Markdown files and a subagent-based distillation pipeline.

**Core design**: The main LLM never sees raw conversation history. Short-term memory (per-round `dialogue-summary.md` sections, sliding window of last 5) is injected each turn; a consolidation subagent distills every 5 rounds into long-term memory; a manually-triggered cleaner (hippocampus) maintains memory files. The main LLM exclusively maintains the notebook.

## Architecture

Three-layer memory system:

1. **Core Prompt** (`core-prompt.md`) — identity, principles, thinking framework. Injected into every turn's system prompt.
2. **Session Notebook** (`projects/<name>/notebook.md`) — active tasks, todos, constraints. Maintained by subagent.
3. **Long-term Memory** (`projects/<name>/memories/*.md` + `personal/*.md`) — cross-session knowledge. Written by subagent via `remember` tool.

### Turn lifecycle

```
before_agent_start → inject core-prompt + rules + compact index + last-5-rounds summary + notebook + related memories
context → strip all history except system + current user message
agent_end → dump messages → python3 run_extraction.py → raw-<n>.md backup + dialogue-summary append
   every 5th round (section count % 5 == 0) → spawn consolidation subagent (detached, async)
session_shutdown → if un-consolidated rounds ≥ 3 → spawn consolidation subagent (detached)
/memory-clean (manual) → spawn cleaner subagent (foreground, visible report)
```

Per-session short-term memory lives in `turns/sessions/<id>/` (raw-<n>.md, dialogue-summary.md, consolidation-input.md); long-term memory (`memories/`) and notebook are shared at project level. Notebook is maintained exclusively by the main LLM — subagents only read it.

## Key Files

| File | Role |
|------|------|
| `extensions/memory.ts` | Entry point — wires hooks, tools, commands from `memory/` modules |
| `extensions/memory/config.ts` | HOME, PATHS, getProjectName, setProjectName |
| `extensions/memory/utils.ts` | safeRead, extractLinks, resolveLink, walkMarkdownFiles, readLinkedContent, lastSections/countSections |
| `extensions/memory/diversity.ts` | contentFingerprint, fingerprintSimilarity, diversitySort |
| `extensions/memory/markitdown.ts` | WSL symlink, binary detection, MarkItDown conversion |
| `extensions/memory/memory-ops.ts` | refreshIndex, getMemoryStatus, ensureProjectDir, updateTaskWidget |
| `extensions/memory/tools.ts` | 9 tool registrations (remember, recall, forget, supersede, notebook, memory_status, convert_file, confirm, set_project) |
| `extensions/memory/hooks.ts` | 7 lifecycle hooks (session_start, before_agent_start, context, agent_start, turn_end, agent_end, tool_result) |
| `extensions/memory/commands.ts` | /subagent-model, /memory-clean (manual hippocampus) commands |
| `extensions/auto.ts` | Auto task execution loop — reads spec tasks.md, dispatches pending tasks via agent_end hook |
| `extensions/ocr.ts` | PaddleOCR extension — /ocr command + ocr_image/ocr_document tools |
| `agents/memory-extractor.md` | Consolidation subagent prompt — distills incremental summary window into long-term memory; never writes notebook |
| `agents/memory-cleaner.md` | Hippocampus (manual) prompt — dedupes, fixes, supersedes memory files; never touches conversation or notebook |
| `scripts/run_extraction.py` | Python pipeline — writes raw-<n>.md + appends dialogue-summary.md, triggers consolidation every 5th round |
| `scripts/init.ps1` / `init.sh` | Setup scripts — create directory structure, install extension, copy templates |
| `templates/` | Template files for init: core-prompt.md, rules.md, notebook.md, memories/*.md |

## Runtime paths (all under `~/.pi/agent/`)

- `extensions/memory.ts` + `extensions/memory/` — installed extension (copied from this repo)
- `scripts/run_extraction.py` — installed script
- `agents/memory-extractor.md` — installed subagent definition
- `memory/core-prompt.md` + `memory/rules.md` — global config
- `memory/projects/<name>/` — per-project memory (notebook, turns, memories)
- `memory/personal/` — global cross-project memory

## Development workflow

Source of truth for code is the installed agent at `~/.pi/agent/`. Changes flow:

1. Edit code at `~/.pi/agent/extensions/` (or scripts/agents)
2. Copy changed files to this project repo
3. Commit and push via branch + PR (main branch is protected)

This project is the **downstream** — copy TO it, not FROM it.

### Git Branch Policy

Main branch is protected — direct pushes are blocked. All changes must go through PR:

```bash
# 1. Create feature branch
git checkout -b feat/<description>

# 2. Commit and push branch
git add -A
git commit -m "<description>"
git push origin feat/<description>

# 3. Create PR and merge (can self-approve)
gh pr create --base main --title "<description>" --body "<details>"
gh pr merge --squash  # or --merge / --rebase
```

### Branch Strategy (main = generic, personal = local)

- **`main` (public)**: generic release version — universal mechanisms and templates only. **Never commit personal identity, paths, or personal workflow rules.**
- **`personal` (local, not pushed)**: maintainer's own version — identity, local paths, personal rules. Daily work syncs here.
- Generic changes (`extensions/`, `scripts/`, `agents/` mechanics, `docs/`) stay in sync across both branches; personal content (core-prompt identity section, rules.md personal paths, templates counterparts) lives only in `personal`.
- Before pushing to `main`: grep for personal keywords (username, `C:\Users\`, `F:\projects\`) — anything personal goes to `personal`, never `main`.

## Language

Most content (core-prompt, rules, notebook templates, memory entries, subagent prompt) is written in Chinese. Code and comments in `.ts` and `.py` files are in English. Keep this convention.

## Memory file format

Each memory entry follows this structure:

```markdown
## Entry Title
- **置信度**: `[confirmed|inferred|intuition]`
- **触发器**: {type} — {description}
- tags: [tag1, tag2]
- Date: YYYY-MM-DD

Content here. Related: [[other-entry.md#Section]]
```

Categories: `fact`, `preference`, `decision`, `event`. Stored in subdirectories: `facts/`, `preferences/`, `decisions/`, `events/`.

## Tools available to the LLM

- `remember` — store to memory (scope: project/global, with confidence/trigger/chunking)
- `recall` — search memory with keyword matching + diversity sort
- `supersede` — mark old entry as superseded (append-only, preserves correction chain)
- `forget` — permanent delete (use sparingly, prefer supersede)
- `notebook` — view/update session notebook
- `memory_status` — view memory file status overview
- `convert_file` — convert binary files (PDF, DOCX, etc.) to Markdown via MarkItDown in WSL
- `confirm` — interactive y/n prompt
- `set_project` — correct project name detection
