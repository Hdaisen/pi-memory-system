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
> Only the last 3 turns are kept per LLM call. Old messages are filtered — but their value has been distilled into memory files. This is by design.

### Three-Layer Architecture

| Layer | File | Purpose |
|:------|:-----|:---------|
| 🏛️ **Core Prompt** | `~/.pi/agent/memory/core-prompt.md` | Identity, principles, behavior framework |
| 📓 **Session Notebook** | `~/.pi/agent/memory/projects/<name>/notebook.md` (per project) | Current tasks, progress, active context |
| 🗄️ **Long-term Memory** | `~/.pi/agent/memory/projects/<name>/memories/` (project)<br>`~/.pi/agent/memory/personal/` (global) | Facts, preferences, decisions, events |

## Workflow

```
User sends a message
    ↓
before_agent_start ── auto-inject:
  ├─ Core prompt (who you are + memory protocol)
  ├─ Session notebook (current tasks + context)
  └─ [[Wiki-links]] selectively load related memories
    ↓
context ── triggers before every LLM call:
  └─ Refine: only on new user messages
     Keep last 3 turns + all system messages
     Old messages → key info already in memory
    ↓
LLM thinks & replies (with confidence annotations)
    ↓
agent_end ── auto-distill:
  ├─ Update notebook (progress, new decisions)
  ├─ Write to long-term memory (project / global)
  ├─ Annotate confidence / trigger / falsification conditions
  └─ Update core prompt (if identity changed)
```

## Tools (8)

| Tool | Description |
|:-----|:-------------|
| `🧠 remember` | Store to memory, auto-classify with confidence/trigger/chunking |
| `🔍 recall` | Search memory, filter by confidence |
| `↗️ supersede` | Mark old entry as superseded (keep correction chain) |
| `🗑️ forget` | ⚠️ Delete. Prefer supersede. |
| `📓 notebook` | View/update the session notebook |
| `📊 memory_status` | View memory file status overview |
| `📄 convert_file` | Convert binary files (PDF/DOCX/XLSX) to Markdown (requires WSL + MarkItDown) |
| `📦 ccr_retrieve` | Recover original content after auto-compression |

## Auto Features

| Feature | Trigger | Description |
|:--------|:--------|:-------------|
| 🔄 Binary → Markdown | When `read` fails | PDF/DOCX/PPTX/XLSX auto-converted to Markdown |
| 📦 Content compression | When `bash` output >2KB | JSON arrays / search results / repeated logs → compact format + CCR cache |
| 🔙 Original retrieval | LLM calls `ccr_retrieve` | Recover full content via `<<ccr:hash>>` markers |

## Quick Start

### Prerequisites

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+

### One-Click Init

#### Windows (PowerShell)
```powershell
git clone https://github.com/Hdaisen/pi-memory-system.git
cd C:\YourProject
C:\path\to\pi-memory-system\scripts\init.ps1
# Or: init.ps1 -ProjectDir "C:\MyProject"
```

#### macOS / Linux
```bash
git clone https://github.com/Hdaisen/pi-memory-system.git
cd /path/to/your/project
bash /path/to/pi-memory-system/scripts/init.sh
# Or: init.sh /path/to/your/project
```

### Manual Install

**1. Install extension files**
```bash
cp extension/memory.ts ~/.pi/agent/extensions/memory.ts
cp extension/compress.ts ~/.pi/agent/extensions/compress.ts
```

**2. Create global memory**
```
~/.pi/agent/memory/
├── core-prompt.md          # Copy templates/core-prompt.md and customize
└── personal/
    ├── facts.md
    ├── preferences.md
    ├── decisions.md
    └── events.md
```

**3. Project initialization**
```
your-project/~/.pi/agent/memory/projects/<name>/
├── notebook.md             # Copy templates/notebook.md
└── memories/
    ├── _index.md
    ├── facts.md
    ├── preferences.md
    ├── decisions.md
    └── events.md
```

### Core Prompt Configuration

Edit `~/.pi/agent/memory/core-prompt.md`:
```markdown
## Identity
- **I am**: [Your AI name], [character description]
- **User**: [Your name], my partner
- **Core Belief**: "Brains are for thinking, not for remembering."
```

> ⚠️ Once written, the system runs automatically. Restart Pi or run `/reload`.

### Optional Dependencies

| Feature | Dependency | Install |
|:--------|:-----------|:--------|
| Binary → Markdown | WSL + `markitdown` (Python) | `python3 -m venv ~/.markitdown-venv && ~/.markitdown-venv/bin/pip install 'markitdown[pdf]'` |
| Content compression | None (pure TypeScript, zero deps) | Built-in |

## Design Principles

### Why Markdown + [[Wiki-links]]?

- LLMs natively speak Markdown — zero format conversion
- **JSON is the wrong direction** — LLMs struggle with exact commas and quotes
- **Obsidian compatible**: visualize your memory knowledge graph
- [[Wiki-links]] mimic the brain's associative network, not rigid tree hierarchies

### Why Three Layers?

| Layer | Change Frequency | Content | Strategy |
|:------|:-----------------|:--------|:---------|
| Core Prompt | Almost never | Identity, principles | Manual |
| Notebook | Every conversation | Tasks, context | Auto-update |
| Long-term Memory | Gradual accumulation | Knowledge, decisions | Chunked storage |

### Confidence Tags

Prevent the LLM from disguising speculation as fact — every decision and event entry must be tagged:

| Tag | Meaning |
|:----|:--------|
| `[confirmed]` | Verified with evidence |
| `[inferred]` | Logical deduction, not directly verified |
| `[intuition]` | Gut feeling, no direct evidence |

### Falsification Conditions

- **Empirical decisions** (based on facts/experiments) → must declare: what evidence would overturn this?
- **Preference decisions** (subjective/pragmatic) → optional, but record tradeoffs and alternatives

### Supersede — Preserve the Correction Chain

- **Semantic corrections** (wrong reasoning, changed conclusions) → mark old entry `↗ Superseded by [[new entry]]`, append new entry
- **Non-semantic fixes** (typos, dead links) → edit directly
- **forget only for**: test data, duplicate entries, obvious noise

### Chunked Storage

```
memories/
├── _index.md              ← Auto-generated index
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

- Use `remember`'s `file` parameter to specify chunk
- New topic with no match → LLM proposes filename, user confirms

### Memory Scoping

| Scope | Location | Judgement |
|:------|:---------|:----------|
| `project` | `~/.pi/agent/memory/projects/<name>/memories/` | Only useful in this project |
| `global` | `~/.pi/agent/memory/personal/` | Still useful in other projects |

One piece of information can be stored in both scopes simultaneously.

## Acknowledgements

Deeply inspired by **[Epistemic Trace](https://github.com/yumenana/epistemic-trace)** — specifically its concepts of **cognitive tracing**, **confidence tagging**, and **falsification conditions**. These ideas directly shaped this system's design and evolution.

Key distinctions we made:

- ❌ No L0/L1 compression (LLM compression risks confirmation bias)
- ❌ No standalone failures.md (event tagging is more flexible)
- ✅ Optional falsification conditions, separate empirical from preference decisions
- ✅ Coding-specific trigger types (debugging, code-review, refactoring)

**Our deepest gratitude to the Epistemic Trace project.** 🙌

## Extension Development

This system is built 100% with Pi's Extension API. See `extension/memory.ts` for reference:

- `pi.on("before_agent_start", ...)` — inject context
- `pi.on("context", ...)` — context refinement strategy (with mid-turn protection)
- `pi.registerTool(...)` — register tools
- `pi.on("agent_end", ...)` — post-processing

## Project Structure

```
pi-memory-system/
├── extension/
│   ├── memory.ts            # Core Pi extension
│   └── compress.ts          # Content compression module (imported by memory.ts)
├── templates/               # Template files
├── example/                 # Example project
├── scripts/                 # Setup scripts
├── LICENSE                  # MIT
├── README.md                # English documentation
└── README.zh-CN.md          # Chinese documentation
```

---

<div align="center">

**Made with 🐱 by [Jason & Daisen]**

*Brains are for thinking, not for remembering.*

</div>
