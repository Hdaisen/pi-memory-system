import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { HOME, PATHS, getProjectName } from "./config";
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

// ============================================================
// Memory maintenance (海马体) — 会话结束自动整理长期记忆
// ============================================================

export const MAINTENANCE_DIR = path.join(HOME, ".pi", "agent", "memory", "maintenance");
const LAST_RUN_FILE = path.join(MAINTENANCE_DIR, "last-run.json");
const MAINTENANCE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 每 12 小时最多一次

export function getLastMaintenance():
  | { lastRun?: string; logFile?: string; project?: string }
  | null {
  try {
    return JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf-8"));
  } catch {
    return null;
  }
}

/** True when no maintenance ran within the interval. */
export function shouldRunMaintenance(): boolean {
  const last = getLastMaintenance();
  if (!last?.lastRun) return true;
  return Date.now() - new Date(last.lastRun).getTime() >= MAINTENANCE_INTERVAL_MS;
}

/**
 * Spawn a detached memory-maintenance subagent (pi -p + memory-cleaner.md).
 * The subagent's output is appended to maintenance/clean-<ts>.log via file
 * stdio, so it keeps writing after the parent pi process exits (detached +
 * unref). Session end is never blocked by maintenance.
 */
export function runMemoryMaintenance(cwd: string, sessionDir?: string | null): void {
  const cleanerPrompt = path.join(HOME, ".pi", "agent", "agents", "memory-cleaner.md");
  if (!fs.existsSync(cleanerPrompt)) return;
  fs.mkdirSync(MAINTENANCE_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(MAINTENANCE_DIR, `clean-${ts}.log`);
  const logFd = fs.openSync(logPath, "a");
  fs.writeSync(
    logFd,
    `# Memory Maintenance — ${new Date().toISOString()}\nproject: ${getProjectName(cwd)}\n\n`,
  );

  let model = "";
  try {
    model = fs
      .readFileSync(path.join(HOME, ".pi", "agent", "memory", "subagent-model.txt"), "utf-8")
      .trim();
  } catch { /* default model */ }

  let cmd = `pi -p --no-session --tools read,write,edit,remember,recall,notebook,forget,supersede`;
  if (model && model !== "(default)") cmd += ` --model "${model}"`;
  cmd += ` --append-system-prompt "${cleanerPrompt}"`;

  const prompt =
    "自动记忆维护（海马体整理）。扫描当前项目的长期记忆（memories/）与全局记忆（personal/），" +
    "修复格式污染、合并重复条目、supersede 过期/矛盾条目、报告死链与空文件。输出清理报告。";

  const workDir = sessionDir || PATHS.projectDir(cwd);

  try {
    const child = spawn(cmd, {
      shell: true,
      cwd: workDir,
      env: { ...process.env, PI_SUBAGENT: "1", PI_SESSION_DIR: sessionDir ?? "" },
      stdio: ["pipe", logFd, logFd],
      detached: true,
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
    child.unref();

    fs.writeFileSync(
      LAST_RUN_FILE,
      JSON.stringify(
        { lastRun: new Date().toISOString(), logFile: logPath, project: getProjectName(cwd) },
        null,
        2,
      ),
      "utf-8",
    );

    // maintenance/index.md — clickable recent-log index (Obsidian-friendly)
    const logs = fs
      .readdirSync(MAINTENANCE_DIR)
      .filter((f) => f.startsWith("clean-") && f.endsWith(".log"))
      .sort()
      .reverse()
      .slice(0, 20);
    fs.writeFileSync(
      path.join(MAINTENANCE_DIR, "index.md"),
      `# 记忆维护日志\n\n${logs.map((l) => `- [[${l}]]`).join("\n")}\n`,
      "utf-8",
    );
  } catch { /* spawn failure — non-fatal, never block session end */ }
}

/** Render the maintenance section for before_agent_start injection. */
export function maintenanceSection(): string {
  const last = getLastMaintenance();
  if (!last?.logFile) return "";
  const t = last.lastRun || "";
  return (
    `\n\n---\n\n## 记忆维护日志\n` +
    `最近整理: ${t} (${last.project || "?"})\n` +
    `日志文件: ${last.logFile}\n` +
    `全部日志: ${MAINTENANCE_DIR}\\index.md\n`
  );
}
