<div align="center">

# 🧠 Pi Memory System

### True long-term memory for Pi — think, record, evolve like a brain

[![Pi Agent](https://img.shields.io/badge/Pi-0.79%2B-blue)](https://github.com/earendil-works/pi-coding-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Hdaisen/pi-memory-system/pulls)

<br>

[🇨🇳 中文](README.zh-CN.md)

</div>

---

## Overview

**Pi Memory System** is a memory extension for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent). It gives your AI assistant **true brain-like memory** — not cramming entire conversations into context, but remembering like a human:

- **Keep the signal**, filter the noise
- **Auto-link knowledge** into a web of relationships
- **Layered management**: identity permanence, task dynamics, knowledge accumulation
- **Context stays lean** — never dragged down by history

### Core Philosophy

> **"Brains are for thinking, not for remembering."**
>
> The main LLM never sees raw conversation history. A dedicated subagent (memory-extractor) processes each turn's conversation into curated essence + long-term memory. This is the **cerebellum** doing the walking while the **cortex** does the thinking.

### Architecture

```
┌──────────────────────────────────────────────────┐
│                   User sends message              │
└────────────────────┬─────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────┐
│  before_agent_start (extension)                   │
│  ├─ Inject core-prompt + rules                   │
│  ├─ Inject notebook.md (subagent-maintained)     │
│  ├─ Inject essence.md (last turn's handoff)      │
│  └─ Inject linked memories via [[Wiki-links]]     │
└────────────────────┬─────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────┐
│  context (extension)                              │
│  └─ Strip all history except system + current msg │
└────────────────────┬─────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────┐
│  Main LLM thinks & replies (no memory maintenance)│
└────────────────────┬─────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────┐
│  agent_end (extension → Python → subagent)        │
│                                                    │
│  1. Write turn-summary.md (verbatim last response) │
│  2. Dump messages → python3 run_extraction.py     │
│     ├─ Format → turns/raw.md (filter system/read) │
│     └─ Spawn pi -p (memory-extractor)             │
│        ├─ Write essence.md (next turn's handoff)  │
│        ├─ Update notebook.md                      │
│        └─ Call remember() for long-term memory    │
│  3. On error → log to turns/extraction-error.log  │
│  4. Status: 🧠 🟢 / 🟡 / ⏳ / 🔴                   │
└──────────────────────────────────────────────────┘
```

### Three-Layer Architecture

| Layer | File | Maintainer |
|:------|:-----|:-----------|
| 🏛️ **Core Prompt** | `~/.pi/agent/memory/core-prompt.md` | Extension (auto) |
| 📓 **Session Notebook** | `~/.pi/agent/memory/projects/<name>/notebook.md` | Subagent (auto) |
| 🔄 **Turn Summary** | `~/.pi/agent/memory/projects/<name>/turns/turn-summary.md` | Extension (auto) |
| 🔗 **Essence** | `~/.pi/agent/memory/projects/<name>/turns/essence.md` | Subagent (auto) |
| 📝 **Raw Archive** | `~/.pi/agent/memory/projects/<name>/turns/raw.md` | Python (auto) |
| 🗄️ **Long-term Memory** | `~/.pi/agent/memory/projects/<name>/memories/` (project)<br>`~/.pi/agent/memory/personal/` (global) | Subagent via `remember` |

### Key Design: Subagent Distillation

The main LLM **never** performs memory maintenance. After each turn:

1. **Extension** (TypeScript): dumps the raw conversation to `turns/raw/messages.json`
2. **Python script** (`run_extraction.py`): filters noise (system prompts, read results), formats to Markdown, saves to `turns/raw.md`
3. **Subagent** (spawned Pi process): reads `raw.md`, writes `essence.md` (next turn handoff), updates `notebook.md`, calls `remember()` for long-term storage

This mimics the brain's sleep consolidation — the hippocampus (subagent) replays and consolidates while the cortex (main LLM) rests.

### Context Strategy

The main LLM receives **zero raw conversation history**. Each turn:
- `essence.md` (~500B) — curated handoff from last turn
- `notebook.md` (~500B) — session state
- Core prompt + rules + linked memories

Everything else is stripped by the `context` event handler (mid-turn safe).

## Tools & Commands

| Tool | Description |
|:-----|:-------------|
| `🧠 remember` | Store to memory, auto-classify with confidence/trigger/chunking |
| `🔍 recall` | Search memory, filter by confidence |
| `↗️ supersede` | Mark old entry as superseded (keep correction chain) |
| `🗑️ forget` | ⚠️ Delete. Prefer supersede. |
| `📓 notebook` | View/update the session notebook |
| `📊 memory_status` | View memory file status overview |
| `📄 convert_file` | Convert binary files (PDF, DOCX, etc.) to Markdown via MarkItDown (WSL) |
| `🔄 set_project` | Correct project name detection |
| `/subagent-model` | Pick model for memory-extractor subagent |

## Quick Start

### Prerequisites

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+
- Python 3 (for `run_extraction.py`)

### Install

```bash
# Clone this repo
git clone https://github.com/Hdaisen/pi-memory-system.git
cd pi-memory-system

# One-command install (creates directories, copies extension + templates + scripts)
./scripts/init.sh

# Or on Windows (PowerShell):
.\scripts\init.ps1
```

The init script will:
1. Create `~/.pi/agent/memory/projects/<name>/` directory structure
2. Copy template files (notebook, memory entry templates)
3. Install the extension (`memory.ts` + `memory/` modules) to `~/.pi/agent/extensions/`
4. Set up global `core-prompt.md` and `rules.md` (first time only)

Then restart Pi or run `/reload`.

## Design Principles

### Why Subagents?

- **Main LLM** = prefrontal cortex: focuses on the current problem
- **Subagent** = hippocampus: consolidates memories in the background
- **Extension** = brain stem: handles routine mechanical tasks

The main LLM never thinks about "what should I remember" — it's all automatic.

### Confidence Tags

Same as before — every decision and event entry must be tagged:

| Tag | Meaning |
|:----|:--------|
| `[confirmed]` | Verified with evidence |
| `[inferred]` | Logical deduction, not directly verified |
| `[intuition]` | Gut feeling, no direct evidence |

### Chunked Storage

```
memories/
├── _index.md              ← Auto-generated index (refreshed per turn)
├── facts.md
├── preferences.md
├── decisions/
│   ├── architecture.md
│   ├── tools.md
│   └── process.md
└── events/
    ├── debugging.md
    ├── upgrade.md
    └── design.md
```

### Memory Scoping

| Scope | Location | Judgement |
|:------|:---------|:----------|
| `project` | `~/.pi/agent/memory/projects/<name>/memories/` | Only useful in this project |
| `global` | `~/.pi/agent/memory/personal/` | Still useful in other projects |

## Status Indicators

The extension shows memory system status in Pi's footer:

| Status | Meaning |
|:-------|:--------|
| `🧠 🟢` | Memory system healthy |
| `🧠 🟡` | Context trimming active |
| `🧠 ⏳` | Extraction running |
| `🧠 🔴` | Extraction failed (check `turns/extraction-error.log`) |

### Debugging Extraction Errors

When you see `🧠 🔴`, check the error log:

```bash
cat ~/.pi/agent/memory/projects/<name>/turns/extraction-error.log
```

Common causes:
- `pi` not found in PATH (subagent spawn failed)
- Python script timeout (>360s)
- Subagent process crash

## Subagent Model

By default, the subagent uses Pi's current default model. Use `/subagent-model` to pick a lighter model (the subagent only does knowledge distillation, not code generation).

```bash
# In Pi terminal:
/subagent-model
# → select from: mimo-v2.5, claude-sonnet, gpt-4o, gemini-flash, etc.
```

The selection is persisted in `~/.pi/agent/memory/subagent-model.txt`. Delete the file or pick `(default)` to reset.

## Project Structure

```
pi-memory-system/
├── extensions/
│   ├── memory.ts              # Entry point (wires hooks, tools, commands)
│   └── memory/
│       ├── config.ts          # HOME, PATHS, project name detection
│       ├── utils.ts           # safeRead, extractLinks, resolveLink, walkMarkdownFiles
│       ├── diversity.ts       # Content fingerprinting, diversity sort
│       ├── markitdown.ts      # Binary file detection, MarkItDown WSL conversion
│       ├── memory-ops.ts      # refreshIndex, getMemoryStatus, ensureProjectDir
│       ├── tools.ts           # 9 tool registrations (remember, recall, etc.)
│       ├── hooks.ts           # 7 lifecycle hooks (before_agent_start, agent_end, etc.)
│       └── commands.ts        # /subagent-model command
├── agents/
│   └── memory-extractor.md    # Subagent definition
├── scripts/
│   ├── run_extraction.py      # Main pipeline (format + subagent launch)
│   ├── init.ps1               # Windows install script
│   └── init.sh                # Unix/macOS install script
├── templates/                 # Template files for init
├── core-prompt.md             # Reference core prompt
├── rules.md                   # Behavioral rules
├── LICENSE                    # MIT
├── README.md                  # English documentation
└── README.zh-CN.md            # Chinese documentation
```

---

<div align="center">

**Made with 🐱 by [Jason & Daisen]**

*Brains are for thinking, not for remembering.*

</div>
