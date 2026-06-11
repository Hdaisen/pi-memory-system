<div align="center">

# 🧠 Pi Memory System

### 让 Pi 拥有真正的长期记忆，像大脑一样思考、记录、进化

### Give Pi a true long-term memory — think, record, evolve like a brain

[![Pi Agent](https://img.shields.io/badge/Pi-0.79%2B-blue)](https://github.com/earendil-works/pi-coding-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/your-username/pi-memory-system/pulls)

</div>

---

<br>

# 🌏 中文文档

## 概述

**Pi Memory System** 是一个为 [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) 设计的记忆系统扩展。它让 AI 助手拥有**真正的大脑式记忆**——不是把整个对话历史塞进上下文，而是像人脑一样：

- **记住关键信息**，过滤冗余
- **自动关联**不同知识点
- **分层管理**：身份不变、任务动态、知识累积
- **上下文永远精炼**，不被历史拖垮

### 核心哲学

> **"大脑是用来思考的，不是用来记忆的。"**
>
> 每次 LLM 调用只保留最近 3 轮对话。旧消息被过滤——但它们的价值已提炼到记忆文件中。
> 这不是缺陷，这是特性。

### 三层架构

| 层级 | 文件 | 作用 |
|------|------|------|
| 🏛️ **核心提示词** | `~/.pi/agent/memory/core-prompt.md` | AI 身份、原则、行为框架。永不变 |
| 📓 **会话小本本** | `.pi/memory/notebook.md`（每项目独立） | 当前任务、进度、活跃上下文。永不清空，只更新 |
| 🗄️ **长期记忆** | `.pi/memory/memories/*.md`（项目）<br>`~/.pi/agent/memory/personal/*.md`（全局） | 事实、偏好、决策、事件。知识库 |

## 工作流程

```
你发送消息
    │
    ▼
before_agent_start ── 自动注入：
    ├─ 核心提示词（你是谁 + 怎么思考 + 记忆协议）
    ├─ 会话小本本（当前任务 + 上下文）
    └─ 通过 [[链接]] 选择性读取关联记忆
    │
    ▼
context ── 每次 LLM 调用前触发：
    └─ 精炼：只在用户发新消息时执行
       mid-turn tool loop 中不做清理
       保留最近 3 轮 + 所有系统消息
       旧消息 → 关键信息已沉淀到记忆中
    │
    ▼
LLM 思考 & 回复（含置信度标注）
    │
    ▼
agent_end ── 自动触发记忆提炼：
    ├─ 更新小本本（进度、新决策）
    ├─ 写入长期记忆
    │   ├─ 项目特有 → scope="project"
    │   └─ 跨项目通用 → scope="global"
    ├─ 标注置信度/触发器/翻转条件
    └─ 更新核心提示词（如果身份有变化）
```

## 内置工具（6 个）

| 工具 | 说明 |
|------|------|
| `🧠 remember` | 关键信息存入长期记忆，自动分类，支持置信度和触发器 |
| `🔍 recall` | 搜索记忆，返回片段 + 链接，支持按置信度过滤 |
| `↗️ supersede` | **标记旧条目已被取代**（推荐替代 forget），保留修正链 |
| `🗑️ forget` | ⚠️ 删除记忆。**优先用 supersede** |
| `📓 notebook` | 查看或更新会话小本本 |
| `📊 memory_status` | 查看记忆系统文件状态概览 |

所有工具由 AI 自主调用，开发者只需要正常对话。

## 快速开始

### 前置要求

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+

### 一键初始化

#### Windows (PowerShell)

```powershell
git clone https://github.com/your-username/pi-memory-system.git
cd pi-memory-system

cd C:\YourProject
C:\path\to\pi-memory-system\scripts\init.ps1

# 或直接指定目录
C:\path\to\pi-memory-system\scripts\init.ps1 -ProjectDir "C:\MyProject"
```

#### macOS / Linux

```bash
git clone https://github.com/your-username/pi-memory-system.git
cd pi-memory-system

cd /path/to/your/project
bash /path/to/pi-memory-system/scripts/init.sh

# 或直接指定目录
bash /path/to/pi-memory-system/scripts/init.sh /path/to/your/project
```

### 手动安装

**1. 安装扩展**

把 `extension/memory.ts` 复制到：

```
Windows: %USERPROFILE%\.pi\agent\extensions\memory.ts
macOS/Linux: ~/.pi/agent/extensions/memory.ts
```

**2. 创建全局记忆文件**

```
~/.pi/agent/memory/
├── core-prompt.md           # 复制 templates/core-prompt.md 并自定义
└── personal/
    ├── facts.md
    ├── preferences.md
    ├── decisions.md
    └── events.md
```

**3. 在项目中初始化**

```
你的项目目录/
└── .pi/memory/
    ├── notebook.md           # 复制 templates/notebook.md
    └── memories/
        ├── facts.md
        ├── preferences.md
        ├── decisions.md
        └── events.md
```

### 第一步配置

**核心提示词** — 编辑 `~/.pi/agent/memory/core-prompt.md`，设置你的 AI 人设：

```markdown
## Identity
- **I am**: [你的 AI 名字]，[人设描述]
- **User**: [你的名字]，我的伙伴
- **Core Belief**: "大脑用来思考，不是用来记忆。"
```

> ⚠️ **最重要的一步！** 核心提示词定义 AI 的个性、思考方式和沟通风格。
> 花 5 分钟写好它，之后系统自动运转。

### 重启 Pi

重启 Pi 或执行 `reload` 命令。之后正常聊天即可——AI 会自动管理记忆！

## 设计原理

### 为什么用 Markdown？

- **LLM 原生擅长**读写 Markdown（人类可读 + AI 可写）
- **零格式转换**：文件内容可以直接注入到系统提示词
- **JSON 是错误的方向**——LLM 操作 JSON 需要精确的逗号和引号，极易出错
- **Obsidian 兼容**：可以用 Obsidian 打开 `.pi/memory/`，可视化你的记忆网络

### 为什么用 [[双向链接]]？

- 模拟大脑的联想网络，而非死板的树状分类
- 一条记忆可以关联多条其他记忆
- 长期使用后形成真正的知识图谱
- Extension 会自动解析链接可到达性，发现孤立条目

### 为什么采用上下文精炼？

- 上下文窗口是有限资源
- 旧对话的真实价值在于提炼后的知识，而非原始文本
- 每次 LLM 调用前自动过滤 + 注入记忆 = 上下文永远精炼有效
- **关键保护**：mid-turn tool loop 中不做清理，避免在错误循环中丢失上下文

### 为什么分三层？

| 层级 | 变化频率 | 内容特点 |
|------|----------|----------|
| 核心提示词 | 几乎不变 | 身份、原则、哲学 |
| 小本本 | 每次对话 | 任务、进度、上下文 |
| 长期记忆 | 逐步累积 | 知识、决策、事件 |

分离的好处：
- 恒常信息不会被动态信息稀释
- 不同类型的记忆有各自的写入/检索策略
- 每层都可以独立演化

### 置信度标注 — 防推测伪装成事实

每条决策和事件记录必须标注置信度：

| 标注 | 含义 |
|------|------|
| `[confirmed]` | 已验证，有明确证据 |
| `[inferred]` | 推理得出，未直接验证 |
| `[intuition]` | 直觉/预感，无直接证据 |

### 翻转条件 — 可证伪的决策才有价值

- **经验决策**（基于事实/实验）— 必须声明翻转条件：什么证据出现时这个决策会被推翻？
- **偏好决策**（主观/实用主义）— 可选，但应记录权衡点和替代方案

### Supersede — 保留修正链，不销毁证据

- **语义修正**（推理错误、结论改变）→ 标记旧条目 "↗ Superseded by [[新条目]]"，追加新条目
- **非语义修正**（错别字、死链）→ 可直接编辑
- **`forget` 仅限**测试数据、重复条目、明显噪音

### 记忆作用域 — project vs global

| 作用域 | 存储位置 |
|--------|----------|
| `project`（默认） | `.pi/memory/memories/*.md` |
| `global` | `~/.pi/agent/memory/personal/*.md` |

**判断标准**："换一个项目时这个信息还有用吗？" → 是 → global。否 → project。

**双重记录**：一条信息可以同时写两个作用域——项目细节存 project，通用经验/教训存 global。

## 扩展开发

本系统 100% 使用 Pi 的 Extension API 构建。
如果你需要自定义行为，可以参考 `extension/memory.ts` 学习：

- `pi.on("before_agent_start", ...)` — 注入自定义上下文
- `pi.on("context", ...)` — 控制上下文精炼策略（重点：mid-turn 保护）
- `pi.registerTool(...)` — 注册自定义工具
- `pi.on("agent_end", ...)` — 在 AI 回复后触发后处理

## 项目结构

```
pi-memory-system/
├── extension/
│   └── memory.ts              # ✅ Pi 扩展（核心逻辑）
├── templates/
│   ├── core-prompt.md          # 📝 核心提示词模板（需自定义）
│   ├── notebook.md             # 📝 会话小本本模板
│   └── memories/
│       ├── facts.md            # 📝 事实模板
│       ├── preferences.md      # 📝 偏好模板
│       ├── decisions.md        # 📝 决策模板（含置信度/翻转条件/分块指引）
│       └── events.md           # 📝 事件模板（含触发器/分块指引）
├── example/
│   └── .pi/memory/             # 📂 示例项目结构
├── scripts/
│   ├── init.ps1                # ⚡ Windows 初始化脚本
│   └── init.sh                 # ⚡ Unix 初始化脚本
├── LICENSE                     # MIT License
└── README.md                   # 就是你现在看的这个
```

---

<br>

# 🌏 English Documentation

## Overview

**Pi Memory System** is a memory extension for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent).
It gives your AI assistant **true brain-like memory** — instead of cramming entire conversation history into context, it works like a human brain:

- **Remember what matters**, filter out noise
- **Auto-link** related knowledge
- **Layered management**: identity stays, tasks evolve, knowledge accumulates
- **Context stays clean**, never bogged down by history

### Core Philosophy

> **"Brains are for thinking, not for remembering."**
>
> Only the last 3 conversation turns are kept per LLM call. Old messages are filtered
> — but their value has been distilled into memory files.
> This is not a bug. It's a feature.

### Three-Layer Architecture

| Layer | File | Purpose |
|-------|------|---------|
| 🏛️ **Core Prompt** | `~/.pi/agent/memory/core-prompt.md` | AI identity, principles, behavior. Permanent |
| 📓 **Session Notebook** | `.pi/memory/notebook.md` (per project) | Current task, progress, active context. Never cleared, only updated |
| 🗄️ **Long-term Memory** | `.pi/memory/memories/*.md` (project)<br>`~/.pi/agent/memory/personal/*.md` (global) | Facts, preferences, decisions, events. The knowledge base |

## How It Works

```
You send a message
    │
    ▼
before_agent_start ── auto-inject:
    ├─ Core prompt (who you are + how to think + memory protocol)
    ├─ Session notebook (current task + context)
    └─ Related memories resolved via [[Wiki-links]]
    │
    ▼
context ── fires before EVERY LLM call:
    └─ Refine: only when user sends a new message
       No refinement during mid-turn tool loops
       Keep last 3 turns + all system messages
       Old messages → key info already in memory
    │
    ▼
LLM thinks & responds (with confidence tags)
    │
    ▼
agent_end ── auto-trigger memory distillation:
    ├─ Update notebook (progress, new decisions)
    ├─ Write to long-term memory
    │   ├─ Project-specific → scope="project"
    │   └─ Cross-project → scope="global"
    ├─ Annotate confidence/trigger/falsification
    └─ Update core prompt (if identity changes)
```

## Built-in Tools (6)

| Tool | Description |
|------|-------------|
| `🧠 remember` | Store into long-term memory, `file` param for chunked storage, supports confidence and trigger |
| `🔍 recall` | Search memory, return snippets + links, filter by confidence |
| `↗️ supersede` | **Mark old entry as superseded** (prefer over forget), keep correction chain |
| `🗑️ forget` | ⚠️ Delete memory. **Prefer supersede** |
| `📓 notebook` | View or update the session notebook |
| `📊 memory_status` | View memory system file status and entry overview (with chunked structure) |

All tools are autonomously invoked by the AI. Just chat normally.

## Quick Start

### Prerequisites

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+

### One-Click Setup

#### Windows (PowerShell)

```powershell
git clone https://github.com/your-username/pi-memory-system.git
cd pi-memory-system

cd C:\YourProject
C:\path\to\pi-memory-system\scripts\init.ps1

# Or specify directly:
C:\path\to\pi-memory-system\scripts\init.ps1 -ProjectDir "C:\MyProject"
```

#### macOS / Linux

```bash
git clone https://github.com/your-username/pi-memory-system.git
cd pi-memory-system

cd /path/to/your/project
bash /path/to/pi-memory-system/scripts/init.sh

# Or specify directly:
bash /path/to/pi-memory-system/scripts/init.sh /path/to/your/project
```

### Manual Installation

**1. Install extension**

Copy `extension/memory.ts` to:

```
Windows: %USERPROFILE%\.pi\agent\extensions\memory.ts
macOS/Linux: ~/.pi/agent/extensions/memory.ts
```

**2. Create global memory files**

```
~/.pi/agent/memory/
├── core-prompt.md           # Copy from templates/ and customize
└── personal/
    ├── facts.md
    ├── preferences.md
    ├── decisions.md
    └── events.md
```

**3. Initialize in your project**

```
your-project/
└── .pi/memory/
    ├── notebook.md           # Copy from templates/notebook.md
    └── memories/
        ├── facts.md
        ├── preferences.md
        ├── decisions.md
        └── events.md
```

### First-Time Configuration

**Core Prompt** — Edit `~/.pi/agent/memory/core-prompt.md` to set your AI persona:

```markdown
## Identity
- **I am**: [Your AI name], [persona description]
- **User**: [Your name], my partner
- **Core Belief**: "Brains are for thinking, not for remembering."
```

> ⚠️ **This is the most important step!** The core prompt defines your AI's personality,
> thinking style, and communication approach. Spend 5 minutes getting it right,
> and the system will run itself from there.

### Restart Pi

Restart Pi or run the `reload` command. Then just chat normally — the AI will manage memory automatically!

## Design Rationale

### Why Markdown?

- **LLMs are natively good at** reading and writing Markdown
- **Zero format conversion** — file content goes directly into the system prompt
- **JSON is the wrong direction** — LLMs struggle with exact commas and quotes
- **Obsidian compatible** — open `.pi/memory/` in Obsidian to visualize your memory network

### Why [[Wiki-links]]?

- Mimics the brain's associative network, not rigid tree structures
- One memory can link to many others
- Over time, forms a real knowledge graph
- Extension auto-resolves reachability and detects orphans

### Why Context Refinement?

- Context windows are finite resources
- The real value of old conversations is distilled knowledge, not raw text
- Auto-filter + inject memory before every LLM call = context stays clean
- **Key protection**: no refinement during mid-turn tool loops, prevents context loss during error loops

### Why Three Layers?

| Layer | Change Frequency | Content |
|-------|------------------|---------|
| Core Prompt | Rarely | Identity, principles, philosophy |
| Notebook | Every session | Tasks, progress, context |
| Long-term Memory | Gradually | Knowledge, decisions, events |

Benefits:
- Static identity isn't diluted by dynamic task info
- Each layer has its own write/retrieval strategy
- Each layer can evolve independently

### Confidence Tags — Don't Pass Off Speculation as Fact

Every decision and event record must include a confidence tag:

| Tag | Meaning |
|-----|---------|
| `[confirmed]` | Verified with evidence |
| `[inferred]` | Reasonable deduction, not directly verified |
| `[intuition]` | Gut feeling, no direct evidence |

### Falsification Conditions — Decisions Should Be Falsifiable

- **Empirical decisions** (facts/experiments) — must declare: "What evidence would overturn this?"
- **Preference decisions** (subjective/pragmatic) — optional, but should record trade-offs

### Supersede — Keep the Correction Chain

- **Semantic corrections** (wrong reasoning, conclusion changes) — mark old entry "↗ Superseded by [[new-entry]]", append new entry
- **Non-semantic corrections** (typos, dead links) — can edit directly
- **`forget` only for** test data, duplicates, obvious noise

### Memory Chunking — Type-Based Storage

Long-term memory is organized by **type/topic** instead of time, preventing unlimited file growth.

The `remember` tool supports the `file` parameter to specify a chunked file name:

```
remember "Fixed X issue" category=event file=debugging tags=bug
# → writes to events/debugging.md
```

**Check index → Match → Write subdirectory**:
1. First check `_index.md` for existing categories
2. Match content to the best-fitting file
3. Use `file` parameter to write to subdirectory
4. **No match** — LLM proposes new filename, waits for user confirmation
5. **Fallback** — No `file` param → writes to flat file (`events.md` / `decisions.md`, backward compatible)

### Memory Scope — Project vs Global

| Scope | Storage Location |
|-------|------------------|
| `project` (default) | `.pi/memory/memories/*.md` |
| `global` | `~/.pi/agent/memory/personal/*.md` |

**Rule of thumb**: "Would this be useful when switching to a different project?" → Yes → global. No → project.

**Dual recording**: One piece of info can be stored in both scopes — project details in project, general insights in global.

### Acknowledgements

This project is deeply inspired by **[Epistemic Trace](https://github.com/yumenana/epistemic-trace)**.
Epistemic Trace's concepts of **cognitive tracing**, **confidence tagging**, and **falsification conditions**
directly influenced the design and evolution of this system.

We also made critical distinctions:
- No L0/L1 compression (LLM compression risks confirmation bias)
- No standalone failures.md (tag-based in events.md)
- Optional falsification conditions (separating empirical from preference decisions)
- Added coding-specific trigger types (debugging, code-review, refactoring)

**Grateful for the contribution of the Epistemic Trace project.** 🙌

## Extending the System

This extension is built 100% with Pi's Extension API.
To customize behavior, study `extension/memory.ts` for patterns:

- `pi.on("before_agent_start", ...)` — inject custom context
- `pi.on("context", ...)` — control context refinement (key: mid-turn protection)
- `pi.registerTool(...)` — register custom tools
- `pi.on("agent_end", ...)` — post-processing after AI responds

## Project Structure

```
pi-memory-system/
├── extension/
│   └── memory.ts              # ✅ Pi extension (core logic)
├── templates/
│   ├── core-prompt.md          # 📝 Core prompt template (customize me!)
│   ├── notebook.md             # 📝 Session notebook template
│   └── memories/
│       ├── facts.md            # 📝 Facts template
│       ├── preferences.md      # 📝 Preferences template
│       ├── decisions.md        # 📝 Decisions template (with confidence/falsification/chunking guide)
│       └── events.md           # 📝 Events template (with trigger/chunking guide)
├── example/
│   └── .pi/memory/             # 📂 Example project structure
├── scripts/
│   ├── init.ps1                # ⚡ Windows setup script
│   └── init.sh                 # ⚡ Unix setup script
├── LICENSE                     # MIT License
└── README.md                   # You're reading it!
```

## License

MIT — feel free to use, modify, and share.

---

<div align="center">

**Made with 🐱 by [Jason & Daisen]**

*Brains are for thinking, not for remembering.*

</div>
