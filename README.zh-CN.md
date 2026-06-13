<div align="center">

# 🧠 Pi Memory System

### 让 Pi 拥有真正的长期记忆，像大脑一样思考、记录、进化

[![Pi Agent](https://img.shields.io/badge/Pi-0.79%2B-blue)](https://github.com/earendil-works/pi-coding-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Hdaisen/pi-memory-system/pulls)

</div>

---

## 概述

**Pi Memory System** 是 [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) 的记忆系统扩展。它赋予 AI 助手**真正类脑的记忆**——不是把整段对话塞进上下文，而是像人一样记忆：

- **保留信号**，过滤噪声
- **自动关联**知识形成网络
- **分层管理**：身份恒定、任务动态、知识积累
- **保持上下文精炼**——不被历史拖垮

### 核心理念

> **"大脑是用来思考的，不是用来记忆的。"**
>
> 主 LLM 永远不接触原始对话历史。每轮对话结束后，专用子代理（memory-extractor）将本轮对话提炼为精华 + 长期记忆。就像**小脑负责走路**，**大脑皮层负责思考**。

### 架构

```
用户发送消息 → before_agent_start 注入上下文
  ├─ core-prompt + rules
  ├─ notebook.md（子代理维护）
  ├─ essence.md（上轮接力棒）
  └─ 关联记忆（[[Wiki-links]]）

→ context 清除所有历史，仅保留 system + 当前用户消息

→ 主 LLM 思考 & 回复（不做记忆维护）

→ agent_end（扩展 → Python → 子代理）
  1. 管道传 JSON → python3 run_extraction.py
     ├─ 格式化 → turns/raw.md（过滤 system/read）
     └─ spawn pi -p (memory-extractor)
        ├─ 写 essence.md（下轮接力棒）
        ├─ 更新 notebook.md
        └─ 调 remember() → 长期记忆
  2. 状态栏：🧠 🟢 / 🟡 / 🔴
```

### 三层架构

| 层级 | 文件 | 维护者 |
|:------|:-----|:-----------|
| 🏛️ **核心提示词** | `~/.pi/agent/memory/core-prompt.md` | 扩展自动维护 |
| 📓 **会话小本本** | `~/.pi/agent/memory/projects/<name>/notebook.md` | 子代理自动维护 |
| 🗄️ **长期记忆** | `~/.pi/agent/memory/projects/<name>/memories/`（项目）<br>`~/.pi/agent/memory/personal/`（全局） | 子代理通过 `remember` 写入 |

### 核心设计：子代理蒸馏

主 LLM **从不执行记忆维护**。每轮对话结束后：

1. **扩展**（TypeScript）：将原始对话 dump 到 `turns/raw/messages.json`
2. **Python 脚本**（`run_extraction.py`）：过滤噪声（system 提示词、read 结果），格式化为 Markdown，保存到 `turns/raw.md`
3. **子代理**（spawn 的 Pi 进程）：读 `raw.md`，写 `essence.md`（下一轮接力棒），更新 `notebook.md`，调 `remember()` 存入长期记忆

这模拟了人脑的睡眠巩固机制——海马体（子代理）回放巩固，而皮层（主 LLM）休息。

### 上下文策略

主 LLM 每轮接收的上下文**不包含任何原始对话历史**。每轮：
- `essence.md`（~500B）— 上轮子代理蒸馏的关键信息
- `notebook.md`（~500B）— 会话状态
- core-prompt + rules + 关联记忆

所有用户/助手/工具消息由 `context` 事件自动清除。

## 工具

| 工具 | 说明 |
|:-----|:-------------|
| `🧠 remember` | 存入记忆，自动分类，支持置信度/触发器/分块 |
| `🔍 recall` | 搜索记忆，支持按置信度过滤 |
| `↗️ supersede` | 标记旧条目已被取代（保留修正链） |
| `🗑️ forget` | ⚠️ 删除。优先用 supersede。 |
| `📓 notebook` | 查看/更新会话小本本 |
| `📊 memory_status` | 查看记忆系统状态概览 |

## 快速开始

### 前提

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+
- Python 3（用于 `run_extraction.py`）

### 安装

```bash
# 克隆仓库
git clone https://github.com/Hdaisen/pi-memory-system.git

# 复制扩展文件
cp pi-memory-system/extensions/memory.ts ~/.pi/agent/extensions/memory.ts

# 复制脚本
cp pi-memory-system/scripts/*.py ~/.pi/agent/scripts/

# 复制子代理定义
mkdir -p ~/.pi/agent/agents
cp pi-memory-system/agents/memory-extractor.md ~/.pi/agent/agents/

# 复制提示词和规则
cp pi-memory-system/core-prompt.md ~/.pi/agent/memory/core-prompt.md
cp pi-memory-system/rules.md ~/.pi/agent/memory/rules.md
```

然后重启 Pi 或运行 `/reload`。

## 设计原则

### 为什么用子代理？

- **主 LLM** = 前额叶皮层：专注解决当前问题
- **子代理** = 海马体：在后台巩固记忆
- **扩展** = 脑干：处理常规机械任务

主 LLM 永远不需要思考"该记什么"——一切都是自动的。

### 置信度标注

每个决策和事件条目必须标注：

| 标注 | 含义 |
|:----|:--------|
| `[confirmed]` | 已验证（有明确证据） |
| `[inferred]` | 推理得出（基于已有信息的合理推断） |
| `[intuition]` | 直觉/预感（无直接证据） |

### 记忆分块

```
memories/
├── _index.md              ← 自动生成的索引（每轮刷新）
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

### 作用域规则

| 作用域 | 存储位置 | 判断标准 |
|:------|:---------|:----------|
| `project`（默认） | `~/.pi/agent/memory/projects/<name>/memories/` | 仅本项目有用 |
| `global` | `~/.pi/agent/memory/personal/` | 跨项目通用 |

## 项目结构

```
pi-memory-system/
├── extensions/
│   └── memory.ts            # 核心扩展（钩子 + 工具）
├── agents/
│   └── memory-extractor.md  # 子代理定义
├── scripts/
│   ├── run_extraction.py    # 主管线（格式化 + 子代理启动）
│   └── write_raw.py         # JSON→MD 格式化（stdin/文件/JSONL）
├── templates/               # 模板文件
├── example/                 # 示例项目
├── core-prompt.md           # 参考核心提示词
├── rules.md                 # 行为规则
├── LICENSE                  # MIT
├── README.md                # 英文文档
└── README.zh-CN.md          # 中文文档
```

---

<div align="center">

**Made with 🐱 by [Jason & Daisen]**

*Brains are for thinking, not for remembering.*

</div>
