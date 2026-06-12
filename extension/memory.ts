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
import { compressContent, ccrStore, getCcrStats } from "./compress";

// ============================================================
// Config — 🛠️ Customize these paths for your setup
// ============================================================

const HOME = process.env.HOME || process.env.USERPROFILE || "~";

const PATHS = {
  // Global (agent-level)
  corePrompt: path.join(HOME, ".pi", "agent", "memory", "core-prompt.md"),
  personalDir: path.join(HOME, ".pi", "agent", "memory", "personal"),

  // Project-level (resolved dynamically from cwd)
  projectDir: (cwd: string) => path.join(cwd, ".pi", "memory"),
  notebook: (cwd: string) => path.join(cwd, ".pi", "memory", "notebook.md"),
  memoriesDir: (cwd: string) => path.join(cwd, ".pi", "memory", "memories"),
};

// ============================================================
// Context management
// ============================================================

// 🟡 How many recent conversation turns to keep during context refinement.
//    3 is a good balance between information retention and context cleanliness.
const KEEP_RECENT_TURNS = 3;

// 🔒 When true, the next context refinement is suppressed.
//    Set via /rec command. Reset automatically after one suppression.
let _refineSuppressed = false;
let _userMessageCount = 0;

/**
 * Compute the context refinement status for display.
 * Uses the handler's own counter, not sessionManager, to stay accurate.
 */
function getRefineStatus(): string {
  if (_refineSuppressed) return "⏸️ Context: /rec active";

  if (_userMessageCount <= KEEP_RECENT_TURNS) {
    const remaining = KEEP_RECENT_TURNS - _userMessageCount + 1;
    let s = `🧠 Trim: ${_userMessageCount}/${KEEP_RECENT_TURNS}`;
    if (remaining > 0) s += ` (${remaining} more msg${remaining > 1 ? "s" : ""})`;
    if (remaining <= 1) s += " — /rec to skip";
    return s;
  }

  return `🧠 Trim: next msg → clean (/${KEEP_RECENT_TURNS} kept, /rec to skip)`;
}

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
  const projectMem = path.join(
    PATHS.memoriesDir(cwd),
    link.endsWith(".md") ? link : `${link}.md`,
  );
  if (fs.existsSync(projectMem)) return projectMem;

  const projectRoot = path.join(
    PATHS.projectDir(cwd),
    link.endsWith(".md") ? link : `${link}.md`,
  );
  if (fs.existsSync(projectRoot)) return projectRoot;

  const personal = path.join(
    PATHS.personalDir,
    link.endsWith(".md") ? link : `${link}.md`,
  );
  if (fs.existsSync(personal)) return personal;

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
  summary += `- Core Prompt: ${coreExists ? "✅" : "❌"}\n`;

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
// Extension — register hooks & tools
// ============================================================

export default function (pi: ExtensionAPI) {
  // ============================================================
  // session_start
  // ============================================================
  pi.on("session_start", async (_event, ctx) => {
    _refineSuppressed = false;
    ctx.ui.setStatus("refine", "🧠 Trim: 0/3");
  });

  // ============================================================
  // before_agent_start: inject memory context into system prompt
  // ============================================================
  pi.on("before_agent_start", async (event, ctx) => {
    const cwd = ctx.cwd;

    // 0. Refresh _index.md for both scopes
    refreshIndex(cwd, "project");
    refreshIndex(cwd, "global");

    // 1. Read core prompt
    const corePrompt = safeRead(PATHS.corePrompt);
    const coreSection =
      corePrompt || "# Core Prompt\n（Not initialized — please run the setup script）\n";

    // 2. Read session notebook
    const notebookContent = safeRead(PATHS.notebook(cwd));
    const notebookSection =
      notebookContent || "# Session Notebook\n（Not initialized）\n";

    // 3. Read _index.md (memory index)
    const projIndex = safeRead(path.join(PATHS.memoriesDir(cwd), "_index.md"));
    const globalIndex = safeRead(path.join(PATHS.personalDir, "_index.md"));
    let indexSection = "";
    if (projIndex || globalIndex) {
      indexSection = "\n\n---\n\n## Memory Index\n\n";
      if (projIndex) indexSection += `### Project Memory\n\n${projIndex.replace(/^# Memory Index\n*/, "")}\n\n`;
      if (globalIndex) indexSection += `### Global Memory\n\n${globalIndex.replace(/^# Memory Index\n*/, "")}\n`;
    }

    // 4. Resolve [[Wiki-links]] from notebook
    const links = notebookContent ? extractLinks(notebookContent) : [];
    const userKeywords = event.prompt ? [event.prompt] : [];
    const linkedContent = readLinkedContent(links, cwd, userKeywords);

    // 5. Assemble memory context
    let memoryContext = `${coreSection}\n\n---\n\n${notebookSection}${indexSection}\n`;

    if (linkedContent.length > 0) {
      memoryContext += "\n\n---\n\n## Related Memories\n";
      memoryContext += linkedContent.join("\n\n");
    }

    // Compression guidelines (appended to system prompt)
    const ccrStat = getCcrStats();
    if (ccrStat.size > 0) {
      memoryContext += `\n\n---\n\n## Active Compression Cache\n- ${ccrStat.size} items in CCR store\n- Use \`ccr_retrieve({ hash })\` to recover any compressed content.\n`;
    }

    // 6. Inject into system prompt
    return {
      systemPrompt: event.systemPrompt + `\n\n${memoryContext}`,
    };
  });

  // ============================================================
  // context: refine conversation context
  //
  // ⚠️  DESIGN NOTES:
  //   - Pi fires `context` event BEFORE EVERY LLM CALL, not just before
  //     each user turn. A single user input can trigger 5+ LLM calls
  //     if there are tool calls in sequence.
  //   - The naive approach (count user messages, drop old ones) breaks
  //     when the agent is stuck in a tool-call loop — context gets
  //     trimmed mid-turn, discarding recent assistant/tool messages
  //     that are essential for debugging the loop.
  //   - Our strategy: use a token-based guard. Don't trim unless the
  //     total message payload is genuinely large. And only trim at
  //     the START of a user turn (not mid-turn during tool loops).
  // ============================================================
  pi.on("context", async (event, ctx) => {
    const messages = event.messages;
    if (!messages || messages.length <= 5) return;

    // /rec suppression: skip cleanup once, then reset
    if (_refineSuppressed) {
      _refineSuppressed = false;
      ctx.ui.setStatus("refine", getRefineStatus());
      return;
    }

    const userMsgIndices: number[] = [];
    const systemIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "user") userMsgIndices.push(i);
      if (m.role === "system" || m.role === "developer") systemIndices.push(i);
    }

    // Update counter from event.messages (accurate), not sessionManager
    _userMessageCount = userMsgIndices.length;

    // Don't trim mid-turn: if the last message is NOT a user message,
    // we're in the middle of a tool-calling loop. Trimming now would
    // discard assistant/tool/error messages the LLM needs to see.
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role !== "user") return;

    // Only trim if there are more than KEEP_RECENT_TURNS user messages.
    if (userMsgIndices.length <= KEEP_RECENT_TURNS) {
      ctx.ui.setStatus("refine", getRefineStatus());
      return;
    }

    const keepFrom = userMsgIndices[userMsgIndices.length - KEEP_RECENT_TURNS];
    const filtered: typeof messages = [];

    // Keep all system/developer messages
    for (const idx of systemIndices) {
      filtered.push(messages[idx]);
    }

    // Keep the most recent KEEP_RECENT_TURNS turns
    for (let i = keepFrom; i < messages.length; i++) {
      filtered.push(messages[i]);
    }

    // Reset counter post-cleanup (only KEEP_RECENT_TURNS user turns remain)
    _userMessageCount = KEEP_RECENT_TURNS;
    ctx.ui.setStatus("refine", `🧠 Trim: ✅ cleaned (kept ${KEEP_RECENT_TURNS} user turns, /rec to skip next)`);
    return { messages: filtered };
  });

  // ============================================================
  // agent_end: update refinement status after each turn
  // ============================================================
  pi.on("agent_end", async (_event, ctx) => {
    ctx.ui.setStatus("refine", getRefineStatus());
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

    // Content compression: compress bash tool outputs
    if (event.toolName === "bash" && !event.isError) {
      const outputText = (event.content?.[0] as { text?: string } | undefined)?.text;
      if (outputText && outputText.length > 2048) {
        const result = compressContent(outputText);
        if (result) {
          return {
            content: [{ type: "text", text: result.compressed }],
            details: {
              compressed: true,
              contentType: result.contentType,
              ccrHash: result.hash,
              stats: result.stats,
            },
            isError: false,
          };
        }
      }
    }
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
      let entryTitle: string;
      if (category === "event") {
        entryTitle = `${timestamp}: ${params.content.slice(0, 40)}`;
      } else {
        const contentFirstLine = params.content.split("\n")[0].trim();
        entryTitle =
          contentFirstLine.length > 50
            ? contentFirstLine.slice(0, 47) + "..."
            : contentFirstLine;
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

      // Update notebook active context
      const notebookPath = PATHS.notebook(cwd);
      const notebook = safeRead(notebookPath);
      if (notebook) {
        const noteLine = `\n- [${timestamp}] New ${category}: [[memories/${fileName}#${entryTitle}]]\n`;
        if (notebook.includes("## Active Context")) {
          const updated = notebook.replace(
            /(## Active Context\n)/,
            `$1${noteLine}`,
          );
          fs.writeFileSync(notebookPath, updated, "utf-8");
        }
      }

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
            "Section title to update (Current Task, Active Context, Key Decisions, Todos, Project Info, Related Projects)",
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
  // ============================================================
  // Tool: ccr_retrieve — get original content after compression
  // ============================================================
  pi.registerTool({
    name: "ccr_retrieve",
    label: "📦 Retrieve Original",
    description:
      "Retrieve the full original content that was automatically compressed " +
      "to save context tokens. Call this when you need un-truncated data " +
      "from a compressed tool output (identified by <<ccr:HASH>> markers).",
    promptSnippet:
      "Retrieve original compressed content by hash",
    promptGuidelines: [
      "Some tool outputs are auto-compressed and marked with <<ccr:HASH>>.",
      "Use ccr_retrieve with the hash to get back the full original content.",
      "Only call ccr_retrieve when the compressed summary is insufficient.",
    ],
    parameters: {
      type: "object",
      properties: {
        hash: {
          type: "string",
          description: "The hash from the <<ccr:HASH>> marker to retrieve.",
        },
      },
      required: ["hash"],
    },
    async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
      const hash = params.hash as string;
      const original = ccrStore.get(hash);
      if (!original) {
        return {
          content: [{ type: "text", text: `❌ Content with hash "${hash}" not found. It may have expired from the cache.` }],
          details: {},
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: original }],
        details: { hash, length: original.length },
        isError: false,
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
  // Command: /rec — suppress context refinement for next turn
  // ============================================================
  pi.registerCommand("rec", {
    description:
      "Suppress context refinement for the next user message. " +
      "Use this in extreme cases when you don't want old context cleaned yet. " +
      "Reset happens automatically after one suppressed turn.",
    handler: async (_args, ctx) => {
      _refineSuppressed = true;
      ctx.ui.setStatus("refine", "⏸️ Context: /rec active (next msg won't trim)");
      return "⏸️ Context refinement suppressed for next message only. Send your next message normally — it won't trigger trimming.";
    },
  });

  // ============================================================
  // Command: /trim — manually trigger context refinement now
  // ============================================================
  pi.registerCommand("trim", {
    description:
      "Manually trigger context refinement immediately. Forces cleanup " +
      "of old conversation history, keeping only the last 3 turns. " +
      "Use this when context feels bloated and you want a fresh view.",
    handler: async (_args, ctx) => {
      _userMessageCount = KEEP_RECENT_TURNS + 1;
      ctx.ui.setStatus("refine", "🧠 Trim: /trim queued");
      return `🧠 Trim queued. Next message will clean context (keep last ${KEEP_RECENT_TURNS} turns). You can still type /rec before sending to cancel.`;
    },
  });
}
