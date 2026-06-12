<div align="center">

# 🧠 Pi Memory System

### 让 Pi 拥有真正的长期记忆，像大脑一样思考、记录、进化

[![Pi Agent](https://img.shields.io/badge/Pi-0.79%2B-blue)](https://github.com/earendil-works/pi-coding-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Hdaisen/pi-memory-system/pulls)

<br>

**🇨🇳 [中文](#chinese) &nbsp;|&nbsp; 🇬🇧 [English](#english)**

</div>

---

<br>

<a name="chinese"></a>

# 🇨🇳 中文文档

## 概述

**Pi Memory System** 是一个为 [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) 设计的记忆系统扩展。它让 AI 助手拥有**真正的大脑式记忆**——不是把整个对话塞进上下文，而是像人脑一样：

- **记住关键信息**，过滤冗余
- **自动关联**知识点，形成知识网络
- **分层管理**：身份恒常、任务动态、知识累积
- **上下文永远精炼**，不被历史拖垮

### 核心哲学

> **"大脑是用来思考的，不是用来记忆的。"**
>
> 每次 LLM 调用只保留最近 3 轮对话。旧消息被过滤——但它们的价值已提炼到记忆文件中。这不是缺陷，是特性。

### 三层架构

| 层级 | 文件 | 作用 |
|------|------|------|
| 🏛️ **核心提示词** | `~/.pi/agent/memory/core-prompt.md` | 身份、原则、行为框架 |
| 📓 **会话小本本** | `.pi/memory/notebook.md`（每项目） | 当前任务、进度、活跃上下文 |
| 🗄️ **长期记忆** | `.pi/memory/memories/`（项目）<br>`~/.pi/agent/memory/personal/`（全局） | 事实、偏好、决策、事件 |

## 工作流程

```
你发送消息
    ↓
before_agent_start ── 自动注入：
  ├─ 核心提示词（你是谁 + 记忆协议）
  ├─ 会话小本本（当前任务 + 上下文）
  └─ [[链接]] 选择性读取关联记忆
    ↓
context ── 每次 LLM 调用前触发：
  └─ 精炼：仅在用户发新消息时执行
     保留最近 3 轮 + 所有 system 消息
     旧消息 → 关键信息已沉淀到记忆中
    ↓
LLM 思考 & 回复（含置信度标注）
    ↓
agent_end ── 自动提炼记忆：
  ├─ 更新小本本（进度、新决策）
  ├─ 写入长期记忆（project / global）
  ├─ 标注置信度 / 触发器 / 翻转条件
  └─ 更新核心提示词（身份变化时）
```

## 内置工具（6 个）

| 工具 | 说明 |
|------|------|
| `🧠 remember` | 存入长期记忆，自动分类，支持置信度/触发器/分块存储 |
| `🔍 recall` | 搜索记忆，支持按置信度过滤 |
| `↗️ supersede` | 标记旧条目被取代，保留修正链 |
| `🗑️ forget` | ⚠️ 删除记忆，优先用 supersede |
| `📓 notebook` | 查看/更新会话小本本 |
| `📊 memory_status` | 记忆系统文件状态概览 |

## 快速开始

### 前置要求

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+

### 一键初始化

#### Windows (PowerShell)
```powershell
git clone https://github.com/Hdaisen/pi-memory-system.git
cd C:\YourProject
C:\path\to\pi-memory-system\scripts\init.ps1
# 或指定目录：init.ps1 -ProjectDir "C:\MyProject"
```

#### macOS / Linux
```bash
git clone https://github.com/Hdaisen/pi-memory-system.git
cd /path/to/your/project
bash /path/to/pi-memory-system/scripts/init.sh
# 或指定目录：init.sh /path/to/your/project
```

### 手动安装

**1. 安装扩展**
```
复制 extension/memory.ts → ~/.pi/agent/extensions/memory.ts
```

**2. 创建全局记忆**
```
~/.pi/agent/memory/
├── core-prompt.md          # 复制 templates/core-prompt.md 并自定义
└── personal/
    ├── facts.md
    ├── preferences.md
    ├── decisions.md
    └── events.md
```

**3. 项目初始化**
```
your-project/.pi/memory/
├── notebook.md             # 复制 templates/notebook.md
└── memories/
    ├── _index.md
    ├── facts.md
    ├── preferences.md
    ├── decisions.md
    └── events.md
```

### 核心提示词配置

编辑 `~/.pi/agent/memory/core-prompt.md`：
```markdown
## Identity
- **I am**: [你的 AI 名字]，[人设描述]
- **User**: [你的名字]，我的伙伴
- **Core Belief**: "大脑用来思考，不是用来记忆。"
```

> ⚠️ 写好它，系统自动运转。之后重启 Pi 或执行 `reload`。

## 设计原理

### 为什么用 Markdown + [[双向链接]]？

- LLM 原生擅长读写 Markdown，零格式转换
- **JSON 是错误的方向**——LLM 操作 JSON 需要精确逗号引号，极易出错
- **Obsidian 兼容**：可视化你的记忆知识图谱
- [[双向链接]]模拟大脑联想网络，而非死板树状分类

### 为什么三层分离？

| 层级 | 变化频率 | 内容 | 策略 |
|------|----------|------|------|
| 核心提示词 | 几乎不变 | 身份、原则 | 手动维护 |
| 小本本 | 每次对话 | 任务、上下文 | 自动更新 |
| 长期记忆 | 逐步累积 | 知识、决策 | 分块存储 |

### 置信度标注

防止 LLM 把推测伪装成事实——每条决策和事件记录必须标注：

| 标注 | 含义 |
|------|------|
| `[confirmed]` | 已验证，有明确证据 |
| `[inferred]` | 推理得出，未直接验证 |
| `[intuition]` | 直觉/预感，无直接证据 |

### 翻转条件（Falsification）

- **经验决策**（基于事实/实验）→ 必须声明：什么证据出现时会被推翻？
- **偏好决策**（主观/实用）→ 可选，但应记录权衡点和替代方案

### Supersede — 保留修正链

- 语义修正（推理错误、结论改变）→ 标记旧条目 `↗ Superseded by [[新条目]]`，追加新条目
- 非语义修正（错别字、死链）→ 直接编辑
- **forget 仅限** 测试数据、重复条目、明显噪音

### 记忆分块

```
memories/
├── _index.md              ← 自动索引
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

- `remember` 工具的 `file` 参数指定分块文件
- 新话题无匹配时 → LLM 提出文件名，经用户确认后新增

### 记忆作用域

| 作用域 | 存储位置 | 判断标准 |
|--------|----------|----------|
| `project` | `.pi/memory/memories/` | 仅本项目有用 |
| `global` | `~/.pi/agent/memory/personal/` | 换项目还有用 |

一条信息可以同时写两个作用域。

## 致谢

本项目深受 **[Epistemic Trace](https://github.com/yumenana/epistemic-trace)** 启发。Epistemic Trace 提出的 **认知追踪**、**置信度标注** 和 **翻转条件** 概念直接影响了本系统的设计与演进。

同时我们做了关键区分：

- ❌ 不做 L0/L1 压缩（LLM 压缩有确认偏误风险）
- ❌ 不设独立 failures.md（事件标签化更灵活）
- ✅ 翻转条件可选，区分经验决策与偏好决策
- ✅ 引入编码场景特有的 Trigger 类型（debugging, code-review, refactoring）

**深切感谢 Epistemic Trace 项目的贡献。** 🙌

## 扩展开发

本系统 100% 使用 Pi 的 Extension API 构建。参考 `extension/memory.ts`：

- `pi.on("before_agent_start", ...)` — 注入上下文
- `pi.on("context", ...)` — 上下文精炼策略（含 mid-turn 保护）
- `pi.registerTool(...)` — 注册工具
- `pi.on("agent_end", ...)` — 后处理

## 项目结构

```
pi-memory-system/
├── extension/memory.ts      # Pi 扩展（核心逻辑）
├── templates/               # 模板文件
├── example/                 # 示例项目
├── scripts/                 # 初始化脚本
├── LICENSE                  # MIT
└── README.md
```

---

<br>

<a name="english"></a>

# 🇬🇧 English

## Overview

**Pi Memory System** is a memory extension for [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent). It gives your AI assistant **true brain-like memory** — filtering noise, linking knowledge, keeping context clean.

> **"Brains are for thinking, not for remembering."**

### Three-Layer Architecture

| Layer | File | Purpose |
|-------|------|---------|
| 🏛️ **Core Prompt** | `~/.pi/agent/memory/core-prompt.md` | Identity, principles |
| 📓 **Notebook** | `.pi/memory/notebook.md` (per project) | Tasks, progress, context |
| 🗄️ **Memory** | `.pi/memory/memories/` (project)<br>`~/.pi/agent/memory/personal/` (global) | Facts, preferences, decisions, events |

## Tools (6)

| Tool | Description |
|------|-------------|
| `🧠 remember` | Store to memory, auto-classify, with confidence/trigger/chunking |
| `🔍 recall` | Search memory, filter by confidence |
| `↗️ supersede` | Mark old entry as superseded (keep correction chain) |
| `🗑️ forget` | ⚠️ Delete. Prefer supersede |
| `📓 notebook` | View/update the session notebook |
| `📊 memory_status` | View memory file status overview |
| `📄 convert_file` | Convert binary files (PDF/DOCX/etc.) to Markdown (requires WSL + MarkItDown) |
| `📦 ccr_retrieve` | Recover original content after auto-compression |

## Quick Start

```bash
git clone https://github.com/Hdaisen/pi-memory-system.git
# Run the init script from your project directory:
bash /path/to/pi-memory-system/scripts/init.sh
# Or manually:
# cp extension/memory.ts ~/.pi/agent/extensions/memory.ts
# cp extension/compress.ts ~/.pi/agent/extensions/compress.ts
```
Then customize `~/.pi/agent/memory/core-prompt.md` and restart Pi.

See [中文版](#chinese) above for detailed installation.

## Design Highlights

- **Markdown + [[Wiki-links]]** → LLM-native, zero conversion
- **Confidence tags**: `[confirmed]` / `[inferred]` / `[intuition]`
- **Falsification conditions**: what evidence would overturn a decision?
- **Supersede**: keep correction chain, don't destroy evidence
- **Chunked storage**: memory organized by type/topic
- **Scope rules**: `project` vs `global`, with dual recording

## Acknowledgements

Deeply inspired by **[Epistemic Trace](https://github.com/yumenana/epistemic-trace)** — specifically its concepts of **cognitive tracing**, **confidence tagging**, and **falsification conditions**.

Key distinctions we made:
- ❌ No L0/L1 compression (risks confirmation bias)
- ❌ No standalone failures.md (tag-based in events.md)
- ✅ Optional falsification conditions, separating empirical from preference
- ✅ Coding-specific triggers (debugging, code-review, refactoring)

**Grateful for the Epistemic Trace project.** 🙌

## Project Structure

```
pi-memory-system/
├── extension/
│   ├── memory.ts            # Core Pi extension
│   └── compress.ts          # Content compression module (imported by memory.ts)
├── templates/               # Core prompt & memory templates
├── example/                 # Example project
├── scripts/                 # Setup scripts
├── LICENSE                  # MIT
└── README.md
```

---

<div align="center">

**Made with 🐱 by [Jason & Daisen]**

*Brains are for thinking, not for remembering.*

</div>
