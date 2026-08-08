import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { HOME, PATHS, getProjectName } from "./config";
import { safeRead, extractLinks, readLinkedContent, readMemoryIndex, searchMemories, lastSections, countSections, readSkills, matchSkills, formatSkillsForPrompt } from "./utils";
import { isBinaryFile, convertWithMarkitdown } from "./markitdown";
import { ensureProjectDir, refreshIndex, updateTaskWidget, maintenanceSection, spawnConsolidationSubagent, CONSOLIDATE_AT_SESSION_END, updateSubagentModelStatus } from "./memory-ops";

/** Flag: set when the current agent session is aborted (ESC).
 *  ctx.signal is undefined during agent_end (turn already cleaned up),
 *  so we track abort state manually via turn_end / tool_call events. */
let _agentAborted = false;
let _sessionDir: string | null = null; // 当前会话的短期记忆目录(turns/sessions/<id>)

/**
 * 会话身份锚点 = Pi 的 session file 名(去扩展名)。
 * session_start 会在 /reload、/resume、/fork 等场景对**同一个**逻辑会话再次触发,
 * 若每次都重新生成目录会导致:新开文件夹 + 轮次从 1 重算(重大 BUG)。
 * 以 session file 为身份,同一会话始终复用同一目录。
 */
function getSessionAnchor(ctx: any): string {
  try {
    const sf = ctx?.sessionManager?.getSessionFile();
    if (sf) return path.basename(sf).replace(/\.jsonl?$/i, "");
  } catch { /* ephemeral session — 无 session file */ }
  return "";
}

/** 查找 cwd 下已存在的同锚点会话目录(进程重启 / reload 恢复用),取最新一个。 */
function findExistingSessionDir(cwd: string, anchor: string): string {
  if (!anchor) return "";
  const sessionsDir = path.join(PATHS.projectDir(cwd), "turns", "sessions");
  if (!fs.existsSync(sessionsDir)) return "";
  const matches = fs
    .readdirSync(sessionsDir)
    .filter((d) => d.endsWith("-" + anchor))
    .sort();
  return matches.length > 0 ? path.join(sessionsDir, matches[matches.length - 1]) : "";
}

// ============================================================
// Extraction progress UI
// ============================================================

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Parse a stderr line from run_extraction.py and return structured progress info. */
interface ProgressUpdate {
  type: "extract" | "subagent" | "status";
  label: string;
  done?: boolean;
}

function parseProgress(line: string): ProgressUpdate | null {
  // Extract phase: raw.md and turn-summary.md
  if (line.includes("raw.md:")) {
    const match = line.match(/raw\.md:\s*(\d+)\s*msgs/);
    return { type: "extract", label: `raw.md${match ? ": " + match[1] + " msgs" : ""}`, done: true };
  }
  if (line.includes("turn-summary.md:")) {
    const match = line.match(/turn-summary\.md:\s*(\d+)\s*chars/);
    return { type: "extract", label: `turn-summary.md${match ? ": " + match[1] + " chars" : ""}`, done: true };
  }
  if (line.includes("Starting memory extraction subagent")) {
    return { type: "extract", label: "Starting memory extraction subagent..." };
  }

  // Subagent phase: reading, writing, processing
  if (line.includes("[subagent]") || line.includes("[memory]")) {
    const label = line.replace(/\[subagent\]\s*/, "[subagent] ").replace(/\[memory\]\s*/, "[memory] ");
    return { type: "subagent", label };
  }

  // Status messages
  if (line.includes("extraction complete")) return { type: "status", label: "Extraction complete", done: true };
  if (line.includes("subagent done")) return { type: "status", label: "Subagent finished", done: true };
  if (line.includes("subagent failed") || line.includes("timed out")) return { type: "status", label: "Extraction failed", done: false };

  // Other messages with [prefix]
  const prefixMatch = line.match(/\[(\w+)\]\s*(.*)/);
  if (prefixMatch) {
    return { type: "subagent", label: line };
  }

  return null;
}

/**
 * Rich progress UI via ctx.ui.custom().
 * Shows a bordered panel with spinner, current step, and scrolling log lines.
 * Returns a promise that resolves when extraction finishes or is cancelled.
 */
function runExtractionWithProgress(
  ctx: any,
  scriptPath: string,
  messages: any[],
  cwd: string,
  skipSubagent = false,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (typeof ctx.ui.custom !== "function") {
      throw new Error("ctx.ui.custom is not a function");
    }

    ctx.ui.custom<void>((tui: any, theme: any, _kb: any, done: () => void) => {
      let step = "Initializing...";
      let frame = 0;
      const completedTasks: string[] = [];
      const subagentLogs: string[] = [];
      let childProc: ChildProcess | null = null;
      let settled = false;
      let animTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (animTimer) { clearInterval(animTimer); animTimer = null; }
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      };

      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        step = success ? "Extraction complete ✓" : "Extraction failed ✗";
        tui.requestRender();
        setTimeout(() => { cleanup(); done(); }, success ? 800 : 2000);
      };

      const component = {
        render(width: number): string[] {
          const lines: string[] = [];
          const w = Math.min(width, 72);

          // Top border
          lines.push(theme.fg("accent", "╭" + "─".repeat(w - 2) + "╮"));

          // Title with spinner
          const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
          const title = ` ${spinner} Memory Extraction`;
          const padded = title + " ".repeat(Math.max(0, w - 2 - title.length));
          lines.push(theme.fg("accent", "│") + theme.fg("text", padded) + theme.fg("accent", "│"));

          // Separator
          lines.push(theme.fg("accent", "├" + "─".repeat(w - 2) + "┤"));

          // Completed tasks with checkmarks
          for (const task of completedTasks) {
            const taskLine = `  [extract] ✓ ${task}`;
            const taskPadded = taskLine + " ".repeat(Math.max(0, w - 2 - taskLine.length));
            lines.push(theme.fg("accent", "│") + theme.fg("success", taskPadded) + theme.fg("accent", "│"));
          }

          // Current step (if not completed yet)
          if (!settled) {
            const stepLine = `  [extract] ${step}`;
            const stepPadded = stepLine + " ".repeat(Math.max(0, w - 2 - stepLine.length));
            lines.push(theme.fg("accent", "│") + theme.fg("text", stepPadded) + theme.fg("accent", "│"));
          }

          // Empty line separator
          lines.push(theme.fg("accent", "│") + " ".repeat(w - 2) + theme.fg("accent", "│"));

          // Subagent logs (show last 6)
          const visibleLogs = subagentLogs.slice(-6);
          for (const log of visibleLogs) {
            const truncated = log.length > w - 4 ? log.slice(0, w - 7) + "..." : log;
            const lp = `  ${truncated}` + " ".repeat(Math.max(0, w - 2 - truncated.length - 2));
            lines.push(theme.fg("accent", "│") + theme.fg("dim", lp) + theme.fg("accent", "│"));
          }

          // Fill remaining space (target ~12 lines total)
          const totalContent = completedTasks.length + 1 + subagentLogs.length + 4; // +4 for borders/title/separator/hint
          const remaining = Math.max(0, 12 - totalContent);
          for (let i = 0; i < remaining; i++) {
            lines.push(theme.fg("accent", "│") + " ".repeat(w - 2) + theme.fg("accent", "│"));
          }

          // Bottom border with hint
          const hint = " ESC: cancel ";
          const bottomPad = w - 2 - hint.length;
          lines.push(
            theme.fg("accent", "├") +
            theme.fg("dim", hint) +
            theme.fg("accent", "─".repeat(Math.max(0, bottomPad)) + "╮"),
          );
          lines.push(theme.fg("accent", "╰" + "─".repeat(w - 2) + "╯"));

          return lines;
        },

        handleInput(data: string): void {
          if (data === "escape" || data === "\x1b") {
            if (childProc && !settled) {
              childProc.kill();
              finish(false);
            }
          }
        },

        invalidate(): void {},
      };

      // Spawn the extraction script
      const ac = new AbortController();
      timeoutTimer = setTimeout(() => {
        if (!settled) { childProc?.kill(); finish(false); }
      }, 360000);

      const args = [scriptPath];
      if (skipSubagent) args.push("--skip-subagent");
      childProc = spawn("python3", args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PI_SUBAGENT: "1", PI_SESSION_DIR: _sessionDir ?? "", PI_PROJECT_NAME: getProjectName(cwd) },
        signal: ac.signal,
      });

      childProc.stdin!.end(JSON.stringify(messages));

      // Parse stderr for progress updates
      let stderrBuf = "";
      childProc.stderr!.on("data", (d: Buffer) => {
        stderrBuf += d.toString("utf-8");
        const parts = stderrBuf.split("\n");
        stderrBuf = parts.pop()!;

        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const progress = parseProgress(trimmed);
          if (progress) {
            switch (progress.type) {
              case "extract":
                if (progress.done) {
                  completedTasks.push(progress.label);
                } else {
                  step = progress.label;
                }
                break;
              case "subagent":
                subagentLogs.push(progress.label);
                break;
              case "status":
                step = progress.label;
                if (progress.done !== undefined) {
                  step = progress.done ? "Extraction complete ✓" : "Extraction failed ✗";
                }
                break;
            }
          } else {
            // Generic log line
            subagentLogs.push(trimmed);
          }
        }
        tui.requestRender();
      });

      childProc.on("exit", (code: number | null) => {
        if (stderrBuf.trim()) subagentLogs.push(stderrBuf.trim());
        finish(code === 0);
      });

      childProc.on("error", (err: Error) => {
        subagentLogs.push(`Error: ${err.message}`);
        finish(false);
      });

      // Animation timer for spinner
      animTimer = setInterval(() => { frame++; tui.requestRender(); }, 80);

      return component;
    }).then(() => resolve()).catch(reject);
  });
}

/**
 * Simple fallback: update footer status bar with progress info.
 * Used when ctx.ui.custom() is not available (e.g., non-TUI mode).
 */
async function runExtractionSimple(
  ctx: any,
  scriptPath: string,
  messages: any[],
  cwd: string,
  skipSubagent = false,
): Promise<void> {
  ctx.ui.setStatus("memory", "🧠 ⏳ extracting...");

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 360000);

    const stderr = await new Promise<string>((resolve, reject) => {
      const args = [scriptPath];
      if (skipSubagent) args.push("--skip-subagent");
      const child = spawn("python3", args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PI_SUBAGENT: "1", PI_SESSION_DIR: _sessionDir ?? "", PI_PROJECT_NAME: getProjectName(cwd) },
        signal: ac.signal,
      });

      const errChunks: Buffer[] = [];

      child.stderr!.on("data", (d: Buffer) => {
        errChunks.push(d);
        // Update status with latest progress
        const line = d.toString("utf-8").trim();
        const progress = parseProgress(line);
        if (progress) {
          ctx.ui.setStatus("memory", `🧠 ⏳ ${progress.label}`);
        }
      });

      child.stdin!.end(JSON.stringify(messages));

      child.on("exit", (code: number | null) => {
        clearTimeout(timer);
        const err = Buffer.concat(errChunks).toString("utf-8");
        if (code === 0) {
          resolve(err);
        } else {
          reject(new Error(`exit code ${code}: ${err.slice(0, 500)}`));
        }
      });
      child.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    ctx.ui.setStatus("memory", "🧠 🟢");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : "";
    console.warn("[memory] extraction failed:", msg);

    try {
      const errorLog = path.join(PATHS.turnsDir(cwd), "extraction-error.log");
      const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
      const errorContent = `# Extraction Error — ${timestamp}\n\n${msg}\n${stack ? `\nStack:\n${stack}` : ""}\n`;
      fs.writeFileSync(errorLog, errorContent, "utf-8");
    } catch { /* best effort */ }

    ctx.ui.setStatus("memory", "🧠 🔴");
  }
}

// ============================================================
// Hooks registration
// ============================================================

export function registerHooks(pi: ExtensionAPI): void {
  // ============================================================
  // session_start
  // ============================================================
  pi.on("session_start", async (_event: any, ctx: any) => {
    _agentAborted = false;
    // Guard: subagents (extractor/cleaner) are spawned with PI_SUBAGENT=1 and
    // must not create session dirs or touch UI — they only write long-term memory.
    if (process.env.PI_SUBAGENT === "1") return;
    // 会话隔离 + 会话稳定:目录名 = <ts>-<rand>-<session-file 锚点>。
    // 同一 session file 始终复用同一目录(reload/resume 重触发时不新开、轮次不重置)。
    if (ctx?.cwd) {
      const anchor = getSessionAnchor(ctx);
      const existing = findExistingSessionDir(ctx.cwd, anchor);
      if (existing) {
        // 已有同锚点目录(进程重启后恢复 / reload 重触发)→ 复用
        _sessionDir = existing;
      } else {
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const rand = Math.random().toString(36).slice(2, 6);
        _sessionDir = path.join(
          PATHS.projectDir(ctx.cwd),
          "turns",
          "sessions",
          anchor ? `${ts}-${rand}-${anchor}` : `${ts}-${rand}`,
        );
      }
    }
    ctx.ui.setStatus("memory", "🧠 🟢");
    updateSubagentModelStatus(ctx);
    updateTaskWidget(ctx.cwd, ctx);
  });

  // ============================================================
  // before_agent_start: inject memory context into system prompt
  // ============================================================
  pi.on("before_agent_start", async (event: any, ctx: any) => {
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

    // 4. Read dialogue summary (working memory) + essence.
    //    会话隔离:优先读当前会话目录(turns/sessions/<id>/),
    //    兼容旧布局:无会话目录时回退 turns/(旧单会话)。
    const legacyTurns = path.join(PATHS.projectDir(cwd), "turns");
    const turnsDir = _sessionDir || legacyTurns;
    const dialogueSummary = safeRead(path.join(turnsDir, "dialogue-summary.md")) || safeRead(path.join(legacyTurns, "dialogue-summary.md"));
    // 注入滑动窗口:取最后 SUMMARY_WINDOW 节(工作记忆),早期节永久保留在文件里但不注入。
    const SUMMARY_WINDOW = 5;
    const summaryContent = dialogueSummary
      ? lastSections(dialogueSummary, SUMMARY_WINDOW)
      : safeRead(path.join(legacyTurns, "turn-summary.md"));
    const summarySection = summaryContent
      ? `\n\n---\n\n## 最近对话摘要\n\n${summaryContent.trim()}\n`
      : "";
    // essence.md 已废弃(信息都在对话摘要里)——不再注入

    // 5. Build linked memories from notebook [[Wiki-links]]
    let linkedSection = "";
    const links = notebookContent ? extractLinks(notebookContent) : [];
    const userKeywords = event.prompt ? [event.prompt] : [];
    const linkedContent = readLinkedContent(links, cwd, userKeywords);
    if (linkedContent.length > 0) {
      linkedSection = "\n\n---\n\n## Related Memories\n" + linkedContent.join("\n\n");
    }

    // 6. Read memory index and search for relevant memories
    let memoryIndexSection = "";
    let searchResultsSection = "";

    const indexContent = readMemoryIndex(cwd);
    if (indexContent) {
      memoryIndexSection = "\n\n---\n\n## Memory Index\n" + indexContent;
    }

    // Note: searchMemories has its own keyword-based guard (English words +
    // CJK 2-grams), so Chinese prompts shorter than 10 chars still search.
    if (event.prompt) {
      const searchResults = searchMemories(event.prompt, cwd, 5);
      if (searchResults.length > 0) {
        searchResultsSection = "\n\n---\n\n## Related Memories (Auto-Injected)\n" + searchResults.join("\n\n");
      }
    }

    // 7. Match procedural skills against user prompt and inject
    let skillsSection = "";
    if (event.prompt) {
      const allSkills = readSkills(cwd);
      const matchedSkills = matchSkills(event.prompt, allSkills);
      if (matchedSkills.length > 0) {
        skillsSection = "\n\n---\n\n## Available Skills\n" + formatSkillsForPrompt(matchedSkills);
      }
    }

    // 8. Build memory context — stable-first ordering for DeepSeek prefix caching:
    //    core + rules + memory index + dialogue summary are stable/append-only
    //    (they form the cache-hit prefix); essence/notebook change only at
    //    consolidation points (every 5 turns); related/maintenance vary per turn.
    let memoryContext = `${coreSection}\n`;
    if (rules) memoryContext += `\n${rules}\n`;
    memoryContext += `\n---\n\n${memoryIndexSection}${summarySection}${notebookSection}${linkedSection}${searchResultsSection}${skillsSection}${maintenanceSection()}\n`;

    return {
      systemPrompt: event.systemPrompt + `\n\n${memoryContext}`,
    };
  });

  // ============================================================
  // context: keep system messages and optionally recent history
  //
  // Strategy:
  //   - New turn (no assistant history): strip all history, keep system + current user
  //   - Follow-up turn (has assistant history): keep system + current user + last assistant exchange
  //   - Mid-turn (tool-calling loop): don't trim
  // ============================================================
  pi.on("context", async (event: any, ctx: any) => {
    const messages = event.messages;
    if (!messages || messages.length <= 2) return;

    // Don't trim mid-turn: if the last message is NOT a user message,
    // we're in the middle of a tool-calling loop.
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role !== "user") return;

    // Check if this is a follow-up message (has assistant history)
    const hasAssistantHistory = messages.some((m: any) => m.role === "assistant");

    if (hasAssistantHistory) {
      // Follow-up scenario: keep system/developer + last assistant exchange + current user message
      // This preserves context when user appends/corrects mid-conversation
      const lastUserIdx = messages.length - 1;

      // Find the last assistant message before the current user message
      let lastAssistantIdx = -1;
      for (let i = lastUserIdx - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          lastAssistantIdx = i;
          break;
        }
      }

      if (lastAssistantIdx >= 0) {
        // Keep: system/developer messages + last assistant + any tool results after it + current user
        const filtered = messages.filter(
          (msg: any, i: number) =>
            msg.role === "system" ||
            msg.role === "developer" ||
            i >= lastAssistantIdx  // Keep from last assistant onwards
        );

        // If nothing to trim, skip
        if (filtered.length === messages.length) return;

        ctx.ui.setStatus("memory", "🧠 🟡");
        return { messages: filtered };
      }
    }

    // New turn scenario: keep system/developer + current user message only
    const lastUserIdx = messages.length - 1;
    const filtered = messages.filter(
      (msg: any, i: number) =>
        msg.role === "system" || msg.role === "developer" || i === lastUserIdx
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
  pi.on("turn_end", async (_event: any, ctx: any) => {
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
  // UI strategy:
  //   - Try ctx.ui.custom() to show a live progress panel with spinner + log
  //   - Fall back to ctx.ui.setStatus() if custom UI is unavailable
  // ============================================================
  pi.on("agent_end", async (_event: any, ctx: any) => {
    const cwd = ctx.cwd;

    // Guard 1: Prevent subagent recursion
    if (process.env.PI_SUBAGENT === "1") return;

    // Check if session was aborted (user pressed ESC)
    // Even if aborted, we still write raw/dialogue-summary for context continuity
    const wasAborted = _agentAborted;
    _agentAborted = false;

    const messages = (_event as any)?.messages;

    // Guard 3: Not enough messages for meaningful extraction
    if (!messages || !Array.isArray(messages) || messages.length < 2) return;

    const scriptPath = path.join(HOME, ".pi", "agent", "scripts", "run_extraction.py");

    // 防御性锚定:本轮写入前以 session file 锚点重新解析目录。
    // 若会话中途 reload 导致 session_start 重触发、_sessionDir 被重置,
    // 这里把写入目标纠正回真正的会话目录,避免轮次分裂。
    const anchor = getSessionAnchor(ctx);
    if (anchor) {
      const existing = findExistingSessionDir(cwd, anchor);
      if (existing) _sessionDir = existing;
    }

    // 判定本轮是否为固化轮(每 5 轮):是 → 显示完整进度面板;否 → 仅状态栏轻提示。
    // 非固化轮 extraction 只是写文件(<1s 完成),弹全屏面板会闪一下即消失,体验差。
    const turnsDir = _sessionDir || path.join(PATHS.projectDir(cwd), "turns");
    const summaryFile = path.join(turnsDir, "dialogue-summary.md");
    const roundNo = countSections(safeRead(summaryFile) ?? "") + 1;
    const isConsolidation = roundNo % 5 === 0;

    if (isConsolidation && !wasAborted) {
      // 固化轮且未被中断:显示完整进度面板(spinner + 子代理日志)
      try {
        await runExtractionWithProgress(ctx, scriptPath, messages, cwd);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // If ctx.ui.custom is not available, use simple fallback
        if (msg.includes("not a function") || msg.includes("custom")) {
          await runExtractionSimple(ctx, scriptPath, messages, cwd);
        } else {
          // Real error from the extraction — log it
          console.warn("[memory] extraction UI error:", msg);
          // Still try simple fallback
          try {
            await runExtractionSimple(ctx, scriptPath, messages, cwd);
          } catch { /* already logged */ }
        }
      }
    } else {
      // 非固化轮 或 被中断:仅状态栏提示,不弹面板
      // 被中断时 skipSubagent=true,只写文件不启动子代理
      try {
        await runExtractionSimple(ctx, scriptPath, messages, cwd, wasAborted);
      } catch (e: unknown) {
        console.warn("[memory] extraction failed:", e instanceof Error ? e.message : String(e));
      }
    }

    updateTaskWidget(cwd, ctx);
  });

  // ============================================================
  // session_shutdown:会话结束时补固化(非自动海马体)
  // 海马体(记忆整理)改为手动 /memory-clean 触发,不再自动——
  // 避免频繁会话/长期不用时做无用功、浪费钱。
  // 会话结束只做一件事:若余数(节数 % 5)≥ 3,异步补跑固化子代理,
  // 处理未固化的剩余轮次(短会话 1-2 节不触发)。
  // ============================================================
  pi.on("session_shutdown", async (event: any, ctx: any) => {
    if (!ctx?.cwd) return;
    // 只在真正退出会话时补固化;reload/new/resume/fork 是生命周期内切换
    if (event?.reason !== "quit") return;
    if (process.env.PI_SUBAGENT === "1") return;
    if (!_sessionDir) return;
    try {
      const summaryFile = path.join(_sessionDir, "dialogue-summary.md");
      const summary = fs.readFileSync(summaryFile, "utf-8");
      const remainder = countSections(summary) % 5;
      if (remainder >= CONSOLIDATE_AT_SESSION_END) {
        fs.writeFileSync(
          path.join(_sessionDir, "consolidation-input.md"),
          lastSections(summary, remainder),
          "utf-8",
        );
        spawnConsolidationSubagent(_sessionDir);
      }
    } catch { /* non-fatal — never block session end */ }
  });

  // ============================================================
  // tool_result: auto-convert binary files + compress verbose output
  // ============================================================
  pi.on("tool_result", async (event: any, _ctx: any) => {
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
