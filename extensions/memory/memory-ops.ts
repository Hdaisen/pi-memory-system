import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS, getProjectName } from "./config";
import { safeRead, walkMarkdownFiles } from "./utils";

/**
 * Refresh _index.md by scanning all .md files in the memory directory.
 * Scans entries (## sections) from each file and builds a navigable TOC.
 */
export function refreshIndex(cwd: string, scope: "project" | "global"): void {
  const targetDir =
    scope === "global" ? PATHS.personalDir : PATHS.memoriesDir(cwd);
  if (!fs.existsSync(targetDir)) return;

  const entries: {
    relativePath: string;
    section: string;
    date?: string;
    confidence?: string;
  }[] = [];

  const files = walkMarkdownFiles(targetDir);
  for (const filePath of files) {
    const relativePath = path.relative(targetDir, filePath).replace(/\\/g, "/");
    const content = safeRead(filePath);
    if (!content) continue;

    const sections = content.split(/(?=^## )/m);
    for (const section of sections) {
      const titleMatch = section.match(/^## (.+)/m);
      if (!titleMatch) continue;
      const title = titleMatch[1].trim();

      const dateMatch = section.match(/- Date: (\d{4}-\d{2}-\d{2})/);
      const confidenceMatch = section.match(/\[(confirmed|inferred|intuition)\]/);

      entries.push({
        relativePath,
        section: title,
        date: dateMatch ? dateMatch[1] : undefined,
        confidence: confidenceMatch ? confidenceMatch[1] : undefined,
      });
    }
  }

  // Group by directory (category)
  const byCategory = new Map<string, typeof entries>();
  for (const entry of entries) {
    const dir = path.dirname(entry.relativePath);
    const cat = dir === "." ? "uncategorized" : dir;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(entry);
  }

  let index = "# Memory Index\n\n";

  // Sort: uncategorized first, then alphabetical
  const sortedCats = Array.from(byCategory.keys()).sort((a, b) => {
    if (a === "uncategorized") return -1;
    if (b === "uncategorized") return 1;
    return a.localeCompare(b);
  });

  for (const category of sortedCats) {
    const items = byCategory.get(category)!;
    const catLabel =
      category === "uncategorized"
        ? "Uncategorized"
        : category.charAt(0).toUpperCase() + category.slice(1);
    index += `## ${catLabel}\n\n`;
    for (const item of items) {
      const confidence = item.confidence ? ` | \`[${item.confidence}]\`` : "";
      const date = item.date ? ` | ${item.date}` : "";
      const fullLink = `memories/${item.relativePath}`;
      index += `- [[${fullLink}#${item.section}|${item.section}]]${date}${confidence}\n`;
    }
    index += "\n";
  }

  const indexPath = path.join(targetDir, "_index.md");
  fs.writeFileSync(indexPath, index.trim() + "\n", "utf-8");
}

/** Get a summary of the memory system state. */
export function getMemoryStatus(cwd: string): string {
  const projectDir = PATHS.projectDir(cwd);
  const memoriesDir = PATHS.memoriesDir(cwd);

  let summary = `## Memory System Status\n\n`;

  const coreExists = fs.existsSync(PATHS.corePrompt);
  const rulesExist = fs.existsSync(PATHS.rules);
  summary += `- Core Prompt: ${coreExists ? "✅" : "❌"}\n`;
  summary += `- Behavioral Rules: ${rulesExist ? "✅" : "❌"}\n`;

  const notebookExists = fs.existsSync(PATHS.notebook(cwd));
  summary += `- Session Notebook: ${notebookExists ? "✅" : "❌"}\n`;

  if (fs.existsSync(memoriesDir)) {
    const files = walkMarkdownFiles(memoriesDir);
    summary += `- Long-term Memory Files: ${files.length}\n`;
    // Group by subdirectory for tree-like display
    const tree = new Map<string, number[]>();
    for (const filePath of files) {
      const relative = path.relative(memoriesDir, filePath).replace(/\\/g, "/");
      const dir = path.dirname(relative);
      if (!tree.has(dir)) tree.set(dir, []);
      const content = safeRead(filePath);
      const entries = content ? content.split("\n## ").length - 1 : 0;
      tree.get(dir)!.push(entries);
    }
    for (const [dir, entryCounts] of tree) {
      if (dir === ".") {
        // Flat files at root
        for (const filePath of files) {
          const relative = path.relative(memoriesDir, filePath).replace(/\\/g, "/");
          if (path.dirname(relative) !== ".") continue;
          const content = safeRead(filePath);
          const entries = content ? content.split("\n## ").length - 1 : 0;
          summary += `  - ${path.basename(filePath)}: ${entries} entries\n`;
        }
      } else {
        const total = entryCounts.reduce((a, b) => a + b, 0);
        summary += `  📁 ${dir}/ — ${entryCounts.length} files, ${total} entries\n`;
        for (const filePath of files) {
          const relative = path.relative(memoriesDir, filePath).replace(/\\/g, "/");
          if (path.dirname(relative) !== dir) continue;
          const content = safeRead(filePath);
          const entries = content ? content.split("\n## ").length - 1 : 0;
          summary += `    - ${path.basename(filePath)}: ${entries} entries\n`;
        }
      }
    }
  } else {
    summary += `- Long-term Memory Directory: ❌ Not found\n`;
  }

  return summary;
}

/**
 * Ensure a project's memory directory and notebook exist.
 * Creates them with default template if missing.
 */
export function ensureProjectDir(cwd: string): void {
  const dir = PATHS.projectDir(cwd);
  if (fs.existsSync(dir)) return;

  // Create project directory and memories subdirectory
  fs.mkdirSync(PATHS.memoriesDir(cwd), { recursive: true });

  // Create turns directory
  const turnsDir = path.join(PATHS.projectDir(cwd), "turns");
  fs.mkdirSync(turnsDir, { recursive: true });

  // Create notebook.md with template
  const notebookPath = PATHS.notebook(cwd);
  const projectName = getProjectName(cwd);
  const template = `---
project: ${projectName}
last_maintenance: ${new Date().toISOString()}
---

# 会话小本本 — ${projectName}

> 由子代理自动维护。主 LLM 无需关心此文件的写入和更新。

## 当前任务

## 本阶段完成

## 待办

## 跨轮约束

## 项目常识
`;
  fs.writeFileSync(notebookPath, template, "utf-8");
}

/**
 * Read the session notebook and render a task summary widget.
 * Shows current task + pending todos in Pi's TUI below the editor.
 */
export function updateTaskWidget(cwd: string, ctx: any): void {
  const notebook = safeRead(PATHS.notebook(cwd));
  if (!notebook) return;

  const lines: string[] = [];

  // 当前任务 section
  const taskMatch = notebook.match(/^## 当前任务\r?\n([\s\S]*?)(?=\r?\n## |$)/m);
  if (taskMatch) {
    const taskLines = taskMatch[1].trim().split(/\r?\n/).filter((l: string) => l.trim() && !l.startsWith(">"));
    if (taskLines.length > 0) {
      // Show first task item
      const first = taskLines[0].replace(/^- /, "").trim();
      if (first) {
        lines.push(`📋 ${first.slice(0, 60)}`);
      }
    }
  }

  // 待办 section — count pending items
  const todoMatch = notebook.match(/^## 待办\r?\n([\s\S]*?)(?=\r?\n## |$)/m);
  if (todoMatch) {
    const pending = todoMatch[1].split(/\r?\n/).filter((l: string) => l.includes("[ ]"));
    if (pending.length > 0) {
      lines.push(`⏳ ${pending.length} pending`);
      // Show first few pending items
      for (const item of pending.slice(0, 3)) {
        const text = item.replace(/^\s*- \[ \] /, "").trim();
        if (text) lines.push(`  · ${text.slice(0, 45)}`);
      }
    }
  }

  // 跨轮约束 section
  const constraintMatch = notebook.match(/^## 跨轮约束\r?\n([\s\S]*?)(?=\r?\n## |$)/m);
  if (constraintMatch) {
    const constraints = constraintMatch[1].split(/\r?\n/).filter((l: string) => l.trim().startsWith("-"));
    if (constraints.length > 0 && lines.length < 6) {
      lines.push(`🔒 ${constraints.length} constraints`);
    }
  }

  if (lines.length > 0) {
    ctx.ui.setWidget("notebook-tasks", lines);
  }
}
