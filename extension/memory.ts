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
 * @see https://github.com/your-username/pi-memory-system
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

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
    const files = fs
      .readdirSync(memoriesDir)
      .filter((f) => f.endsWith(".md"));
    summary += `- Long-term Memory Files: ${files.length}\n`;
    for (const f of files) {
      const filePath = path.join(memoriesDir, f);
      const content = safeRead(filePath);
      const entries = content ? content.split("\n## ").length - 1 : 0;
      summary += `  - ${f}: ${entries} entries\n`;
    }
  } else {
    summary += `- Long-term Memory Directory: ❌ Not found\n`;
  }

  return summary;
}

// ============================================================
// Extension — register hooks & tools
// ============================================================

export default function (pi: ExtensionAPI) {
  // ============================================================
  // session_start
  // ============================================================
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("memory", "🧠 Memory system ready");
  });

  // ============================================================
  // before_agent_start: inject memory context into system prompt
  // ============================================================
  pi.on("before_agent_start", async (event, ctx) => {
    const cwd = ctx.cwd;

    // 1. Read core prompt
    const corePrompt = safeRead(PATHS.corePrompt);
    const coreSection =
      corePrompt || "# Core Prompt\n（Not initialized — please run the setup script）\n";

    // 2. Read session notebook
    const notebookContent = safeRead(PATHS.notebook(cwd));
    const notebookSection =
      notebookContent || "# Session Notebook\n（Not initialized）\n";

    // 3. Resolve [[Wiki-links]] from notebook
    const links = notebookContent ? extractLinks(notebookContent) : [];
    const userKeywords = event.prompt ? [event.prompt] : [];
    const linkedContent = readLinkedContent(links, cwd, userKeywords);

    // 4. Assemble memory context
    let memoryContext = `${coreSection}\n\n---\n\n${notebookSection}\n`;

    if (linkedContent.length > 0) {
      memoryContext += "\n\n---\n\n## Related Memories\n";
      memoryContext += linkedContent.join("\n\n");
    }

    // 5. Inject into system prompt
    return {
      systemPrompt: event.systemPrompt + `\n\n${memoryContext}`,
    };
  });

  // ============================================================
  // context: refine conversation context every LLM call
  // ============================================================
  pi.on("context", async (event, _ctx) => {
    const messages = event.messages;
    if (!messages || messages.length <= 2) return;

    const userMsgIndices: number[] = [];
    const systemIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "user") userMsgIndices.push(i);
      if (m.role === "system" || m.role === "developer") systemIndices.push(i);
    }

    if (userMsgIndices.length <= KEEP_RECENT_TURNS) return;

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

    return { messages: filtered };
  });

  // ============================================================
  // Tool: remember — store info into long-term memory
  // ============================================================
  pi.registerTool({
    name: "remember",
    label: "🧠 Remember",
    description:
      "Store a piece of key information into long-term memory. Automatically sorted into facts / preferences / decisions / events.",
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

      const fileName = `${category}s.md`;
      const targetDir =
        scope === "global" ? PATHS.personalDir : PATHS.memoriesDir(cwd);

      const targetFile = path.join(targetDir, fileName);
      fs.mkdirSync(targetDir, { recursive: true });

      const timestamp = new Date().toISOString().slice(0, 10);
      const tagLine = tags.length > 0 ? `tags: [${tags.join(", ")}]` : "";
      const relatedLine = related ? `\nRelated: ${related}` : "";

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

      const entry = `
## ${entryTitle}
${tagLine ? `- ${tagLine}` : ""}
- Date: ${timestamp}

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
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
        for (const file of files) {
          const filePath = path.join(dir, file);
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
                matchCount++;
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

      const limited = results.slice(0, maxResults);
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
  // ============================================================
  pi.registerTool({
    name: "forget",
    label: "🗑️ Forget",
    description:
      "Delete a memory entry. Provide the target filename and section title.",
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
            text: `🗑️ Deleted "${section}" from [[${file}]].`,
          },
        ],
        details: { file, section },
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
}
