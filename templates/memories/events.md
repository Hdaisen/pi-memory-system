---
type: event
updated: 2026-06-11
---

# 事件/经历 / Events & Experiences

> 记录事件发生了什么、为什么发生、学到什么。
> Record what happened, why it happened, and what was learned.
>
> 使用 `[confirmed]/[inferred]/[intuition]` 标注可靠性。
> Use `[confirmed]/[inferred]/[intuition]` to mark reliability.
>
> 📁 **新事件请按类型写入分块文件**：`events/{type}.md`
> 查看 `_index.md` 了解已有分类。无匹配时提新分类名并确认。
>
> **Write new events to typed files**: `events/{type}.md`
> Check `_index.md` for existing categories. Propose new category name for confirmation if none fits.

---

## 模板 / Template

```markdown
## 2026-01-01: [Event Title]
- **类型/Type**: `[infrastructure|design|debugging|milestone|upgrade|...]`
- **触发器/Trigger**: [type] — [description]
- **置信度/Confidence**: `[confirmed/inferred/intuition]`

_Summary of what happened._

### 关键要点 / Key Points
1. Point one
2. Point two

### 教训 / Lessons Learned
- _What did this experience teach?_
- _What would you do differently?_

### 关联 / Related
- [[decisions.md#related-decision]]
- [[facts.md#related-fact]]
```

### 如何使用 / How to Use

`remember` 工具支持 `file` 参数指定分块文件：

```markdown
// 写入 events/debugging.md
remember "Fixed X bug" category=event file=debugging

// 写入 events/design.md
remember "Architecture discussion about Y" category=event file=design

// 无匹配 → 提确认
// -> "建议新建 events/analytics.md，确认？"
```

### 常用分块 / Common Chunks

| File | Content | 内容 |
|------|---------|------|
| `events/debugging.md` | Bug fixes, debugging sessions | 调试修复 |
| `events/design.md` | Design discussions, architecture decisions | 设计讨论 |
| `events/infrastructure.md` | Infrastructure setup, config changes | 基础设施 |
| `events/upgrade.md` | System upgrades, version migrations | 升级迁移 |
| `events/process.md` | Workflow improvements, methodology | 工作流改进 |

> 🆕 新类型可以随时添加，只需用户确认即可。

### 触发器类型 / Trigger Types

| Type | Description |
|------|-------------|
| `conversation` | Discussion or suggestion during conversation |
| `instruction` | Direct user instruction |
| `debugging` | Discovery during debugging |
| `code-review` | Finding during code review |
| `refactoring` | Observation during refactoring |
| `experiment` | Result of experimental verification |
| `reading` | Discovery while reading docs/code |
| `contradiction` | Self-contradictory evidence |
| `user-feedback` | User feedback |
| `analogy` | Analogy from other projects |
| `external` | External resources (blog, paper, tutorial) |

### 作用域 / Scope

- `project`（默认）— `~/.pi/agent/memory/projects/<name>/memories/events/`，项目特有事件
- `global` — `~/.pi/agent/memory/personal/events/`，跨项目通用的经验/教训
- **双重记录**：项目特有的调试经历可能提炼出通用技术经验——项目细节存 project，通用的教训存 global
