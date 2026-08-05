<div align="center">

# 🧠 Pi Memory System

### 让 Pi 拥有真正的长期记忆，像大脑一样思考、记录、进化

[![Pi Agent](https://img.shields.io/badge/Pi-0.79%2B-blue)](https://github.com/earendil-works/pi-coding-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Hdaisen/pi-memory-system/pulls)

<br>

[English](README.md)

</div>

---

## 概述

**Pi Memory System** 是 [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) 的记忆系统扩展。它赋予 AI 助手**真正类脑的记忆**——不是把整段对话塞进上下文，而是像人一样记忆：

- **保留信号、过滤噪声**——原始历史永不注入，只有分层提炼后的记忆
- **工作记忆**——最近几轮对话，以滑动窗口形式注入
- **自动固化**——后台子代理按固定节奏把对话蒸馏进长期记忆
- **手动海马体**——在你需要时，由专用清理器去重、修复记忆文件
- **上下文保持精炼**——token 用量不随对话长度增长

> **基准测试**：[299 轮 A/B 测试](docs/benchmark-report.md) 测得 **每轮 token 减少 88.6%**，上下文保持平稳；而无记忆系统时线性增长到 292K tokens。

## 运行机制

### 完整机制图

```
┌────────────────────────── 每轮循环（每一轮都执行） ──────────────────────────┐
│                                                                               │
│  用户消息                                                                      │
│    │                                                                          │
│    ▼                                                                          │
│  before_agent_start — 扩展注入（顺序固定，稳定段在前）                          │
│    1. core-prompt.md        身份与原则（稳定）                                 │
│    2. rules.md              行为规则（稳定）                                   │
│    3. Memory Index          记忆文件目录（紧凑版）                             │
│    4. dialogue-summary      最近 5 节 — 工作记忆滑动窗口                        │
│                             （每节带 → raw-<n>.md 回查链接）                   │
│    5. notebook.md           任务状态 — 仅主 LLM 维护                           │
│    6. Related               关联记忆（notebook 链接 + 自动关键词搜索）          │
│    7. 维护日志              海马体最近一次整理的位置                           │
│    │                                                                          │
│    ▼                                                                          │
│  context — 清除全部历史，只保留 system + 当前用户消息                          │
│    │                                                                          │
│    ▼                                                                          │
│  主 LLM 思考并回复（任务状态变化时顺手 edit notebook.md）                      │
│    │                                                                          │
│    ▼                                                                          │
│  agent_end — 扩展调用 python3 run_extraction.py                               │
│    ├─ raw-<n>.md             本轮完整对话备份                                  │
│    └─ dialogue-summary.md    append 一节：用户全文 + 助手全文 +                 │
│                              关键动作 + 回查链接 → raw-<n>.md                  │
│         │                                                                      │
│         └─ 节数 % 5 == 0 ? ──是──► consolidation-input.md（最后 5 节，          │
│                                    增量窗口）                                   │
│                                        └─► 固化子代理                           │
│                                            （detached 后台，用户无感）           │
│                                                └─► remember → 长期记忆          │
│         │                                                                      │
│         否 → 本轮结束（不启动任何子代理）                                       │
└───────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── 会话结束（仅一次） ─────────────────────────────┐
│  session_shutdown（quit 退出）                                                  │
│    └─ 剩余未固化节数（节数 % 5）≥ 3 ?                                           │
│            ──是──► consolidation-input.md（余数节）                              │
│                        └─► 固化子代理（detached 后台）                           │
│            否 → 什么都不做（短会话永不触发，零浪费）                              │
└───────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────── 海马体（手动） ─────────────────────────────────┐
│  你在 Pi 里输入 /memory-clean                                                    │
│    └─► 海马体子代理（前台运行，输出可见清理报告）                                  │
│          ├─ 修复格式污染（双标题、缺失元数据）                                    │
│          ├─ 合并重复条目                                                          │
│          ├─ supersede 过期 / 矛盾条目                                             │
│          └─ 报告死链与空文件 → maintenance/clean-<ts>.log                         │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 角色分工

| 角色 | 触发 | 读取 | 写入 | 明确不做 |
|:-----|:------|:-----|:-----|:---------|
| **主 LLM** | 每轮 | 注入的上下文 | `notebook.md`（独家） | 写长期记忆 |
| **固化子代理**（`memory-extractor`） | 每 5 轮 + 会话结束补跑（余数 ≥ 3） | `consolidation-input.md`（增量窗口） | 长期记忆（`remember`） | 写 notebook、清理记忆文件、读全量历史 |
| **海马体**（`memory-cleaner`） | **仅手动** `/memory-clean` | 记忆文件（`memories/`、`personal/`） | 整理后的记忆文件 + 报告 | 读对话、写 notebook、碰 `turns/` |
| **扩展** | 每轮 | 消息 | `raw-<n>.md`、`dialogue-summary.md`、`_index.md` | — |

> `notebook.md` 是主 LLM 的**独家白板**。两个子代理都只读不写——异步并发写会互相覆盖。

### 为什么用增量窗口？

固化子代理每 5 轮以**全新进程**启动，无法跨运行复用主 LLM 的 provider 端前缀缓存。因此设计上让它的输入**有界且前缀稳定**：

- 输入 = 只有**最后 5 节**（`consolidation-input.md`，扩展在启动时生成）——无论总轮数多少，成本恒定
- 子代理的 **system prompt**（来自 `memory-extractor.md`）保持稳定 → 该前缀可命中缓存
- 窗口之外的历史早已被之前的固化点蒸馏进长期记忆；子代理通过 `_index.md` + `recall` 访问，绝不重读原始文件
- `raw-<n>.md` 是**按需回查**——只有当摘要里 `→ raw-<n>.md` 链接的信息不够时，子代理才打开它

### 为什么海马体是手动的？

自动化被有意否决：如果你频繁开关短会话，每次关闭都自动跑清理器是浪费；如果你一个月不用 Pi，定时清理更是纯烧钱。所以：

- **固化**（对话 → 记忆）自动化且廉价：每 5 轮一次，加上会话结束的补跑——**只有剩余未固化轮次 ≥ 3 才触发**
- **海马体**（记忆 → 干净记忆）**手动**——想整理了就 `/memory-clean`

## 数据布局

```
~/.pi/agent/memory/
├── core-prompt.md                  # 全局身份与原则（每轮注入）
├── rules.md                        # 行为规则（每轮注入）
├── projects/<name>/
│   ├── notebook.md                 # 任务状态 — 仅主 LLM（跨会话共享）
│   ├── memories/                   # 长期记忆（项目级）
│   │   ├── _index.md               # 自动刷新的记忆目录
│   │   ├── facts.md / preferences.md
│   │   └── decisions/ events/     # 分类主题文件
│   └── turns/
│       └── sessions/<会话ID>/      # 每会话独立的短期记忆（隔离！）
│           ├── raw-<n>.md          # 每轮完整对话备份
│           ├── dialogue-summary.md # 每轮 append — 工作记忆本体
│           ├── consolidation-input.md   # 固化子代理的增量窗口
│           └── consolidation-<ts>.log   # 固化子代理输出日志
├── personal/                       # 全局（跨项目）长期记忆
└── maintenance/
    ├── clean-<ts>.log              # 海马体清理报告
    └── index.md                    # 可点击的日志索引
```

为什么每会话独立目录？**并行打开的多个 Pi 会话互不踩踏彼此的短期记忆**。长期记忆和 `notebook.md` 保持在项目级共享。

## 记忆条目格式

```markdown
## 条目标题
- **置信度**: `[confirmed|inferred|intuition]`
- **触发器**: {type} — {description}
- tags: [tag1, tag2]
- Date: YYYY-MM-DD

内容。关联: [[other-entry.md#Section]]
```

分类：`fact` / `preference` / `decision` / `event`，分别存于 `facts/`、`preferences/`、`decisions/`、`events/` 子目录。每条 decision/event **必须**标注置信度和触发器。

## 工具与命令

| 工具 | 说明 |
|:-----|:-----|
| `🧠 remember` | 存入记忆（作用域：项目/全局，支持置信度/触发器/分块） |
| `🔍 recall` | 关键词搜索记忆 + 多样性排序 |
| `↗️ supersede` | 标记旧条目为已取代（保留修正链，append-only） |
| `🗑️ forget` | ⚠️ 永久删除。优先用 supersede。 |
| `📓 notebook` | 查看/更新会话小本本 |
| `📊 memory_status` | 记忆文件状态总览 |
| `📄 convert_file` | 通过 MarkItDown (WSL) 把 PDF/DOCX 等转成 Markdown |
| `🔄 set_project` | 纠正项目名检测 |
| `/subagent-model` | 选择固化/海马体子代理的模型 |
| `/memory-clean` | **手动运行海马体**——去重、修复、supersede 记忆文件（前台输出报告） |

## 快速开始

### 前置条件

- [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) v0.79+
- Node.js 18+
- Python 3（运行 `run_extraction.py` 用）

### 安装

```bash
git clone https://github.com/Hdaisen/pi-memory-system.git
cd pi-memory-system

# 一键安装（创建目录、复制扩展 + 模板 + 脚本）
./scripts/init.sh          # Unix/macOS
.\scripts\init.ps1         # Windows (PowerShell)
```

初始化脚本会：
1. 创建 `~/.pi/agent/memory/projects/<name>/` 目录结构
2. 复制模板（`core-prompt.md`、`rules.md`、`notebook.md`、记忆条目）
3. 安装扩展到 `~/.pi/agent/extensions/`
4. 安装所需 Pi 包（`pi-subagents`、`context-mode`、`pi-mcp-adapter`）
5. 重启 Pi 或运行 `/reload`

> **提示**：如果 `pi update` 因 `my-pi-themes@latest` 失败（上游包已 unpublish），在 `settings.json` 里固定版本 `"npm:my-pi-themes@1.0.0"`。

## 设计原则

- **主 LLM = 前额叶皮层**——专注当前问题；维护 notebook；从不思考"该记什么"
- **固化子代理 = 白天的海马体**——每 5 轮回放最近 5 轮，安静地把对话写进长期记忆
- **海马体 = 夜晚的海马体**——你手动用 `/memory-clean` 唤醒它整理记忆文件
- **扩展 = 脑干**——每轮写 raw 备份 + 对话摘要、注入分层上下文、触发子代理
- **缓存友好**——注入顺序稳定段在前；子代理输入有界；注入文件无每轮时间戳噪音

## 状态指示

| 状态 | 含义 |
|:-----|:-----|
| `🧠 🟢` | 记忆系统正常 |
| `🧠 🟡` | 上下文裁剪生效中 |
| `🧠 ⏳` | 抽取运行中 |
| `🧠 🔴` | 抽取失败（查看 `turns/extraction-error.log`） |

## 子代理模型

默认子代理使用 Pi 当前默认模型。运行 `/subagent-model` 可以选更轻量的模型——固化和整理是蒸馏任务，不是代码生成。选择保存在 `~/.pi/agent/memory/subagent-model.txt`（删除该文件或选 `(default)` 恢复默认）。

## 项目结构

```
pi-memory-system/
├── extensions/
│   ├── memory.ts              # 入口（接线 hooks、tools、commands）
│   └── memory/
│       ├── config.ts          # HOME、PATHS、项目名检测
│       ├── utils.ts           # safeRead、resolveLink、readLinkedContent、lastSections/countSections
│       ├── diversity.ts       # 内容指纹、多样性排序
│       ├── markitdown.ts      # MarkItDown WSL 转换
│       ├── memory-ops.ts      # 索引刷新、维护、spawnConsolidationSubagent
│       ├── tools.ts           # 9 个工具注册
│       ├── hooks.ts           # 生命周期 hooks（session_start … session_shutdown）
│       └── commands.ts        # /subagent-model、/memory-clean
├── agents/
│   ├── memory-extractor.md    # 固化子代理提示词
│   └── memory-cleaner.md      # 海马体（手动）提示词
├── scripts/
│   ├── run_extraction.py      # 每轮管线（raw 备份 + 摘要 append + 固化触发）
│   ├── init.ps1               # Windows 安装
│   └── init.sh                # Unix/macOS 安装
├── templates/                 # init 复制的模板
├── core-prompt.md / rules.md  # 参考副本
├── docs/benchmark-report.md   # 299 轮 A/B 测试
├── LICENSE                    # MIT
├── README.md                  # English
└── README.zh-CN.md            # 本文档
```

---

<div align="center">

**Made with 🐱 by [Jason & Daisen]**

*大脑是用来思考的，不是用来记忆的。*

</div>
