import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { HOME, PATHS, getProjectName } from "./config";
import { safeRead, walkMarkdownFiles, parseMemoryEntries, extractLinks, extractRelatedLinks } from "./utils";

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
    tags: string[];
    superseded: boolean;
  }[] = [];

  const files = walkMarkdownFiles(targetDir);
  for (const filePath of files) {
    const relativePath = path.relative(targetDir, filePath).replace(/\\/g, "/");
    const content = safeRead(filePath);
    if (!content) continue;

    for (const entry of parseMemoryEntries(content, relativePath)) {
      entries.push({
        relativePath,
        section: entry.section,
        date: entry.date,
        confidence: entry.confidence,
        tags: entry.tags,
        superseded: entry.superseded,
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
      const tags = item.tags.length > 0 ? ` | tags: ${item.tags.join(", ")}` : "";
      const fullLink = `memories/${item.relativePath}`;
      if (item.superseded) {
        index += `- ~~[[${fullLink}#${item.section}|${item.section}]]~~${date}${confidence} (superseded)\n`;
      } else {
        index += `- [[${fullLink}#${item.section}|${item.section}]]${date}${confidence}${tags}\n`;
      }
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

// 会话结束补固化阈值:剩余未固化节数 ≥ 3 才补跑(短会话不触发,避免频繁/浪费)
export const CONSOLIDATE_AT_SESSION_END = 3;

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

// 手动命令(memory-clean)不设限频——用户主动触发即跑;
// 自动路径(session_shutdown)已不再触发海马体。
const MAINTENANCE_INTERVAL_MS = 12 * 60 * 60 * 1000; // (保留:shouldRunMaintenance 兼容)

/**
 * Spawn a detached memory-maintenance subagent (pi -p + memory-cleaner.md).
 * 海马体职责:纯记忆整理(合并重复/修复污染/supersede 过期/报告死链)——
 * 不读对话、不固化对话(那是固化子代理的活)、不碰 notebook。
 * 触发:手动 /memory-clean 命令。输出 → maintenance/clean-<ts>.log。
 */
export function runMemoryMaintenance(cwd: string): void {
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

  let cmd = `pi -p --no-session --tools read,write,edit,remember,recall,forget,supersede`;
  if (model && model !== "(default)") cmd += ` --model "${model}"`;
  cmd += ` --append-system-prompt "${cleanerPrompt}"`;

  const prompt =
    "自动记忆维护（海马体整理）。扫描当前项目的长期记忆（memories/）与全局记忆（personal/），" +
    "修复格式污染、合并重复条目、supersede 过期/矛盾条目、报告死链与空文件。" +
    "不碰 notebook.md（主 LLM 独家维护），不碰 turns/ 短期记忆。输出清理报告。";

  try {
    const child = spawn(cmd, {
      shell: true,
      cwd: PATHS.projectDir(cwd),
      env: { ...process.env, PI_SUBAGENT: "1", PI_PROJECT_NAME: getProjectName(cwd) },
      stdio: ["pipe", logFd, logFd],
      // Windows: detached+shell+管道 stdio 会挂起(修复 #23),用 windowsHide;
      // Linux/Mac: detached 是标准后台化方式(setsid 脱离终端,父退出后子进程存活)。
      ...(process.platform === "win32" ? { windowsHide: true } : { detached: true }),
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
  } catch { /* spawn failure — non-fatal */ }
}

/**
 * Build a network-health report for memory: isolated entries, link density,
 * hub nodes. Mechanical graph stats are computed in code (LLM unreliable at
 * counting links); the hippocampus (cleaner) then uses the report to link
 * isolated entries or report them. Written to maintenance/network-health.md.
 */
export function buildNetworkHealthReport(cwd: string): string {
  const scopes: [string, string][] = [
    ["项目记忆", PATHS.memoriesDir(cwd)],
    ["全局记忆", PATHS.personalDir],
  ];

  interface EntryNode {
    scope: string;
    file: string;
    section: string;
    outLinks: string[];
    inCount: number;
  }

  const nodes: EntryNode[] = [];
  const fileLinks: { file: string; target: string }[] = [];

  for (const [scopeLabel, dir] of scopes) {
    if (!fs.existsSync(dir)) continue;
    for (const f of walkMarkdownFiles(dir)) {
      const rel = path.relative(dir, f).replace(/\\/g, "/");
      const content = safeRead(f);
      if (!content) continue;

      const sections = content.split(/(?=^## )/m);
      for (const sec of sections) {
        const titleMatch = sec.match(/^## (.+)/m);
        if (!titleMatch) continue;
        const title = titleMatch[1].trim();
        if (/↗\s*\*\*Superseded|↗\s*\*\*被取代/i.test(sec)) continue; // 跳过 superseded

        const outLinks = [...extractRelatedLinks(sec), ...extractLinks(sec)]
          .map((l) => l.split("#")[0].trim())
          .filter((l) => l && !l.includes("_index"));
        nodes.push({ scope: scopeLabel, file: rel, section: title, outLinks: [...new Set(outLinks)], inCount: 0 });
        for (const t of outLinks) fileLinks.push({ file: rel, target: t });
      }
    }
  }

  // 入链:指向本条目所在文件的**不同来源文件数**(去重,避免同文件多链接重复计数)
  for (const n of nodes) {
    const f = n.file.replace(/^memories\//, "").replace(/\.md$/, "");
    const sources = new Set<string>();
    for (const fl of fileLinks) {
      if (fl.file === n.file) continue; // 不自链
      const t = fl.target.replace(/^memories\//, "").replace(/\.md$/, "");
      if (t === f) sources.add(fl.file);
    }
    n.inCount = sources.size;
  }

  const totalEntries = nodes.length;
  const totalLinks = fileLinks.length;
  const density = totalEntries > 0 ? (totalLinks / totalEntries).toFixed(2) : "0";
  const isolated = nodes.filter((n) => n.outLinks.length === 0 && n.inCount === 0);
  const hubs = [...nodes].sort((a, b) => b.inCount - a.inCount).slice(0, 5).filter((n) => n.inCount > 0);

  const lines: string[] = [
    `## 记忆网络健康报告 (${new Date().toISOString().slice(0, 10)})`,
    ``,
    `- 条目总数: ${totalEntries} | 链接总数: ${totalLinks} | 密度: ${density}`,
    `- 孤立条目(零出链且零入链,不会被联想触达): ${isolated.length} 个`,
  ];
  for (const n of isolated.slice(0, 30)) {
    lines.push(`  - [[${n.file}#${n.section}|${n.scope}]]`);
  }
  if (isolated.length > 30) lines.push(`  …(共 ${isolated.length} 个)`);

  if (hubs.length > 0) {
    lines.push(`- 枢纽节点(被链接最多):`);
    for (const h of hubs) {
      lines.push(`  - [[${h.file}#${h.section}]] × ${h.inCount}`);
    }
  }
  return lines.join("\n");
}

export function getSubagentModel(): string {
  try {
    return fs
      .readFileSync(path.join(HOME, ".pi", "agent", "memory", "subagent-model.txt"), "utf-8")
      .trim();
  } catch {
    return "(default)";
  }
}

/**
 * 在 footer 状态栏常驻显示当前 subagent model(不清除,直到重新设置)。
 * 替代终端 console.log 确认消息:命令选择后 + 会话启动时各更新一次。
 */
export function updateSubagentModelStatus(ctx: any): void {
  const model = getSubagentModel();
  const theme = ctx.ui.theme;
  ctx.ui.setStatus(
    "subagent-model",
    model && model !== "(default)"
      ? theme.fg("dim", "subagent: ") + theme.fg("text", model)
      : theme.fg("dim", "subagent: (default)"),
  );
}

/**
 * 会话结束补固化:spawn 固化子代理(pi -p + memory-extractor.md),处理
 * 未固化的余数轮次(consolidation-input.md 由调用方写入)。detached 后台,
 * 不阻塞退出;输出 → sessionDir/consolidation-<ts>.log。
 */
export function spawnConsolidationSubagent(sessionDir: string): void {
  const extractorPrompt = path.join(HOME, ".pi", "agent", "agents", "memory-extractor.md");
  if (!fs.existsSync(extractorPrompt)) return;

  // sessionDir = .../projects/<name>/turns/sessions/<id> → 项目名 = 上上上级的 basename
  const projectName = path.basename(path.dirname(path.dirname(path.dirname(sessionDir))));

  let model = "";
  try {
    model = fs
      .readFileSync(path.join(HOME, ".pi", "agent", "memory", "subagent-model.txt"), "utf-8")
      .trim();
  } catch { /* default model */ }

  let cmd = `pi -p --no-session --tools read,write,edit,remember,recall,forget,supersede`;
  if (model && model !== "(default)") cmd += ` --model "${model}"`;
  cmd += ` --append-system-prompt "${extractorPrompt}"`;

  const prompt =
    "执行记忆固化（会话结束补跑）。你的当前工作目录(cwd)是记忆会话目录:\n" +
    "- 读 consolidation-input.md（剩余轮次的对话摘要，含关键动作行）\n" +
    "- 需要细节时 read raw-<n>.md 回查；写每条记忆前先对账（recall 当前主题，有则 supersede/merge，没有才新增）\n" +
    "- 只沉淀长期记忆（remember）。不写 notebook（主 LLM 独家维护），不清理记忆文件（海马体的活）\n" +
    `cwd: ${sessionDir}`;

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(sessionDir, `consolidation-${ts}.log`);
  try {
    const logFd = fs.openSync(logPath, "a");
    fs.writeSync(logFd, `# Consolidation (session end) — ${new Date().toISOString()}\n\n`);
    const child = spawn(cmd, {
      shell: true,
      cwd: sessionDir,
      env: { ...process.env, PI_SUBAGENT: "1", PI_SESSION_DIR: sessionDir, PI_PROJECT_NAME: projectName },
      stdio: ["pipe", logFd, logFd],
      // Windows: detached+shell+管道 stdio 会挂起(修复 #23),用 windowsHide;
      // Linux/Mac: detached 是标准后台化方式(setsid 脱离终端,父退出后子进程存活)。
      ...(process.platform === "win32" ? { windowsHide: true } : { detached: true }),
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
    child.unref();
  } catch { /* non-fatal */ }
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
