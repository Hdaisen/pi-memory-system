# 【开源分享】给 AI 编码助手装上"永久记忆"——Pi Memory System

> 用 AI 写代码最烦的是什么？不是它写得不好，而是**每次开新对话它就失忆了**。

---

## 痛点：上下文窗口的诅咒

用 Cursor、Copilot、Claude Code 这些工具写项目，你一定经历过：

- 🔁 第 1 轮对话教它项目架构，第 2 轮它全忘了
- 📝 每次都要重复"这个变量是干嘛的""那个接口是哪个模块的"
- 🧠 上下文窗口满了就开始"失忆"，前面讨论的设计决策凭空消失
- 📋 你不得不用 CLAUDE.md / .cursorrules 手动维护上下文，但这些文件不会自己更新

**本质上，AI 编码助手没有"经验积累"这个概念。每次对话都是从零开始。**

---

## 解法：Pi Memory System

这是一个给 [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent)（开源 AI 编码助手）开发的记忆扩展。

**核心理念**：AI 的大脑应该用来思考，不是用来记忆。记忆交给专门的系统管理。

### 三层记忆架构

```
┌─────────────────────────────────────────────┐
│  核心提示词 (core-prompt.md)                 │  ← 身份、原则、思维框架
├─────────────────────────────────────────────┤
│  会话小本本 (notebook.md)                    │  ← 当前任务、待办、约束
├─────────────────────────────────────────────┤
│  长期记忆 (memories/*.md + personal/*.md)    │  ← 跨会话知识沉淀
└─────────────────────────────────────────────┘
```

### 工作原理

```
每轮对话结束
    ↓
子代理读取原始对话
    ↓
提炼关键信息 → 写入 essence.md（下轮接力棒）
    ↓
更新会话小本本 → notebook.md
    ↓
沉淀长期记忆 → memories/*.md（调用 remember 工具）
```

**主脑永远不看原始对话历史**，只看子代理提炼的精华。这样：
- 上下文窗口不会被历史对话撑爆
- 重要信息不会被遗忘
- 记忆会自动整理、去重、更新

### 9 个记忆工具

| 工具 | 作用 |
|------|------|
| `remember` | 写入长期记忆（支持置信度、标签、作用域） |
| `recall` | 搜索记忆（关键词 + 多样性排序） |
| `forget` | 删除记忆（慎用） |
| `supersede` | 标记旧记忆为"已过时"，保留修正链 |
| `notebook` | 查看/更新会话小本本 |
| `memory_status` | 查看记忆系统状态概览 |
| `convert_file` | 二进制文件转 Markdown（PDF/DOCX 等） |
| `confirm` | 交互式确认提示 |
| `set_project` | 修正项目名称检测 |

### 实际效果

我用这个系统维护 pi-memory-system 项目本身。现在：

- ✅ 说一次"Git 要用分支 + PR 流程"，它永远记得
- ✅ 说一次"WSL 路径要自动转换"，它不再反复犯错
- ✅ 项目架构、设计决策、代码规范全部自动维护
- ✅ 跨会话对话无缝衔接，就像有一个真正了解项目的同事

---

## 快速开始

### 1. 安装 Pi Coding Agent

```bash
npm install -g @earendil-works/pi-coding-agent
```

### 2. 一键初始化记忆系统

**Windows (PowerShell)：**
```powershell
git clone https://github.com/Hdaisen/pi-memory-system.git
cd pi-memory-system
.\scripts\init.ps1
```

**macOS / Linux：**
```bash
git clone https://github.com/Hdaisen/pi-memory-system.git
cd pi-memory-system
chmod +x scripts/init.sh
./scripts/init.sh
```

### 3. 配置你的 AI 提供商

```bash
pi --configure
```

按照提示添加 OpenAI、Anthropic 或其他提供商的 API Key。

### 4. 开始使用

```bash
pi
```

就这样。你的 AI 助手现在有记忆了。

---

## 项目结构

```
~/.pi/agent/
├── extensions/memory.ts          # 记忆扩展入口
├── extensions/memory/            # 核心模块
├── agents/memory-extractor.md    # 子代理提示词
├── scripts/run_extraction.py     # 记忆提取脚本
└── memory/
    ├── core-prompt.md            # 核心提示词
    ├── rules.md                  # 行为规则
    ├── projects/<name>/          # 项目记忆
    │   ├── notebook.md           # 会话小本本
    │   ├── memories/             # 长期记忆
    │   └── turns/                # 对话提炼
    └── personal/                 # 跨项目通用记忆
```

---

## 为什么选择 Pi？

- **开源免费**：MIT 许可，代码完全公开
- **不绑定 LLM**：支持 OpenAI、Anthropic、Ollama 等任何提供商
- **本地优先**：记忆存在本地 Markdown 文件，不上传云端
- **可扩展**：基于 Pi 的 Extension 机制，可以自定义工具和钩子

---

## 相关链接

- **Pi Coding Agent**: https://github.com/earendil-works/pi-coding-agent
- **Pi Memory System**: https://github.com/Hdaisen/pi-memory-system

---

> 💡 如果你也在用 AI 写代码，试试给它装上记忆。你会发现，AI 助手从"工具"变成了"同事"。

**欢迎 Star、Fork、Issue！有什么问题评论区见 👇**

#AI编程 #开源 #效率工具 #Cursor #Copilot #编程助手
