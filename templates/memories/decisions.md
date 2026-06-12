---
type: decision
updated: 2026-06-11
---

# 设计决策 / Design Decisions

> 每条决策记录当前认知。当新证据出现时，用 supersede 标记旧条目，而非覆盖或删除。
> Each entry captures current understanding. When new evidence emerges, use supersede to mark old entries — don't overwrite or delete.
>
> 使用 `[confirmed]/[inferred]/[intuition]` 标注置信度。
> Use `[confirmed]/[inferred]/[intuition]` for confidence levels.
>
> 📁 **新决策请按话题写入分块文件**：`decisions/{topic}.md`
> 查看 `_index.md` 了解已有分类。无匹配时提新话题名并确认。
>
> **Write new decisions to topic files**: `decisions/{topic}.md`
> Check `_index.md` for existing categories. Propose new topic name for confirmation if none fits.

---

## 模板 / Template

```markdown
## [Decision Title]
- **时间/Date**: 2026-01-01
- **置信度/Confidence**: `[confirmed] — [evidence/reason]`
- **触发器/Trigger**: [type] — [what caused this decision]
- **决策/Decision**: [What was decided]
- **原因/Reason**: [Why this was the right choice]
- **被否决/Rejected Alternatives**: [What was considered but not chosen, and why]
- **翻转条件/Falsification Condition**: [Optional: what evidence would overturn this?]
- **参见/See also**: [[related-file.md#section]]
```

### 如何使用 / How to Use

`remember` 工具支持 `file` 参数指定分块文件：

```markdown
// 写入 decisions/architecture.md
remember "Choose React over Vue" category=decision file=architecture

// 写入 decisions/tools.md
remember "Adopt pnpm as package manager" category=decision file=tools

// 无匹配 → 提确认
// -> "建议新建 decisions/analytics.md，确认？"
```

### 常用分块 / Common Chunks

| File | Content | 内容 |
|------|---------|------|
| `decisions/architecture.md` | Architecture decisions, design patterns | 架构决策 |
| `decisions/tools.md` | Tool/library choices | 工具选择 |
| `decisions/process.md` | Workflow/methodology decisions | 流程决策 |

> 🆕 新话题可以随时添加，只需用户确认即可。

### 置信度等级 / Confidence Levels

| Tag | Meaning | When to Use |
|-----|---------|-------------|
| `[confirmed]` | Verified with evidence | Code that ran, facts proven, events that happened |
| `[inferred]` | Reasonable deduction | Architecture decisions, root cause analysis |
| `[intuition]` | Gut feeling, no direct evidence | Early exploration, risk sensing |

### 翻转条件 / Falsification Conditions

- **经验决策**（基于事实/实验）— 必须声明翻转条件
- **偏好决策**（主观/实用主义）— 翻转条件可选，但应记录权衡点和替代方案
- 翻转条件本身可以附带置信度

### Supersede 协议 / Supersede Protocol

**核心原则**：保留修正链，不销毁证据。

- **语义修正**（推理错误、结论改变）必须用 supersede（旧条目标注 "↗ Superseded by [[新条目]]"，然后追加新条目）
- **非语义修正**（错别字、死链、格式化）可以直接编辑，但保留简短日志
- `forget` 仅限测试数据、重复条目、明显噪音。其他场景优先用 supersede

### 作用域 / Scope

- `project`（默认）— `~/.pi/agent/memory/projects/<name>/memories/decisions/`，项目特有的架构决策、代码事实
- `global` — `~/.pi/agent/memory/personal/decisions/`，跨项目通用的技术知识/方法论
- **双重记录**：一条信息可以同时写两个作用域（项目细节存 project，通用经验存 global）
