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
│  1. Dump messages → python3 run_extraction.py     │
│     ├─ Format → turns/raw.md (filter system/read) │
│     └─ Spawn pi -p (memory-extractor)             │
│        ├─ Write essence.md (next turn's handoff)  │
│        ├─ Update notebook.md                      │
│        └─ Call remember() for long-term memory    │
│  2. Status: 🧠 🟢 / 🟡 / 🔴                       │
└──────────────────────────────────────────────────┘
```

### Three-Layer Architecture

| Layer | File | Maintainer |
|:------|:-----|:-----------|
| 🏛️ **Core Prompt** | `~/.pi/agent/memory/core-prompt.md` | Extension (auto) |
| 📓 **Session Notebook** | `~/.pi/agent/memory/projects/<name>/notebook.md` | Subagent (auto) |
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

## Tools (6)

| Tool | Description |
|:-----|:-------------|
| `🧠 remember` | Store to memory, auto-classify with confidence/trigger/chunking |
| `🔍 recall` | Search memory, filter by confidence |
| `↗️ supersede` | Mark old entry as superseded (keep correction chain) |
| `🗑️ forget` | ⚠️ Delete. Prefer supersede. |
| `📓 notebook` | View/update the session notebook |
| `📊 memory_status` | View memory file status overview |

## Quick Start

### Prerequisites

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+
- Python 3 (for `run_extraction.py`)

### Install

```bash
# Clone this repo
git clone https://github.com/Hdaisen/pi-memory-system.git

# Copy extension
cp pi-memory-system/extensions/memory.ts ~/.pi/agent/extensions/memory.ts

# Copy scripts
cp pi-memory-system/scripts/*.py ~/.pi/agent/scripts/

# Copy subagent definition
mkdir -p ~/.pi/agent/agents
cp pi-memory-system/agents/memory-extractor.md ~/.pi/agent/agents/

# Copy core prompt
cp pi-memory-system/core-prompt.md ~/.pi/agent/memory/core-prompt.md
cp pi-memory-system/rules.md ~/.pi/agent/memory/rules.md
```

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

## Project Structure

```
pi-memory-system/
├── extensions/
│   └── memory.ts            # Core Pi extension (hooks + tools)
├── agents/
│   └── memory-extractor.md  # Subagent definition
├── scripts/
│   ├── run_extraction.py    # Main pipeline (format + subagent launch)
│   └── write_raw.py         # JSON→MD formatter (stdin/file/JSONL)
├── templates/               # Template files
├── example/                 # Example project
├── core-prompt.md           # Reference core prompt
├── rules.md                 # Behavioral rules
├── LICENSE                  # MIT
├── README.md                # English documentation
└── README.zh-CN.md          # Chinese documentation
```

---

<div align="center">

**Made with 🐱 by [Jason & Daisen]**

*Brains are for thinking, not for remembering.*

</div>
