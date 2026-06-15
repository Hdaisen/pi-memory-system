/**
 * Pi Memory System Extension
 *
 * A three-layer Markdown memory system for Pi coding agent.
 * - Core Prompt: identity & principles (global, agent-level)
 * - Session Notebook: active tasks & context (per project)
 * - Long-term Memory: facts, preferences, decisions, events (project + global)
 *
 * Features:
 * - Zero boilerplate: Markdown files are both storage AND injection format
 * - [[Wiki-links]]: Obsidian-compatible bidirectional linking
 * - Context refinement: prevents infinite context growth
 * - 5 built-in tools: remember / recall / forget / notebook / memory_status
 *
 * @see https://github.com/Hdaisen/pi-memory-system
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
// compression handled by context-mode extension — memory.ts no longer imports compress.ts

// Suppress Node.js SQLite ExperimentalWarning from context-mode's MCP bridge child process.
// context-mode uses node:sqlite (built-in since Node 22.5), which emits this warning on first
// import. The MCP bridge spawns server.bundle.mjs as a child and the warning leaks through.
// Setting this before the bridge bootstraps ensures the child inherits a clean env.
process.env.NODE_NO_WARNINGS = "1";

// ============================================================
// Config — 🛠️ Customize these paths for your setup
// ============================================================

const HOME = process.env.HOME || process.env.USERPROFILE || "~";

/**
 * Detect project name by walking up from cwd looking for a marker.
 * Priority: .pi-project file > .git directory > cwd basename
 * Result is cached to avoid repeated filesystem lookups.
 */
let _projNameCache: { cwd: string; name: string } | null = null;
function getProjectName(cwd: string): string {
  if (_projNameCache && _projNameCache.cwd === cwd) return _projNameCache.name;

  let dir = path.resolve(cwd);
  while (true) {
    // Marker file with explicit project name
    const marker = path.join(dir, ".pi-project");
    if (fs.existsSync(marker)) {
      const name = fs.readFileSync(marker, "utf-8").trim();
      if (name) {
        _projNameCache = { cwd, name };
        return name;
      }
    }
    // Git repo → use parent dir name
    if (fs.existsSync(path.join(dir, ".git"))) {
      _projNameCache = { cwd, name: path.basename(dir) };
      return path.basename(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }

  // Fallback: use cwd basename
  _projNameCache = { cwd, name: path.basename(cwd) };
  return path.basename(cwd);
}

/**
 * Set or correct the project name. Writes a .pi-project marker so
 * the name persists across sessions. The marker is found by the
 * walk-up detection in getProjectName() — writing to any directory
 * above the marker-less zone is sufficient.
 */
function setProjectName(cwd: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  // Write marker to cwd (walk-up starts from cwd, so nearest wins)
  fs.writeFileSync(path.join(cwd, ".pi-project"), trimmed, "utf-8");
  // Clear cache so next getProjectName re-computes with new state
  _projNameCache = null;
}

const PATHS = {
  // Global (agent-level)
  corePrompt: path.join(HOME, ".pi", "agent", "memory", "core-prompt.md"),
  rules: path.join(HOME, ".pi", "agent", "memory", "rules.md"),
  personalDir: path.join(HOME, ".pi", "agent", "memory", "personal"),

  // Project-level — centralized under ~/.pi/agent/memory/projects/<name>/
  projectsRoot: path.join(HOME, ".pi", "agent", "memory", "projects"),
  projectDir: (cwd: string) =>
    path.join(HOME, ".pi", "agent", "memory", "projects", getProjectName(cwd)),
  notebook: (cwd: string) =>
    path.join(HOME, ".pi", "agent", "memory", "projects", getProjectName(cwd), "notebook.md"),
  memoriesDir: (cwd: string) =>
    path.join(HOME, ".pi", "agent", "memory", "projects", getProjectName(cwd), "memories"),
  turnsDir: (cwd: string) =>
    path.join(HOME, ".pi", "agent", "memory", "projects", getProjectName(cwd), "turns"),
};

// ============================================================
// Context management
// ============================================================

// 🟡 How many recent conversation turns to keep during context refinement.
//    Set to 1: subagent distillation handles cross-turn info via essence.md.
//    Only the current turn needs to stay in context.
const KEEP_RECENT_TURNS = 1;

// (removed: subagent handles memory maintenance, no refinement needed)

// ============================================================
// Helpers
// ============================================================

/** Safely read a file; returns null if missing or unreadable. */
function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Extract all [[Wiki-links]] from Markdown text. */
function extractLinks(text: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const ref = match[1].split("#")[0].trim();
    if (ref && !links.includes(ref)) links.push(ref);
  }
  return links;
}

/** Resolve a [[Wiki-link]] to an actual file path. */
function resolveLink(link: string, cwd: string): string | null {
  // Check project memories first
  const projectMem = path.join(
    PATHS.memoriesDir(cwd),
    link.endsWith(".md") ? link : `${link}.md`,
  );
  if (fs.existsSync(projectMem)) return projectMem;

  // Check project root (for notebook.md etc.)
  const projectRoot = path.join(
    PATHS.projectDir(cwd),
    link.endsWith(".md") ? link : `${link}.md`,
  );
  if (fs.existsSync(projectRoot)) return projectRoot;

  // Check personal (global)
  const personal = path.join(
    PATHS.personalDir,
    link.endsWith(".md") ? link : `${link}.md`,
  );
  if (fs.existsSync(personal)) return personal;

  // Legacy fallback: check old .pi/memory/ location
  const oldProjectDir = path.join(cwd, ".pi", "memory");
  const legacyMem = path.join(oldProjectDir, link.endsWith(".md") ? link : `${link}.md`);
  if (fs.existsSync(legacyMem)) return legacyMem;

  return null;
}

// ============================================================
// Content fingerprint helpers — detect similarity for diversity sorting
// ============================================================

/**
 * Extract a content fingerprint from text: keywords + their frequency.  */
function contentFingerprint(text: string): Map<string, number> {
  const stopWords = new Set([
    "the", "a", "an", "is", "was", "are", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "out", "off", "over",
    "under", "again", "further", "then", "once", "this", "that", "these",
    "those", "not", "no", "nor", "but", "or", "and", "if", "while",
    "because", "until", "so", "about", "up", "it", "its", "just", "also",
    "very", "too", "here", "there", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "only", "own",
    "same", "than", "too", "very", "well", "back", "still", "yet",
    "one", "two", "new", "like", "use", "way", "get", "make", "know",
    "take", "see", "come", "think", "look", "want", "give", "tell",
    "work", "call", "try", "ask", "need", "feel", "become", "leave",
    "put", "mean", "keep", "let", "begin", "seem", "help", "turn",
  ]);
  const fp = new Map<string, number>();
  const words = text.toLowerCase().split(/[^a-zA-Z0-9\u4e00-\u9fff]+/g);
  for (const w of words) {
    if (w.length > 2 && !stopWords.has(w)) {
      fp.set(w, (fp.get(w) || 0) + 1);
    }
  }
  return fp;
}

/**
 * Compute Jaccard similarity between two content fingerprints.
 * Uses weighted intersection to handle frequency differences.
 */
function fingerprintSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  const allKeys = new Set([...a.keys(), ...b.keys()]);
  if (allKeys.size === 0) return 1;

  let intersection = 0;
  let union = 0;
  for (const key of allKeys) {
    const va = a.get(key) || 0;
    const vb = b.get(key) || 0;
    intersection += Math.min(va, vb);
    union += Math.max(va, vb);
  }
  return intersection / union;
}

/**
 * Compute similarity between two items. Used by diversitySort.
 */
function itemSimilarity<T>(a: T, b: T, extractor: (item: T) => string): number {
  return fingerprintSimilarity(contentFingerprint(extractor(a)), contentFingerprint(extractor(b)));
}

/**
 * Diversity sort: reorder items so the most unique ones come first.
 * Greedy algorithm — pick the item most different from all already-selected.
 * Keeps ALL items, just changes order. Designed for recall results
 * where the LLM can only see the first few but shouldn't miss variety.
 */
function diversitySort<T>(
  items: T[],
  extractor: (item: T) => string,
): T[] {
  if (items.length <= 1) return items;

  const fingerprints = items.map((item) => contentFingerprint(extractor(item)));
  const selected = new Set<number>();
  const result: T[] = [];

  // Pick the first one: most unique (lowest average similarity to all others)
  let firstIdx = 0;
  let bestScore = Infinity;
  for (let i = 0; i < items.length; i++) {
    let avgSim = 0;
    for (let j = 0; j < items.length; j++) {
      if (i !== j) avgSim += fingerprintSimilarity(fingerprints[i], fingerprints[j]);
    }
    avgSim /= items.length - 1;
    if (avgSim < bestScore) {
      bestScore = avgSim;
      firstIdx = i;
    }
  }
  selected.add(firstIdx);
  result.push(items[firstIdx]);

  // Greedy pick: next = item with lowest max similarity to any selected
  while (result.length < items.length) {
    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < items.length; i++) {
      if (selected.has(i)) continue;
      // max similarity to any already-selected item
      let maxSim = 0;
      for (const s of selected) {
        const sim = fingerprintSimilarity(fingerprints[i], fingerprints[s]);
        if (sim > maxSim) maxSim = sim;
      }
      if (maxSim < bestScore) {
        bestScore = maxSim;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    selected.add(bestIdx);
    result.push(items[bestIdx]);
  }

  // Append any remaining (theoretically unreachable)
  for (let i = 0; i < items.length; i++) {
    if (!selected.has(i)) result.push(items[i]);
  }

  return result;
}

/** Read linked files and extract relevant paragraphs. */
function readLinkedContent(
  links: string[],
  cwd: string,
  keywords: string[] = [],
): string[] {
  const results: string[] = [];

  for (const link of links) {
    const resolved = resolveLink(link, cwd);
    if (!resolved) {
      results.push(`- [[${link}]] → ⚠️ Not found`);
      continue;
    }

    const content = safeRead(resolved);
    if (!content) {
      results.push(`- [[${link}]] → ⚠️ Unreadable`);
      continue;
    }

    const lines = content.split("\n");
    const matchedLines: string[] = [];
    let inHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim() === "---") {
        inHeader = !inHeader;
        continue;
      }
      if (inHeader) continue;

      if (keywords.length > 0) {
        const lower = line.toLowerCase();
        if (keywords.some((k) => lower.includes(k.toLowerCase()))) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 3);
          matchedLines.push(`... (lines ${start + 1}-${end})`);
          matchedLines.push(...lines.slice(start, end));
          matchedLines.push("---");
        }
      } else {
        if (i < 20) matchedLines.push(line);
      }
    }

    const summary =
      matchedLines.length > 0
        ? matchedLines.join("\n")
        : "（File exists but no matching sections found for current keywords）";

    results.push(`📄 [[${link}]]\n${summary}`);
  }

  return results;
}

/** Recursively find all .md files in a directory, excluding _index.md. */
function walkMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        results.push(...walkMarkdownFiles(full));
      } else if (item.isFile() && item.name.endsWith(".md") && item.name !== "_index.md") {
        results.push(full);
      }
    }
  } catch { /* dir not found */ }
  return results;
}

/**
 * Refresh _index.md by scanning all .md files in the memory directory.
 * Scans entries (## sections) from each file and builds a navigable TOC.
 */
function refreshIndex(cwd: string, scope: "project" | "global"): void {
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
function getMemoryStatus(cwd: string): string {
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
 * Ensure a project\'s memory directory and notebook exist.
 * Creates them with default template if missing.
 */
function ensureProjectDir(cwd: string): void {
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
 * Create a WSL symlink from ~/.pi/agent/memory to the Windows path
 * when the WSL username differs from the Windows username.
 * This ensures bash commands (which run in WSL) can find memory files.
 */
function ensureWslSymlink(): void {
  try {
    // Check if WSL is available
    const wslPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe");
    if (!fs.existsSync(wslPath)) return;

    // Get WSL username
    const wslUser = execSync(`"${wslPath}" whoami`, { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "ignore"] }).trim();
    const winUser = process.env.USERNAME || "";
    if (!wslUser || !winUser) return;
    if (wslUser === winUser) return;

    // Paths (use WSL paths inside WSL)
    const winMemoryPath = `/mnt/c/Users/${winUser}/.pi/agent/memory`;
    const wslMemoryPath = `/home/${wslUser}/.pi/agent/memory`;

    // Check if symlink already exists
    try {
      const existing = execSync(
        `"${wslPath}" readlink "${wslMemoryPath}" 2>/dev/null || echo NOT_LINK`,
        { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
      if (existing === winMemoryPath) return;
    } catch {}

    // Create parent dir and symlink — use wsl default shell, no -e flag (Windows doesn't understand single quotes)
    execSync(
      `"${wslPath}" mkdir -p /home/${wslUser}/.pi/agent`,
      { encoding: "utf8", timeout: 10000 }
    );
    execSync(
      `"${wslPath}" ln -sf "${winMemoryPath}" "${wslMemoryPath}"`,
      { encoding: "utf8", timeout: 10000 }
    );
    console.log(`[memory] Created WSL symlink: ${wslMemoryPath} \u2192 ${winMemoryPath}`);
  } catch (e) {
    // WSL not available or command failed — not critical, suppress
  }
}

// content summary generation removed — dedup handled by context-mode

// ============================================================
// MarkItDown helper
// ============================================================

// Formats that need conversion (binary, unreadable by read tool)
const BINARY_EXTENSIONS = new Set([
  ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".epub", ".msg",
]);

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Convert a binary file to Markdown via MarkItDown (WSL).
 * Returns Markdown text on success, or null if conversion fails.
 */
function convertWithMarkitdown(filePath: string): string | null {
  try {
    // Resolve wsl.exe
    const wslExe = process.env.WSL_EXE || "wsl.exe";

    // Convert Windows path → WSL path via wslpath
    const wslPath = execSync(
      `${wslExe} wslpath -u "${filePath.replace(/\\/g, "/")}"`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();

    if (!wslPath) return null;

    // Run markitdown in WSL
    const markitdownCmd = `${wslExe} ~/.markitdown-venv/bin/markitdown "${wslPath}"`;
    const mdOutput = execSync(markitdownCmd, {
      encoding: "utf-8",
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024, // 50MB max output
    });

    return mdOutput || null;
  } catch {
    return null;
  }
}

// ============================================================
// Task Widget — render notebook tasks in Pi TUI
// ============================================================

/**
 * Read the session notebook and render a task summary widget.
 * Shows current task + pending todos in Pi's TUI below the editor.
 */
function updateTaskWidget(cwd: string, ctx: any): void {
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
// raw.md generation — format conversation + tool results to Markdown
// ============================================================

/** Extract main brain's verbatim text from an assistant message. */
function extractAssistantText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text || "")
      .join("\n")
      .trim();
  }
  return "";
}

// ============================================================
// Extension — register hooks & tools
// ============================================================

/** Flag: set when the current agent session is aborted (ESC).
 *  ctx.signal is undefined during agent_end (turn already cleaned up),
 *  so we track abort state manually via turn_end / tool_call events. */
let _agentAborted = false;

export default function (pi: ExtensionAPI) {
  // Create WSL symlink at startup if Windows/WSL usernames differ
  ensureWslSymlink();

  // ============================================================
  // session_start
  // ============================================================
  pi.on("session_start", async (_event, ctx) => {
    _agentAborted = false;
    ctx.ui.setStatus("memory", "🧠 🟢");
    updateTaskWidget(ctx.cwd, ctx);
  });

  // ============================================================
  // before_agent_start: inject memory context into system prompt
  // ============================================================
  pi.on("before_agent_start", async (event, ctx) => {
    // Guard: subagents have their own prompts (e.g. memory-extractor.md),
    // do NOT inject core-prompt + notebook + turn-summary into them.
    if (process.env.PI_SUBAGENT === "1") return;

    const cwd = ctx.cwd;

    // 0. Ensure project directory and notebook exist
    ensureProjectDir(cwd);

    // 1. Refresh _index.md for both scopes
    refreshIndex(cwd, "project");
    refreshIndex(cwd, "global");

    // 2. Read core prompt + behavioral rules
    const corePrompt = safeRead(PATHS.corePrompt);
    const coreSection =
      corePrompt || "# Core Prompt\n（Not initialized — please run the setup script）\n";
    const rules = safeRead(PATHS.rules);

    // 3. Read session notebook (maintained by subagent)
    const notebookContent = safeRead(PATHS.notebook(cwd));
    const notebookSection =
      notebookContent || "# Session Notebook\n（Not initialized）\n";

    // 4. Read turn-summary.md (main brain's last response, written by extension)
    //    + essence.md (subagent's distilled handoff, if available)
    const turnsDir = path.join(PATHS.projectDir(cwd), "turns");
    const summaryContent = safeRead(path.join(turnsDir, "turn-summary.md"));
    const summarySection = summaryContent
      ? `\n\n---\n\n## 上轮摘要\n\n${summaryContent.trim()}\n`
      : "";
    // essence.md is still read for subagent's analysis (optional enrichment)
    const essenceContent = safeRead(path.join(turnsDir, "essence.md"));
    const essenceSection = essenceContent
      ? `\n\n---\n\n## 子代理分析\n\n${essenceContent.trim()}\n`
      : "";

    // 5. Build linked memories from notebook [[Wiki-links]]
    let linkedSection = "";
    const links = notebookContent ? extractLinks(notebookContent) : [];
    const userKeywords = event.prompt ? [event.prompt] : [];
    const linkedContent = readLinkedContent(links, cwd, userKeywords);
    if (linkedContent.length > 0) {
      linkedSection = "\n\n---\n\n## Related Memories\n" + linkedContent.join("\n\n");
    }

    // 6. Build memory context — core + rules + notebook + essence + linked
    let memoryContext = `${coreSection}\n`;
    if (rules) memoryContext += `\n${rules}\n`;
    memoryContext += `\n---\n\n${notebookSection}${summarySection}${essenceSection}${linkedSection}\n`;

    return {
      systemPrompt: event.systemPrompt + `\n\n${memoryContext}`,
    };
  });

  // context: keep only system messages (our injections), strip all history
  // ============================================================
  pi.on("context", async (event, ctx) => {
    const messages = event.messages;
    if (!messages || messages.length <= 2) return;

    // Don't trim mid-turn: if the last message is NOT a user message,
    // we're in the middle of a tool-calling loop.
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role !== "user") return;

    // At user turn boundary: keep system/developer + current user message
    // (old user/assistant/tool history is stripped — subagent essence covers it)
    const lastUserIdx = messages.length - 1;
    const filtered = messages.filter(
      (_: any, i: number) =>
        _.role === "system" || _.role === "developer" || i === lastUserIdx
    );

    // If nothing to trim, skip
    if (filtered.length === messages.length) return;

    ctx.ui.setStatus("memory", "🧠 🟡");
    return { messages: filtered };
  });

  // ============================================================
  // agent_start: reset abort flag at the start of each agent run
  // ============================================================
  pi.on("agent_start", async () => {
    _agentAborted = false;
  });

  // ============================================================
  // turn_end: capture abort signal state. ctx.signal is still alive
  // during turn_end but is undefined by agent_end (turn already cleaned
  // up), so we cache it here.
  // ============================================================
  pi.on("turn_end", async (_event, ctx) => {
    if (ctx.signal?.aborted) {
      _agentAborted = true;
    }
  });

  // ============================================================
  // agent_end: call Python script (format + subagent)
  //
  // Guards (in order):
  //   1. PI_SUBAGENT — prevents subagent process from spawning nested subagents
  //   2. _agentAborted — skips extraction when user presses ESC (cached in turn_end)
  //   3. Meaningful content check — skips extraction when messages are noise
  //
  // Output strategy: capture all child process output; don't inherit stdio
  // to avoid clashing with Pi's TUI spinner/rendering. Show only a brief
  // status in Pi's footer. On failure, print error details.
  // ============================================================
  pi.on("agent_end", async (_event, ctx) => {
    const cwd = ctx.cwd;

    // Guard 1: Prevent subagent recursion
    if (process.env.PI_SUBAGENT === "1") return;

    // Guard 2: Session was aborted (user pressed ESC)
    if (_agentAborted) {
      _agentAborted = false;
      return;
    }

    const messages = (_event as any)?.messages;

    // Guard 3: Not enough messages for meaningful extraction
    if (!messages || !Array.isArray(messages) || messages.length < 2) return;

    ctx.ui.setStatus("memory", "🧠 ⏳");

    const scriptPath = path.join(HOME, ".pi", "agent", "scripts", "run_extraction.py");
    try {
      const { spawn } = await import("node:child_process");
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 180000);

      const [stdout, stderr] = await new Promise<[string, string]>((resolve, reject) => {
        const child = spawn("python3", [scriptPath], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PI_SUBAGENT: "1" },
          signal: ac.signal,
        });

        const chunks: Buffer[] = [];
        const errChunks: Buffer[] = [];

        child.stdout!.on("data", (d: Buffer) => chunks.push(d));
        child.stderr!.on("data", (d: Buffer) => errChunks.push(d));

        child.stdin!.end(JSON.stringify(messages));

        child.on("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve([Buffer.concat(chunks).toString("utf-8"), Buffer.concat(errChunks).toString("utf-8")]);
          } else {
            const err = Buffer.concat(errChunks).toString("utf-8");
            reject(new Error(`exit code ${code}: ${err.slice(0, 500)}`));
          }
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      ctx.ui.setStatus("memory", "🧠 🟢");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : "";
      console.warn("[memory] extraction failed:", msg);

      // Write error to file for debugging
      try {
        const errorLog = path.join(PATHS.turnsDir(cwd), "extraction-error.log");
        const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
        const errorContent = `# Extraction Error — ${timestamp}\n\n${msg}\n${stack ? `\nStack:\n${stack}` : ""}\n`;
        fs.writeFileSync(errorLog, errorContent, "utf-8");
      } catch { /* best effort */ }

      ctx.ui.setStatus("memory", "🧠 🔴");
    }

    // ── Write turn-summary.md (main brain's last response, injected next turn) ──
    // This file is written by the extension, NOT by the subagent.
    // essence.md is exclusively for the subagent's distilled output.
    // NOTE: Moved outside try-catch so turn-summary is ALWAYS written,
    // even if python extraction script fails.
    const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
    if (lastAssistant) {
      const text = extractAssistantText(lastAssistant.content);
      if (text) {
        const summaryPath = path.join(PATHS.turnsDir(cwd), "turn-summary.md");
        const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
        const block = `# 主脑上一轮回复 (${timestamp})\n\n${text.trim()}\n`;
        fs.writeFileSync(summaryPath, block, "utf-8");
      }
    }

    updateTaskWidget(cwd, ctx);
  });

  // ============================================================
  // tool_result: auto-convert binary files + compress verbose output
  // ============================================================
  pi.on("tool_result", async (event, _ctx) => {
    // MarkItDown: auto-convert binary files when read fails
    if (event.toolName === "read" && event.isError) {
      const filePath = (event.input as Record<string, unknown>)?.path as string | undefined;
      if (filePath && isBinaryFile(filePath)) {
        const md = convertWithMarkitdown(filePath);
        if (md !== null) {
          return {
            content: [{ type: "text", text: md }],
            details: {
              converted: true,
              originalFormat: path.extname(filePath).toLowerCase(),
              note: "This file was automatically converted from " +
                path.extname(filePath).toUpperCase() + " to Markdown via MarkItDown.",
            },
            isError: false,
          };
        }
      }
    }

    // Content compression handled by context-mode extension — removed from memory.ts
  });

  // ============================================================
  // Tool: remember — store info into long-term memory
  //
  // Scope rules (for LLM):
  //   Use scope="global" when the information is useful across projects:
  //   - Daisen's personal preferences and work habits
  //   - Cross-project technical knowledge (how Pi works, TypeScript patterns)
  //   - Development environment facts (Windows + WSL, tools)
  //   - Reusable architecture lessons
  //
  //   Use scope="project" (default) when the info is project-specific:
  //   - Project architecture decisions ("why X library")
  //   - Project code facts
  //   - Project events and milestones
  //   - Project-specific conventions
  //
  //   Simple test: "Would this still be useful in a different project?"
  //   Yes → global. No → project.
  // ============================================================
  pi.registerTool({
    name: "remember",
    label: "🧠 Remember",
    description:
      "Store a piece of key information into long-term memory. Automatically sorted into facts / preferences / decisions / events. Use scope=global for cross-project knowledge (preferences, technical knowledge, dev env). Use scope=project (default) for project-specific info.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Content to remember",
        },
        category: {
          type: "string",
          enum: ["fact", "preference", "decision", "event"],
          description:
            "Memory type. fact=objective fact, preference=work style/taste, decision=design decision + reasoning, event=experience summary",
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description:
            "Scope. project=specific to current project, global=cross-project general",
        },
        tags: {
          type: "string",
          description: "Comma-separated tags, e.g. 'typescript, architecture'",
        },
        confidence: {
          type: "string",
          enum: ["confirmed", "inferred", "intuition"],
          description:
            "Confidence level. confirmed=verified by evidence, inferred=logical deduction, intuition=gut feeling / preliminary. Default: no annotation.",
        },
        trigger: {
          type: "string",
          description:
            "What triggered this memory. Prefix with type, e.g. 'conversation — Daisen suggested X', 'debugging — found root cause of Y', 'code-review — noticed pattern Z'. Common types: conversation, debugging, code-review, refactoring, experiment, reading, user-feedback, contradiction, external.",
        },
        file: {
          type: "string",
          description:
            "Optional: target file name within the category directory, WITHOUT .md suffix. " +
            "Examples: 'debugging' → events/debugging.md, 'architecture' → decisions/architecture.md. " +
            "Check the Memory Index ([[_index.md]]) for existing categories. " +
            "If content doesn't fit any existing category, propose a new file name and ASK THE USER FOR CONFIRMATION before using it. " +
            "If omitted, falls back to a single general file (e.g., events.md).",
        },
        title: {
          type: "string",
          description:
            "Optional: explicit title for the entry. If omitted, the first line of content is used. " +
            "Use this when the first line of content is too long or generic.",
        },
        related: {
          type: "string",
          description: "Related [[Wiki-links]], comma separated",
        },
      },
      required: ["content", "category"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const category = params.category as string;
      const scope = (params.scope as string) || "project";
      const tags = params.tags
        ? params.tags.split(",").map((t: string) => t.trim())
        : [];
      const related = params.related || "";

      const targetDir =
        scope === "global" ? PATHS.personalDir : PATHS.memoriesDir(cwd);

      // Determine target file: if `file` param is provided, write to subdirectory
      const fileParam = params.file as string | undefined;
      let fileName: string;
      let targetFile: string;
      if (fileParam) {
        const categoryDir = `${category}s`;
        fileName = `${categoryDir}/${fileParam}.md`;
        targetFile = path.join(targetDir, categoryDir, `${fileParam}.md`);
      } else {
        fileName = `${category}s.md`;
        targetFile = path.join(targetDir, fileName);
      }
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });

      const timestamp = new Date().toISOString().slice(0, 10);
      const tagLine = tags.length > 0 ? `tags: [${tags.join(", ")}]` : "";
      const relatedLine = related ? `\nRelated: ${related}` : "";
      const confidence = params.confidence as string | undefined;
      const trigger = params.trigger as string | undefined;

      const existing = safeRead(targetFile);
      // Title: use explicit title if provided, otherwise derive from content
      // WITHOUT auto-truncation — no more '...' surprise
      let entryTitle: string;
      if (params.title) {
        entryTitle = (params.title as string).trim();
      } else if (category === "event") {
        const firstLine = params.content.split("\n")[0].trim();
        entryTitle = `${timestamp}: ${firstLine.slice(0, 60)}`;
      } else {
        entryTitle = params.content.split("\n")[0].trim();
      }

      const metaLines: string[] = [];
      if (confidence) metaLines.push(`- **置信度**: \`[${confidence}]\``);
      if (trigger) metaLines.push(`- **触发器**: ${trigger}`);
      if (tagLine) metaLines.push(`- ${tagLine}`);
      metaLines.push(`- Date: ${timestamp}`);
      const metaBlock = metaLines.join("\n");

      const entry = `
## ${entryTitle}
${metaBlock}

${params.content}${relatedLine}
`;

      fs.appendFileSync(targetFile, entry, "utf-8");

      // Refresh index to include the new entry
      refreshIndex(cwd, scope as "project" | "global");

      return {
        content: [
          {
            type: "text",
            text: `✅ Stored in ${
              scope === "global" ? "global" : "project"
            } [[memories/${fileName}#${entryTitle}]]`,
          },
        ],
        details: { file: fileName, entry: entryTitle },
      };
    },
  });

  // ============================================================
  // Tool: recall — search long-term memory
  // ============================================================
  pi.registerTool({
    name: "recall",
    label: "🔍 Recall",
    description:
      "Search long-term memory for relevant information. Returns matching snippets and related links. Supports fuzzy matching.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query. Multiple keywords separated by space (any match is sufficient).",
        },
        scope: {
          type: "string",
          enum: ["project", "global", "all"],
          description:
            "Search scope. project=current project only, global=personal only, all=everywhere",
        },
        confidence: {
          type: "string",
          enum: ["confirmed", "inferred", "intuition"],
          description:
            "Only return entries with this confidence level (optional filter).",
        },
        maxResults: {
          type: "number",
          description: "Maximum results to return (default: 5)",
        },
      },
      required: ["query"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const query = (params.query as string).toLowerCase();
      const scope = (params.scope as string) || "all";
      const maxResults = (params.maxResults as number) || 5;
      const confidenceFilter = params.confidence as string | undefined;

      const keywords = query.split(/\s+/).filter(Boolean);
      const results: string[] = [];

      const searchDirs: string[] = [];
      if (scope === "project" || scope === "all") {
        const projDir = PATHS.memoriesDir(cwd);
        if (fs.existsSync(projDir)) searchDirs.push(projDir);
      }
      if (scope === "global" || scope === "all") {
        if (fs.existsSync(PATHS.personalDir)) searchDirs.push(PATHS.personalDir);
      }

      for (const dir of searchDirs) {
        const filePaths = walkMarkdownFiles(dir);
        for (const filePath of filePaths) {
          const file = path.relative(dir, filePath).replace(/\\/g, "/");
          const content = safeRead(filePath);
          if (!content) continue;

          const lines = content.split("\n");
          let currentSection = "";
          let sectionLines: string[] = [];
          let matchCount = 0;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith("## ")) {
              if (matchCount > 0) {
                results.push(
                  `📄 [[memories/${file}#${currentSection}]]\n${sectionLines.join(
                    "\n",
                  )}\n---`,
                );
                matchCount = 0;
              }
              currentSection = line.replace("## ", "").trim();
              sectionLines = [line];
              continue;
            }

            if (currentSection) {
              sectionLines.push(line);
              const lower = line.toLowerCase();
              if (keywords.length === 0 || keywords.some((k) => lower.includes(k))) {
                // Apply confidence filter if set
                const matchesConfidence =
                  !confidenceFilter ||
                  lower.includes(`[${confidenceFilter}]`);
                if (matchesConfidence) {
                  matchCount++;
                }
              }
            }
          }

          if (matchCount > 0 && currentSection) {
            results.push(
              `📄 [[memories/${file}#${currentSection}]]\n${sectionLines.join(
                "\n",
              )}\n---`,
            );
          }
        }
      }

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No results found in ${scope} memory for "${params.query}".\n\nUse \`/remember\` to save this information for future retrieval.`,
            },
          ],
          details: { found: 0 },
        };
      }

      // Diversity sort: most unique results first, no results removed
      const sorted = results.length > maxResults
        ? diversitySort(results, (r) => r.replace(/^.*?\n/, ""))
        : results;
      const limited = sorted.slice(0, maxResults);
      const total = results.length;

      let output = `Found ${total} result(s)${total > maxResults ? ` (showing first ${maxResults})` : ""}:\n\n`;
      output += limited.join("\n\n");

      const allLinks = new Set<string>();
      for (const r of limited) {
        for (const link of extractLinks(r)) {
          allLinks.add(link);
        }
      }
      if (allLinks.size > 0) {
        output += `\n\n**Related links**: ${Array.from(allLinks)
          .map((l) => `[[${l}]]`)
          .join(", ")}`;
      }

      return {
        content: [{ type: "text", text: output }],
        details: { found: total, shown: limited.length },
      };
    },
  });

  // ============================================================
  // Tool: forget — delete a memory entry
  //   ⚠️ PREFER `supersede` OVER `forget`.
  //     forget destroys information permanently.
  //     supersede keeps old entry and marks it as superseded by a new one.
  //     Only use forget for: test data, duplicate entries, obvious noise.
  // ============================================================
  pi.registerTool({
    name: "forget",
    label: "🗑️ Forget",
    description:
      "Delete a memory entry permanently. ⚠️ Prefer `supersede` instead — it keeps the old entry for traceability and just marks it as superseded.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "Target filename, e.g. facts.md, preferences.md, decisions.md, events.md",
        },
        section: {
          type: "string",
          description: "Section title to delete (after ##)",
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "Scope of the memory",
        },
      },
      required: ["file", "section"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const file = params.file as string;
      const section = params.section as string;
      const scope = (params.scope as string) || "project";

      const targetDir =
        scope === "global" ? PATHS.personalDir : PATHS.memoriesDir(cwd);
      const targetFile = path.join(targetDir, file);
      const content = safeRead(targetFile);

      if (!content) {
        return {
          content: [{ type: "text", text: `❌ File [[${file}]] not found.` }],
          details: {},
        };
      }

      const sections = content.split(/(?=^## )/m);
      const filtered = sections.filter(
        (s) =>
          !s.trim().startsWith(`## ${section}`) &&
          !s.trim().startsWith(`## ${section}\n`),
      );

      if (filtered.length === sections.length) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Section "${section}" not found in [[${file}]].`,
            },
          ],
          details: {},
        };
      }

      fs.writeFileSync(targetFile, filtered.join("").trim() + "\n", "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `🗑️ Permanently deleted "${section}" from [[${file}]].`,
          },
        ],
        details: { file, section },
      };
    },
  });

  // ============================================================
  // Tool: supersede — mark an entry as superseded by new understanding
  //   Append-only: never delete the old entry, just annotate it.
  //   Semantic corrections (wrong reasoning, overturned conclusions) MUST
  //   use this tool. Non-semantic fixes (typos, broken links, formatting)
  //   can use edit directly.
  // ============================================================
  pi.registerTool({
    name: "supersede",
    label: "🔄 Supersede",
    description:
      "Mark an existing memory entry as superseded by new understanding. Appends a superseded-by annotation to the old entry without deleting it. Returns the old content so you can create the replacement entry separately (via `remember` or `edit`).",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "Target filename, e.g. decisions.md, events.md",
        },
        section: {
          type: "string",
          description:
            "Section title of the entry to supersede (after ##)",
        },
        reason: {
          type: "string",
          description:
            "Why this entry is being superseded. Be specific: what was wrong or incomplete.",
        },
        newReference: {
          type: "string",
          description:
            "Wiki-link to the new entry that supersedes this one, e.g. [[decisions.md#New Decision Title]]",
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description: "Scope of the memory",
        },
      },
      required: ["file", "section", "reason"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const file = params.file as string;
      const section = params.section as string;
      const reason = params.reason as string;
      const newReference = params.newReference as string | undefined;
      const scope = (params.scope as string) || "project";

      const targetDir =
        scope === "global" ? PATHS.personalDir : PATHS.memoriesDir(cwd);
      const targetFile = path.join(targetDir, file);
      const content = safeRead(targetFile);

      if (!content) {
        return {
          content: [{ type: "text", text: `❌ File [[${file}]] not found.` }],
          details: {},
        };
      }

      const timestamp = new Date().toISOString().slice(0, 10);
      const supersedeLine = newReference
        ? `\n\n↗ **Superseded by** ${newReference} (${timestamp}) — ${reason}`
        : `\n\n↗ **Superseded** (${timestamp}) — ${reason}`;

      // Find the section in the file
      const sectionRegex = new RegExp(
        `(^## ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?)(?=\\n## |\\z)`,
        "m",
      );

      if (!sectionRegex.test(content)) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Section "${section}" not found in [[${file}]].`,
            },
          ],
          details: {},
        };
      }

      const updated = content.replace(sectionRegex, `$1${supersedeLine}`);
      fs.writeFileSync(targetFile, updated, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: `🔄 Marked "${section}" in [[${file}]] as superseded${newReference ? ` by ${newReference}` : ""}.\n\nOld entry content:\n${content.match(sectionRegex)?.[0]?.trim() || "(could not extract)"}\n\n---\n\nNow create the replacement entry using \`remember\` or \`edit\`.`,
          },
        ],
        details: { file, section, superseded: true },
      };
    },
  });

  // ============================================================
  // Tool: notebook — view/update session notebook
  // ============================================================
  pi.registerTool({
    name: "notebook",
    label: "📓 Notebook",
    description:
      "View or update the session notebook. Use action=read to view, action=update with section and content to update.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["read", "update"],
          description: "read=view current content, update=edit a section",
        },
        section: {
          type: "string",
          description:
            "Section title to update: 当前任务, 本阶段完成, 待办, 跨轮约束, 项目常识",
        },
        content: {
          type: "string",
          description: "New content (for update action only)",
        },
      },
      required: ["action"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const notebookPath = PATHS.notebook(cwd);
      const action = params.action as string;

      if (action === "read") {
        const content =
          safeRead(notebookPath) || "（Notebook not initialized）";
        return {
          content: [{ type: "text", text: `📓 Current Notebook:\n\n${content}` }],
          details: {},
        };
      }

      if (action === "update") {
        const section = params.section as string;
        const content = params.content as string;
        const existing = safeRead(notebookPath);

        if (!existing) {
          return {
            content: [
              { type: "text", text: "❌ Notebook not found. Initialize it first." },
            ],
            details: {},
          };
        }

        const sectionRegex = new RegExp(
          `(## ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n)([\\s\\S]*?)(?=\\n## |$)`,
          "m",
        );
        const updated = existing.replace(sectionRegex, `$1${content}\n`);

        if (updated === existing) {
          return {
            content: [
              {
                type: "text",
                text: `⚠️ Section "${section}" not found. Available sections: Current Task, Active Context, Key Decisions, Todos, Project Info, Related Projects`,
              },
            ],
            details: {},
          };
        }

        fs.writeFileSync(notebookPath, updated, "utf-8");
        updateTaskWidget(cwd, ctx);
        return {
          content: [
            {
              type: "text",
              text: `✅ Updated notebook section "${section}".`,
            },
          ],
          details: { section },
        };
      }

      return {
        content: [
          { type: "text", text: "⚠️ Unknown action. Use read or update." },
        ],
        details: {},
      };
    },
  });

  // ============================================================
  // Tool: memory_status — memory system overview
  // ============================================================
  pi.registerTool({
    name: "memory_status",
    label: "📊 Memory Status",
    description:
      "View the current memory system file status and entry counts.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const status = getMemoryStatus(cwd);
      return {
        content: [{ type: "text", text: status }],
        details: {},
      };
    },
  });

  // ============================================================
  // Tool: convert_file — convert binary files to Markdown via MarkItDown
  // ============================================================
  pi.registerTool({
    name: "convert_file",
    label: "📄 Convert to Markdown",
    description:
      "Convert binary files (PDF, Word, Excel, PowerPoint, ePub, etc.) " +
      "to Markdown text using MarkItDown. Use this when you receive a " +
      "file format that the read tool cannot handle.",
    promptSnippet:
      "Convert binary/document files to Markdown with MarkItDown",
    promptGuidelines: [
      "Use convert_file when you need to read a PDF, DOCX, XLSX, PPTX, " +
      "or other binary document format that read cannot handle.",
      "convert_file also works on HTML pages — use it to get clean " +
      "Markdown from web pages you've saved locally.",
    ],
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to convert. Supports PDF, DOCX, " +
            "PPTX, XLSX, XLS, EPUB, MSG, and HTML formats.",
        },
      },
      required: ["path"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const filePath = params.path as string;

      if (!fs.existsSync(filePath)) {
        return {
          content: [{ type: "text", text: `❌ File not found: ${filePath}` }],
          details: {},
          isError: true,
        };
      }

      const ext = path.extname(filePath).toLowerCase();
      const md = convertWithMarkitdown(filePath);

      if (md === null) {
        return {
          content: [{
            type: "text",
            text: `❌ Conversion failed. Make sure MarkItDown is installed in WSL:
  ~/.markitdown-venv/bin/markitdown

Or install it: pip install markitdown (in WSL venv at ~/.markitdown-venv/)`,
          }],
          details: {},
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: md }],
        details: {
          format: ext,
          note: `Converted from ${ext.toUpperCase()} to Markdown via MarkItDown.`,
        },
        isError: false,
      };
    },
  });

  // ============================================================
  // Tool: confirm — interactive user confirmation
  // ============================================================
  pi.registerTool({
    name: "confirm",
    label: "✅ Confirm",
    description:
      "Show an interactive yes/no prompt to the user in the terminal. " +
      "Use this when you need user confirmation before proceeding. " +
      "The user can press y/Enter for yes, n/Enter for no.",
    promptSnippet:
      "Ask the user for interactive confirmation",
    promptGuidelines: [
      "Use confirm when you need user confirmation before proceeding with an action.",
      "This shows an interactive prompt in the terminal — the user just presses y/n + Enter.",
      "Do NOT use this for open-ended questions; yes/no confirmations only.",
      "Call confirm FIRST, then act based on the result.",
    ],
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short title for the confirmation dialog.",
        },
        message: {
          type: "string",
          description: "Detailed message explaining what the user is confirming.",
        },
      },
      required: ["title", "message"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const title = params.title as string;
      const message = params.message as string;

      const confirmed = await ctx.ui.confirm(title, message);

      return {
        content: [{
          type: "text",
          text: confirmed
            ? "✅ User confirmed."
            : "❌ User declined.",
        }],
        details: { confirmed },
      };
    },
  });

  // ============================================================
  // Tool: set_project — set or correct the project name
  // ============================================================
  pi.registerTool({
    name: "set_project",
    label: "📁 Set Project",
    description:
      "Set or correct the current project name. Use this when the system " +
      "detected the wrong project (e.g. from a subdirectory) and you know " +
      "which project you're working on. The name is persisted in a .pi-project " +
      "marker file and used for all subsequent memory operations.",
    promptSnippet:
      "Set the current project name (e.g. set_project name=jason)",
    promptGuidelines: [
      "If the system guessed the wrong project name, call set_project to correct it.",
      "The project name determines where notebook.md and project memories are stored.",
      "Example: you're in a subdirectory of 'jason' but system reads 'frontend' → call set_project name=jason",
    ],
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "The correct project name. Should be short and match the project " +
            "directory name, e.g. 'jason', 'pi-memory-system'.",
        },
      },
      required: ["name"],
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const name = params.name as string;
      const cwd = ctx.cwd;

      setProjectName(cwd, name);

      return {
        content: [{ type: "text", text: `✅ Project name set to "${name}". Notebook and memories will now resolve under projects/${name}/.` }],
        details: { projectName: name },
      };
    },
  });
}
