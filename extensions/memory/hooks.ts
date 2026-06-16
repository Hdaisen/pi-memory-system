import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { HOME, PATHS } from "./config";
import { safeRead, extractLinks, readLinkedContent } from "./utils";
import { isBinaryFile, convertWithMarkitdown } from "./markitdown";
import { ensureProjectDir, refreshIndex, updateTaskWidget } from "./memory-ops";

/** Flag: set when the current agent session is aborted (ESC).
 *  ctx.signal is undefined during agent_end (turn already cleaned up),
 *  so we track abort state manually via turn_end / tool_call events. */
let _agentAborted = false;

export function registerHooks(pi: ExtensionAPI): void {
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

    // turn-summary.md is now generated by run_extraction.py alongside raw.md

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
}
