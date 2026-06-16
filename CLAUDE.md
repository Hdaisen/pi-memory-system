# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pi Memory System is a memory extension for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent). It gives the AI assistant persistent, layered memory using Markdown files and a subagent-based distillation pipeline.

**Core design**: The main LLM never sees raw conversation history. A dedicated subagent (memory-extractor) processes each turn's conversation into curated essence + long-term memory after every turn.

## Architecture

Three-layer memory system:

1. **Core Prompt** (`core-prompt.md`) — identity, principles, thinking framework. Injected into every turn's system prompt.
2. **Session Notebook** (`projects/<name>/notebook.md`) — active tasks, todos, constraints. Maintained by subagent.
3. **Long-term Memory** (`projects/<name>/memories/*.md` + `personal/*.md`) — cross-session knowledge. Written by subagent via `remember` tool.

### Turn lifecycle

```
before_agent_start → inject core-prompt + rules + notebook + essence + linked memories
context → strip all history except system + current user message
agent_end → dump messages → python3 run_extraction.py → spawn subagent
```

The subagent reads `turns/raw.md`, writes `turns/essence.md` (next turn handoff), updates `notebook.md`, and calls `remember()` for long-term storage.

## Key Files

| File | Role |
|------|------|
| `extensions/memory.ts` | Entry point — wires hooks, tools, commands from `memory/` modules |
| `extensions/memory/config.ts` | HOME, PATHS, getProjectName, setProjectName |
| `extensions/memory/utils.ts` | safeRead, extractLinks, resolveLink, walkMarkdownFiles, readLinkedContent |
| `extensions/memory/diversity.ts` | contentFingerprint, fingerprintSimilarity, diversitySort |
| `extensions/memory/markitdown.ts` | WSL symlink, binary detection, MarkItDown conversion |
| `extensions/memory/memory-ops.ts` | refreshIndex, getMemoryStatus, ensureProjectDir, updateTaskWidget |
| `extensions/memory/tools.ts` | 9 tool registrations (remember, recall, forget, supersede, notebook, memory_status, convert_file, confirm, set_project) |
| `extensions/memory/hooks.ts` | 7 lifecycle hooks (session_start, before_agent_start, context, agent_start, turn_end, agent_end, tool_result) |
| `extensions/memory/commands.ts` | /subagent-model command |
| `extensions/auto.ts` | Auto task execution loop — reads spec tasks.md, dispatches pending tasks via agent_end hook |
| `extensions/ocr.ts` | PaddleOCR extension — /ocr command + ocr_image/ocr_document tools |
| `agents/memory-extractor.md` | Subagent system prompt — defines how to distill raw.md into essence + notebook + long-term memory |
| `scripts/run_extraction.py` | Python pipeline — formats messages to raw.md + turn-summary.md, spawns pi -p subagent |
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

1. Edit code at `C:\Users\10342\.pi\agent\extensions\` (or scripts/agents)
2. Copy changed files to this project repo
3. Commit and push

This project is the **downstream** — copy TO it, not FROM it.

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
