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
  ├─ turn-summary.md（主脑上轮回复）
  ├─ essence.md（子代理提炼的接力棒）
  └─ 关联记忆（[[Wiki-links]]）

→ context 清除所有历史，仅保留 system + 当前用户消息

→ 主 LLM 思考 & 回复（不做记忆维护）

→ agent_end（扩展 → Python → 子代理）
  1. 写 turn-summary.md（主脑上轮逐字回复）
  2. 管道传 JSON → python3 run_extraction.py
     ├─ 格式化 → turns/raw.md（过滤 system/read）
     └─ spawn pi -p (memory-extractor)
        ├─ 写 essence.md（下轮接力棒）
        ├─ 更新 notebook.md
        └─ 调 remember() → 长期记忆
  3. 异常时 → 写入 turns/extraction-error.log
  4. 状态栏：🧠 🟢 / 🟡 / ⏳ / 🔴
```

### 三层架构

| 层级 | 文件 | 维护者 |
|:------|:-----|:-----------|
| 🏛️ **核心提示词** | `~/.pi/agent/memory/core-prompt.md` | 扩展自动维护 |
| 📓 **会话小本本** | `~/.pi/agent/memory/projects/<name>/notebook.md` | 子代理自动维护 |
| 🔄 **轮次摘要** | `~/.pi/agent/memory/projects/<name>/turns/turn-summary.md` | 扩展自动维护 |
| 🔗 **接力棒** | `~/.pi/agent/memory/projects/<name>/turns/essence.md` | 子代理自动维护 |
| 📝 **原始存档** | `~/.pi/agent/memory/projects/<name>/turns/raw.md` | Python 自动维护 |
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

### 为什么使用这个系统？

| 使用场景 | 收益 |
|----------|------|
| **上下文窗口小的本地模型** | 上下文固定在 ~17K tokens，32K 模型可以无限轮次运行 |
| **缓存命中率低的模型** | 每轮 token 减少 88%，本地模型无 API 缓存机制，直接加速推理 |
| **需要保持 LLM 专注度的项目** | LLM 只看到提炼后的精华，不被原始对话历史干扰 |
| **长时间运行的会话** | 第 1 轮到第 1000 轮性能一致，不会因上下文膨胀而退化 |

> **基准测试**：[299 轮 A/B 测试](docs/benchmark-report.md) 显示每轮 token 减少 **88%**，性能保持一致。

### 未来方向

1. **优化记忆存储与提取** — 提高子代理提炼质量，减少信息丢失
2. **记忆衰退机制** — 模拟人脑遗忘曲线，自动淡忘不常用的记忆，保持记忆库精炼

## 工具与命令

| 工具 | 说明 |
|:-----|:-------------|
| `🧠 remember` | 存入记忆，自动分类，支持置信度/触发器/分块 |
| `🔍 recall` | 搜索记忆，支持按置信度过滤 |
| `↗️ supersede` | 标记旧条目已被取代（保留修正链） |
| `🗑️ forget` | ⚠️ 删除。优先用 supersede。 |
| `📓 notebook` | 查看/更新会话小本本 |
| `📊 memory_status` | 查看记忆系统状态概览 |
| `📄 convert_file` | 将二进制文件（PDF、DOCX 等）通过 MarkItDown（WSL）转为 Markdown |
| `🔄 set_project` | 修正项目名检测 |
| `/subagent-model` | 选择子代理使用的模型 |

## 状态指示器

扩展在 Pi 底部显示记忆系统状态：

| 状态 | 含义 |
|:-------|:--------|
| `🧠 🟢` | 记忆系统正常 |
| `🧠 🟡` | 上下文裁剪中 |
| `🧠 ⏳` | 提取运行中 |
| `🧠 🔴` | 提取失败（查看 `turns/extraction-error.log`） |

### 调试提取错误

当看到 `🧠 🔴` 时，检查错误日志：

```bash
cat ~/.pi/agent/memory/projects/<name>/turns/extraction-error.log
```

常见原因：
- `pi` 不在 PATH 中（子代理启动失败）
- Python 脚本超时（>360s）
- 子代理进程崩溃

## 快速开始

### 前提

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+
- Python 3（用于 `run_extraction.py`）

### 必需的 Pi 包

记忆系统依赖以下 Pi 包（`init.sh`/`init.ps1` 会自动安装）：

| 包名 | 用途 |
|:--------|:--------|
| `pi-subagents` | 核心依赖 — 驱动 memory-extractor 子代理 |
| `context-mode` | 上下文管理 — 处理历史裁剪和上下文优化 |
| `pi-mcp-adapter` | MCP 适配器 — 为子代理提供工具集成 |

如需手动安装：
```bash
pi install npm:pi-subagents
pi install npm:context-mode
pi install npm:pi-mcp-adapter
```

### 安装

```bash
# 克隆仓库
git clone https://github.com/Hdaisen/pi-memory-system.git
cd pi-memory-system

# 一键安装（创建目录、复制扩展 + 模板 + 脚本）
./scripts/init.sh

# 或在 Windows（PowerShell）：
.\scripts\init.ps1
```

init 脚本会：
1. 创建 `~/.pi/agent/memory/projects/<name>/` 目录结构
2. 复制模板文件（小本本、记忆条目模板）
3. 安装扩展（`memory.ts` + `memory/` 模块）到 `~/.pi/agent/extensions/`
4. 安装必需的 Pi 包（`pi-subagents`、`context-mode`、`pi-mcp-adapter`）
5. 设置全局 `core-prompt.md` 和 `rules.md`（仅首次）

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

## 子代理模型

默认情况下，子代理使用 Pi 当前的默认模型。使用 `/subagent-model` 可以选择更轻量的模型（子代理只做知识蒸馏，不写代码）。

```bash
# 在 Pi 终端中：
/subagent-model
# → 从 mimo-v2.5, claude-sonnet, gpt-4o, gemini-flash 等中选择
```

选择保存在 `~/.pi/agent/memory/subagent-model.txt`。删除文件或选择 `(default)` 可重置。

## 项目结构

```
pi-memory-system/
├── extensions/
│   ├── memory.ts              # 入口文件（串联钩子、工具、命令）
│   ├── auto.ts                # Spec/任务自动化（基于 pi-subagents + 记忆系统）
│   ├── ocr.ts                 # OCR 工具，用于图片/PDF 文本提取
│   └── memory/
│       ├── config.ts          # HOME、PATHS、项目名检测
│       ├── utils.ts           # safeRead、extractLinks、resolveLink、walkMarkdownFiles
│       ├── diversity.ts       # 内容指纹、多样性排序
│       ├── markitdown.ts      # 二进制文件检测、MarkItDown WSL 转换
│       ├── memory-ops.ts      # refreshIndex、getMemoryStatus、ensureProjectDir
│       ├── tools.ts           # 9 个工具注册（remember、recall 等）
│       ├── hooks.ts           # 7 个生命周期钩子（before_agent_start、agent_end 等）
│       └── commands.ts        # /subagent-model 命令
├── agents/
│   └── memory-extractor.md    # 子代理定义
├── scripts/
│   ├── run_extraction.py      # 主管线（格式化 + 子代理启动）
│   ├── init.ps1               # Windows 安装脚本
│   └── init.sh                # Unix/macOS 安装脚本
├── templates/                 # 安装用模板文件
├── core-prompt.md             # 参考核心提示词
├── rules.md                   # 行为规则
├── LICENSE                    # MIT
├── README.md                  # 英文文档
└── README.zh-CN.md            # 中文文档
```

---

<div align="center">

**Made with 🐱 by [Jason & Daisen]**

*Brains are for thinking, not for remembering.*

</div>
