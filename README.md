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
> 每次 LLM 调用只保留最近 N 轮对话。旧消息被过滤——但它们的价值已提炼到记忆文件中。
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
    ├─ 核心提示词（你是谁 + 怎么思考）
    ├─ 会话小本本（当前任务 + 上下文）
    └─ 关联记忆（通过 [[双向链接]] 找到相关条目）
    │
    ▼
LLM 思考 & 回复
    │
    ▼
context ── 每次调用前精炼：
    └─ 只留最近 3 轮 + 系统提示词
       旧消息 → 关键信息已沉淀到记忆中
    │
    ▼
agent_end ── 自动触发记忆提炼：
    ├─ 更新小本本（进度、新决策）
    ├─ 写入长期记忆（新事实/偏好/事件）
    └─ 更新核心提示词（如果身份有变化）
```

## 内置工具（5 个）

| 工具 | 说明 |
|------|------|
| `🧠 remember` | 把关键信息存入长期记忆，自动分入事实/偏好/决策/事件 |
| `🔍 recall` | 搜索记忆，返回相关片段 + 关联链接 |
| `🗑️ forget` | 删除一条记忆 |
| `📓 notebook` | 查看或更新会话小本本 |
| `📊 memory_status` | 查看整个记忆系统状态概览 |

所有工具都由 AI 自主调用，开发者只需要正常对话即可。

## 快速开始

### 前置要求

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+

### 一键初始化

#### Windows (PowerShell)

```powershell
# 克隆项目
git clone https://github.com/your-username/pi-memory-system.git
cd pi-memory-system

# 进入你的工作项目目录，运行初始化
# 你的项目目录 = 你想让 Pi 工作的项目
cd C:\YourProject

# 运行初始化脚本
C:\path\to\pi-memory-system\scripts\init.ps1

# 或指定项目目录
C:\path\to\pi-memory-system\scripts\init.ps1 -ProjectDir "C:\MyProject"
```

#### macOS / Linux

```bash
# 克隆项目
git clone https://github.com/your-username/pi-memory-system.git
cd pi-memory-system

# 进入你的工作项目目录，运行初始化
cd /path/to/your/project
bash /path/to/pi-memory-system/scripts/init.sh

# 或指定项目目录
bash /path/to/pi-memory-system/scripts/init.sh /path/to/your/project
```

### 手动安装

如果不想用脚本，也可以手动操作：

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

> ⚠️ **这是最重要的一步！** 核心提示词定义了 AI 的个性、思考方式和沟通风格。
> 花 5 分钟认真写好它，之后系统会自动运转。

### 重启 Pi

重启 Pi 或执行 `reload` 命令让扩展生效。之后正常聊天即可——AI 会自动管理记忆！

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
- 需要回顾历史？用 `recall` 工具按需搜索

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

## 扩展开发

本系统 100% 使用 Pi 的 Extension API 构建。
如果你需要自定义行为，可以参考 `extension/memory.ts` 学习：

- `pi.on("before_agent_start", ...)` — 注入自定义上下文
- `pi.on("context", ...)` — 控制上下文精炼策略
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
│       ├── decisions.md        # 📝 决策模板
│       └── events.md           # 📝 事件模板
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
> Only the last N conversation turns are kept per LLM call. Old messages are filtered
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
    ├─ Core prompt (who you are + how to think)
    ├─ Session notebook (current task + context)
    └─ Related memories (resolved via [[Wiki-links]])
    │
    ▼
LLM thinks & responds
    │
    ▼
context ── refine before every call:
    └─ Keep last 3 turns + system prompt
       Old messages → key info already in memory
    │
    ▼
agent_end ── auto-trigger memory distillation:
    ├─ Update notebook (progress, new decisions)
    ├─ Write to long-term memory (new facts/preferences/events)
    └─ Update core prompt (if identity changes)
```

## Built-in Tools (5)

| Tool | Description |
|------|-------------|
| `🧠 remember` | Store info into long-term memory, auto-sorted by type |
| `🔍 recall` | Search memory, return snippets + related links |
| `🗑️ forget` | Delete a memory entry |
| `📓 notebook` | View or update the session notebook |
| `📊 memory_status` | View memory system status overview |

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

# Go to your project directory, then run:
cd C:\YourProject
C:\path\to\pi-memory-system\scripts\init.ps1

# Or specify project directory directly:
C:\path\to\pi-memory-system\scripts\init.ps1 -ProjectDir "C:\MyProject"
```

#### macOS / Linux

```bash
git clone https://github.com/your-username/pi-memory-system.git
cd pi-memory-system

cd /path/to/your/project
bash /path/to/pi-memory-system/scripts/init.sh

# Or specify project directory:
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
- Need to look back? Use the `recall` tool on-demand

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

## Extending the System

This extension is built 100% with Pi's Extension API.
To customize behavior, study `extension/memory.ts` for patterns:

- `pi.on("before_agent_start", ...)` — inject custom context
- `pi.on("context", ...)` — control context refinement
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
│       ├── decisions.md        # 📝 Decisions template
│       └── events.md           # 📝 Events template
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
