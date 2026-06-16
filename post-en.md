# Give Your AI Coding Assistant a Memory That Actually Works

> The worst part about coding with AI? It forgets everything between sessions.

---

## The Problem: Context Windows Are Not Memory

If you use Claude Code, Cursor, Copilot, or any AI coding assistant, you know the drill:

- 🔄 You explain your project architecture in session 1. Session 2? It's gone.
- 📝 You repeat "this variable does X" and "that API belongs to module Y" every conversation.
- 🧠 The context window fills up and earlier decisions vanish into thin air.
- 📋 You end up maintaining CLAUDE.md or .cursorrules manually — but they don't update themselves.

**AI coding assistants have no concept of accumulated experience. Every conversation starts from zero.**

---

## The Solution: Pi Memory System

An open-source memory extension for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) that gives your AI persistent, layered memory.

**Core idea**: The AI's brain should think, not memorize. Let a dedicated system handle memory.

### Three-Layer Memory Architecture

```
┌─────────────────────────────────────────────┐
│  Core Prompt (core-prompt.md)               │  ← Identity, principles, thinking framework
├─────────────────────────────────────────────┤
│  Session Notebook (notebook.md)             │  ← Active tasks, todos, constraints
├─────────────────────────────────────────────┤
│  Long-term Memory (memories/*.md)           │  ← Cross-session knowledge accumulation
└─────────────────────────────────────────────┘
```

### How It Works

```
End of each conversation turn
    ↓
Subagent reads raw conversation
    ↓
Distills key info → writes essence.md (baton for next turn)
    ↓
Updates session notebook → notebook.md
    ↓
Persists long-term memory → memories/*.md (via remember tool)
```

**The main LLM never sees raw conversation history** — only the distilled essence from the subagent. This means:

- Context window stays clean and focused
- Important information doesn't get lost in noise
- Memory self-organizes, deduplicates, and stays current

### 9 Memory Tools

| Tool | Purpose |
|------|---------|
| `remember` | Store long-term memory with confidence levels, tags, and scope |
| `recall` | Search memory with keyword matching + diversity ranking |
| `forget` | Delete memory (use sparingly) |
| `supersede` | Mark old memory as outdated, preserving the correction chain |
| `notebook` | View/update session notebook |
| `memory_status` | Overview of memory system status |
| `convert_file` | Convert binary files to Markdown (PDF, DOCX, etc.) |
| `confirm` | Interactive yes/no prompts |
| `set_project` | Fix project name detection |

### Real-World Results

I use this system to maintain the pi-memory-system project itself. Now:

- ✅ Say "use branch + PR workflow" once — it remembers forever
- ✅ Say "auto-convert WSL paths" — it stops making the same mistake
- ✅ Project architecture, design decisions, coding standards — all self-maintaining
- ✅ Seamless cross-session conversations, like working with a colleague who actually knows your project

---

## Quick Start

### 1. Install Pi Coding Agent

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. Initialize Memory System

**Windows (PowerShell):**
```powershell
git clone https://github.com/Hdaisen/pi-memory-system.git
cd pi-memory-system
.\scripts\init.ps1
```

**macOS / Linux:**
```bash
git clone https://github.com/Hdaisen/pi-memory-system.git
cd pi-memory-system
chmod +x scripts/init.sh
./scripts/init.sh
```

### 3. Configure Your AI Provider

```bash
pi --configure
```

Follow the prompts to add API keys for OpenAI, Anthropic, or any other provider.

### 4. Start Using

```bash
pi
```

That's it. Your AI assistant now has memory.

---

## Project Structure

```
~/.pi/agent/
├── extensions/memory.ts          # Memory extension entry point
├── extensions/memory/            # Core modules
├── agents/memory-extractor.md    # Subagent prompt
├── scripts/run_extraction.py     # Memory extraction script
└── memory/
    ├── core-prompt.md            # Core prompt
    ├── rules.md                  # Behavioral rules
    ├── projects/<name>/          # Per-project memory
    │   ├── notebook.md           # Session notebook
    │   ├── memories/             # Long-term memory
    │   └── turns/                # Conversation distillation
    └── personal/                 # Cross-project memory
```

---

## Why Pi Memory System?

- **Open source & free**: MIT licensed, fully transparent
- **LLM-agnostic**: Works with OpenAI, Anthropic, Ollama, or any provider
- **Local-first**: Memory lives in local Markdown files, not in the cloud
- **Extensible**: Built on Pi's Extension system — add your own tools and hooks
- **Zero config**: Run the init script and you're good to go

---

## Links

- **Pi Coding Agent**: https://github.com/earendil-works/pi-coding-agent
- **Pi Memory System**: https://github.com/Hdaisen/pi-memory-system

---

> 💡 If you code with AI, give it a memory. You'll go from "using a tool" to "working with a colleague."

**Star it. Fork it. Break it. Tell me what you think.**
