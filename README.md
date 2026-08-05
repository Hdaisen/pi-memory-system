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

**Pi Memory System** is a memory extension for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent). It gives your AI assistant **brain-like memory** — not cramming entire conversations into context, but remembering like a human:

- **Keep the signal, filter the noise** — raw history is never injected; only curated, layered memory is
- **Working memory** — the last few rounds of conversation, injected as a sliding window
- **Consolidation** — a background subagent distills dialogue into long-term memory on a fixed cadence
- **Manual hippocampus** — a dedicated cleaner dedupes and repairs memory files when *you* ask
- **Context stays lean** — flat token usage regardless of conversation length

> **Benchmark**: a [299-round A/B test](docs/benchmark-report.md) measured **-88.6% tokens/round** with flat context growth, vs. linear growth to 292K tokens without the system.

## How It Works

### The Complete Mechanism

```
┌────────────────────────── PER-ROUND LOOP (every turn) ──────────────────────────┐
│                                                                                 │
│  User message                                                                    │
│    │                                                                            │
│    ▼                                                                            │
│  before_agent_start — extension injects (fixed order, stable prefix first)       │
│    1. core-prompt.md         identity & principles (stable)                     │
│    2. rules.md               behavioral rules (stable)                          │
│    3. Memory Index           compact directory of memory files                  │
│    4. dialogue-summary       LAST 5 SECTIONS — working-memory sliding window    │
│                              (each section links back → raw-<n>.md)             │
│    5. notebook.md            task state — MAINTAINED BY MAIN LLM ONLY           │
│    6. Related                linked memories + auto keyword search              │
│    7. maintenance log        when the hippocampus last ran                      │
│    │                                                                            │
│    ▼                                                                            │
│  context — strip all history, keep only system + current user message           │
│    │                                                                            │
│    ▼                                                                            │
│  Main LLM thinks & replies (updates notebook.md as task state changes)          │
│    │                                                                            │
│    ▼                                                                            │
│  agent_end — extension runs python3 run_extraction.py                           │
│    ├─ raw-<n>.md              full-conversation backup of this round            │
│    └─ dialogue-summary.md     append one section: user text + assistant text +  │
│                               key actions + back-link to raw-<n>.md             │
│         │                                                                       │
│         └─ section count % 5 == 0 ? ──YES──► consolidation-input.md (last 5     │
│                                              sections — incremental window)     │
│                                                 └─► consolidation subagent      │
│                                                     (detached, background,      │
│                                                      invisible to user)         │
│                                                         └─► remember →          │
│                                                             long-term memory    │
│         │                                                                       │
│         NO → round ends (no subagent)                                           │
└─────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── SESSION END (once) ──────────────────────────────┐
│  session_shutdown (quit)                                                        │
│    └─ leftover rounds (section count % 5) ≥ 3 ?                                 │
│            ──YES──► consolidation-input.md (leftover sections)                  │
│                        └─► consolidation subagent (detached)                    │
│            NO → do nothing (short sessions never trigger — no waste)            │
└─────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── HIPPOCAMPUS (manual) ───────────────────────────┐
│  You type /memory-clean in Pi                                                    │
│    └─► cleaner subagent (foreground, visible report)                             │
│          ├─ fix format pollution (double headers, missing metadata)              │
│          ├─ merge duplicate entries                                              │
│          ├─ supersede stale / contradictory entries                              │
│          └─ report dead links & empty files → maintenance/clean-<ts>.log         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Role Separation

| Role | Trigger | Reads | Writes | Never |
|:-----|:--------|:------|:-------|:------|
| **Main LLM** | every turn | injected context | `notebook.md` (exclusive) | writes long-term memory |
| **Consolidation subagent** (`memory-extractor`) | every 5th round + session-end catch-up (leftover ≥ 3) | `consolidation-input.md` (incremental window) | long-term memory via `remember` | writes notebook, cleans memory files, reads full history |
| **Hippocampus** (`memory-cleaner`) | **manual only** — `/memory-clean` | memory files (`memories/`, `personal/`) | cleaned memory files + report | reads conversation, writes notebook, touches `turns/` |
| **Extension** | every turn | messages | `raw-<n>.md`, `dialogue-summary.md`, `_index.md` | — |

> `notebook.md` is the main LLM's exclusive whiteboard. Both subagents treat it as **read-only** — async concurrent writes would clobber each other.

### Why the Incremental Window?

The consolidation subagent runs every 5 rounds as a **fresh process** — it can never reuse the main LLM's provider-side prefix cache across runs. The design therefore keeps its input **bounded and prefix-stable**:

- Input = only the **last 5 sections** (`consolidation-input.md`), generated by the extension at spawn time — cost stays flat no matter how many total rounds exist
- The subagent **system prompt** (from `memory-extractor.md`) is stable → that prefix *is* cacheable
- History older than the window was already distilled by previous consolidation runs; the subagent reaches it via `_index.md` + `recall`, never by re-reading raw files
- `raw-<n>.md` is **opt-in read-back** — the subagent opens it only when the summary's `→ raw-<n>.md` link lacks detail

### Why Manual Hippocampus?

Automation was rejected on purpose: if you close many short sessions, auto-triggering a cleaner on every shutdown is wasteful; if you don't use Pi for a month, scheduled cleaning is pure cost. So:

- **Consolidation** (dialogue → memory) is automatic and cheap: every 5th round, plus a session-end catch-up that fires **only when ≥ 3 rounds were left un-consolidated**
- **Hippocampus** (memory → clean memory) is **manual** — run `/memory-clean` when you feel like it

## Data Layout

```
~/.pi/agent/memory/
├── core-prompt.md                  # global identity & principles (injected every turn)
├── rules.md                        # behavioral rules (injected every turn)
├── projects/<name>/
│   ├── notebook.md                 # task state — MAIN LLM ONLY (shared across sessions)
│   ├── memories/                   # long-term memory (project scope)
│   │   ├── _index.md               # auto-refreshed directory
│   │   ├── facts.md / preferences.md
│   │   └── decisions/ events/     # categorized topic files
│   └── turns/
│       └── sessions/<session-id>/  # per-session short-term memory (isolated!)
│           ├── raw-<n>.md          # per-round full-conversation backup
│           ├── dialogue-summary.md # appended each round — the working memory
│           ├── consolidation-input.md   # incremental window for the subagent
│           └── consolidation-<ts>.log   # subagent output log
├── personal/                       # global (cross-project) long-term memory
└── maintenance/
    ├── clean-<ts>.log              # hippocampus reports
    └── index.md                    # clickable log index
```

Why per-session directories? **Parallel Pi sessions never clobber each other's short-term memory.** Long-term memory and `notebook.md` stay shared at project level.

## Memory Entry Format

```markdown
## Entry Title
- **置信度**: `[confirmed|inferred|intuition]`
- **触发器**: {type} — {description}
- tags: [tag1, tag2]
- Date: YYYY-MM-DD

Content here. Related: [[other-entry.md#Section]]
```

Categories: `fact` / `preference` / `decision` / `event`, stored in `facts/`, `preferences/`, `decisions/`, `events/` subdirectories. Every decision/event entry **must** carry a confidence tag and a trigger.

## Tools & Commands

| Tool | Description |
|:-----|:-------------|
| `🧠 remember` | Store to memory (scope: project/global, with confidence/trigger/chunking) |
| `🔍 recall` | Search memory with keyword matching + diversity sort |
| `↗️ supersede` | Mark old entry as superseded (append-only correction chain) |
| `🗑️ forget` | ⚠️ Permanent delete. Prefer supersede. |
| `📓 notebook` | View/update the session notebook |
| `📊 memory_status` | Memory file status overview |
| `📄 convert_file` | Convert binary files (PDF, DOCX…) to Markdown via MarkItDown (WSL) |
| `🔄 set_project` | Correct project name detection |
| `/subagent-model` | Pick the model used by the consolidation/hippocampus subagents |
| `/memory-clean` | **Manually run the hippocampus** — dedupe, fix, supersede memory files (foreground report) |

## Quick Start

### Prerequisites

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+
- Python 3 (for `run_extraction.py`)

### Install

```bash
git clone https://github.com/Hdaisen/pi-memory-system.git
cd pi-memory-system

# One-command install (creates directories, copies extension + templates + scripts)
./scripts/init.sh          # Unix/macOS
.\scripts\init.ps1         # Windows (PowerShell)
```

The init script:
1. Creates `~/.pi/agent/memory/projects/<name>/` structure
2. Copies templates (`core-prompt.md`, `rules.md`, `notebook.md`, memory entries)
3. Installs the extension to `~/.pi/agent/extensions/`
4. Installs required Pi packages (`pi-subagents`, `context-mode`, `pi-mcp-adapter`)
5. Restart Pi or run `/reload`

> **Tip**: if `pi update` fails on `my-pi-themes@latest` (the package was unpublished upstream), pin it in `settings.json` as `"npm:my-pi-themes@1.0.0"`.

## Design Principles

- **Main LLM = prefrontal cortex** — focuses on the problem; maintains the notebook; never thinks about "what should I remember"
- **Consolidation subagent = hippocampus by day** — replays the last 5 rounds every 5 rounds, quietly writes long-term memory
- **Cleaner = hippocampus at night** — you wake it manually with `/memory-clean` when the memory files need a tidy-up
- **Extension = brain stem** — writes raw backups + dialogue summary every turn, injects the layered context, triggers subagents
- **Cache-friendly by construction** — stable prefix first in the injection order; subagent inputs bounded; no per-turn timestamps in injected files

## Status Indicators

| Status | Meaning |
|:-------|:--------|
| `🧠 🟢` | Memory system healthy |
| `🧠 🟡` | Context trimming active |
| `🧠 ⏳` | Extraction running |
| `🧠 🔴` | Extraction failed (check `turns/extraction-error.log`) |

## Subagent Model

By default subagents use Pi's current default model. Run `/subagent-model` to pick a lighter one — consolidation and cleaning are distillation tasks, not code generation. The choice is persisted in `~/.pi/agent/memory/subagent-model.txt` (delete the file or pick `(default)` to reset).

## Project Structure

```
pi-memory-system/
├── extensions/
│   ├── memory.ts              # entry point (wires hooks, tools, commands)
│   └── memory/
│       ├── config.ts          # HOME, PATHS, project name detection
│       ├── utils.ts           # safeRead, resolveLink, readLinkedContent, lastSections/countSections
│       ├── diversity.ts       # content fingerprinting, diversity sort
│       ├── markitdown.ts      # MarkItDown WSL conversion
│       ├── memory-ops.ts      # index refresh, maintenance, spawnConsolidationSubagent
│       ├── tools.ts           # 9 tool registrations
│       ├── hooks.ts           # lifecycle hooks (session_start … session_shutdown)
│       └── commands.ts        # /subagent-model, /memory-clean
├── agents/
│   ├── memory-extractor.md    # consolidation subagent prompt
│   └── memory-cleaner.md      # hippocampus (manual) prompt
├── scripts/
│   ├── run_extraction.py      # per-round pipeline (raw backup + summary append + consolidation trigger)
│   ├── init.ps1               # Windows install
│   └── init.sh                # Unix/macOS install
├── templates/                 # files copied by init
├── core-prompt.md / rules.md  # reference copies
├── docs/benchmark-report.md   # 299-round A/B test
├── LICENSE                    # MIT
├── README.md                  # this file
└── README.zh-CN.md            # 中文文档
```

---

<div align="center">

**Made with 🐱 by [Jason & Daisen]**

*Brains are for thinking, not for remembering.*

</div>
