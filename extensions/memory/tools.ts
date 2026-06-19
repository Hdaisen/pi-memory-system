import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS, setProjectName } from "./config";
import { safeRead, extractLinks, walkMarkdownFiles } from "./utils";
import { diversitySort } from "./diversity";
import { convertWithMarkitdown } from "./markitdown";
import { refreshIndex, getMemoryStatus, updateTaskWidget } from "./memory-ops";

export function registerTools(pi: ExtensionAPI): void {
  // ============================================================
  // Tool: remember — store info into long-term memory
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
        // Guard: prevent nested dirs like events/events/implementation.md
        const categoryDir = `${category}s`;
        let normalizedFile = fileParam.replace(/\.md$/i, "");
        // Strip leading categoryDir/ or category/ prefix to prevent nesting
        if (normalizedFile.startsWith(`${categoryDir}/`)) {
          normalizedFile = normalizedFile.slice(`${categoryDir}/`.length);
        } else if (normalizedFile.startsWith(`${category}/`)) {
          normalizedFile = normalizedFile.slice(`${category}/`.length);
        }
        if (normalizedFile === category || normalizedFile === categoryDir) {
          // File param is redundant — write to flat {category}s.md instead
          fileName = `${category}s.md`;
          targetFile = path.join(targetDir, fileName);
        } else {
          fileName = `${categoryDir}/${normalizedFile}.md`;
          targetFile = path.join(targetDir, categoryDir, `${normalizedFile}.md`);
        }
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
                // Apply confidence filter — only match metadata lines, not body content
                const matchesConfidence =
                  !confidenceFilter ||
                  (lower.includes(`[${confidenceFilter}]`) &&
                   (lower.includes("置信度") || lower.includes("confidence")));
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
      const sectionHeader = `## ${section}`;
      const filtered = sections.filter((s) => {
        const firstLine = s.trim().split(/\r?\n/)[0];
        return firstLine !== sectionHeader;
      });

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
        `(^## ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?)(?=\\n## |$)`,
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
                text: `⚠️ Section "${section}" not found. Available sections: 当前任务, 本阶段完成, 待办, 跨轮约束, 项目常识`,
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
        const platform = require('os').platform();
        let errorMsg = `❌ Conversion failed.`;
        
        if (platform === 'win32') {
          errorMsg += ` Make sure MarkItDown is installed in WSL:\n  ~/.markitdown-venv/bin/markitdown\n\nOr install it: pip install markitdown (in WSL venv at ~/.markitdown-venv/)`;
        } else {
          errorMsg += ` Make sure MarkItDown is installed:\n  pip install markitdown\n\nOr install it in a virtual environment: python3 -m venv ~/.markitdown-venv && ~/.markitdown-venv/bin/pip install markitdown`;
        }
        
        return {
          content: [{
            type: "text",
            text: errorMsg,
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
