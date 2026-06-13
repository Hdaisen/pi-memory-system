/**
 * Auto — autonomous task execution loop for Pi
 *
 * Maps Ralph's loop pattern to Pi's extension system:
 *   ralph.sh (bash)  →  auto.ts (extension via agent_end + sendUserMessage)
 *   prd.json          →  spec tasks.md
 *   <promise>COMPLETE →  tasks.md 全部 [x]
 *   claude --print    →  LLM worker via sendUserMessage
 *
 * The extension is the orchestrator. It reads tasks.md, picks pending tasks,
 * and dispatches them to the LLM one at a time. After each turn, agent_end
 * fires → extension checks if task was completed → next or pause.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================
// State
// ============================================================

interface AutoSession {
  specDir: string;
  tasksFile: string;
  stateFile: string;
  active: boolean;
  lastTask: string;
  completedCount: number;
  totalTasks: number;
  stopped: boolean;
}

function loadState(stateFile: string): Partial<AutoSession> | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch { return null; }
}

function saveState(s: AutoSession): void {
  fs.mkdirSync(path.dirname(s.stateFile), { recursive: true });
  fs.writeFileSync(s.stateFile, JSON.stringify(s, null, 2), "utf-8");
}

function clearState(cwd: string): void {
  const file = path.join(cwd, ".auto-state.json");
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

// ============================================================
// Tasks.md parser
// ============================================================

interface TaskItem {
  id: string;
  line: string;
  lineNumber: number;
  phase?: string;
}

function parseTasks(tasksFile: string): {
  pending: TaskItem[];
  all: TaskItem[];
  phaseNames: string[];
} {
  const content = fs.readFileSync(tasksFile, "utf-8");
  const lines = content.split("\n");
  const all: TaskItem[] = [];
  const pending: TaskItem[] = [];
  const phaseNames: string[] = [];
  let currentPhase = "";

  const taskRegex = /^(- )\[( |x)\] (T\d+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const phaseMatch = line.match(/^## (Phase .+)/);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      phaseNames.push(currentPhase);
      continue;
    }

    const m = line.match(taskRegex);
    if (m) {
      const id = m[3];
      const isDone = m[2] === "x";
      all.push({ id, line, lineNumber: i + 1, phase: currentPhase });
      if (!isDone) pending.push({ id, line, lineNumber: i + 1, phase: currentPhase });
    }
  }

  return { pending, all, phaseNames };
}

// ============================================================
// Find latest spec with tasks.md
// ============================================================

function findLatestSpec(cwd: string): string | null {
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git")) ||
        fs.existsSync(path.join(dir, "AGENTS.md")) ||
        fs.existsSync(path.join(dir, "CLAUDE.md"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }

  const specsDir = path.join(dir, "specs");
  if (!fs.existsSync(specsDir)) return null;

  const entries = fs.readdirSync(specsDir, { withFileTypes: true });
  const specDirs = entries
    .filter(e => e.isDirectory())
    .map(e => path.join(specsDir, e.name))
    .sort()
    .reverse();

  for (const sd of specDirs) {
    if (fs.existsSync(path.join(sd, "tasks.md"))) return sd;
  }
  return null;
}

// ============================================================
// Status bar widget
// ============================================================

function updateWidget(ctx: any, s: AutoSession): void {
  const lines = [
    `📋 Auto: ${s.completedCount}/${s.totalTasks} tasks`,
    s.stopped ? "⏸️ Paused" : s.active ? "▶️ Active" : "",
  ].filter(Boolean);
  ctx.ui.setWidget("auto", lines.length > 0 ? lines : ["📋 Auto: idle"]);
}

// ============================================================
// Extension
// ============================================================

export default function (pi: ExtensionAPI) {
  const sessions = new Map<string, AutoSession>();

  function getOrCreateSession(cwd: string): AutoSession | null {
    const cached = sessions.get(cwd);
    if (cached) return cached;

    const stateFile = path.join(cwd, ".auto-state.json");
    const saved = loadState(stateFile);
    if (saved?.active && saved.specDir && saved.tasksFile) {
      const session: AutoSession = {
        specDir: saved.specDir,
        tasksFile: saved.tasksFile,
        stateFile,
        active: saved.active ?? false,
        lastTask: saved.lastTask ?? "",
        completedCount: saved.completedCount ?? 0,
        totalTasks: saved.totalTasks ?? 0,
        stopped: saved.stopped ?? false,
      };
      sessions.set(cwd, session);
      return session;
    }
    return null;
  }

  // Auto-run marker — agent_end detects new tasks.md and starts the loop
  function setAutoRun(cwd: string, description: string): void {
    const file = path.join(cwd, ".auto-autorun.json");
    fs.writeFileSync(file, JSON.stringify({ description, createdAt: Date.now() }), "utf-8");
  }
  function clearAutoRun(cwd: string): void {
    try { fs.unlinkSync(path.join(cwd, ".auto-autorun.json")); } catch {}
  }
  function hasAutoRun(cwd: string): boolean {
    try { return fs.existsSync(path.join(cwd, ".auto-autorun.json")); } catch { return false; }
  }

  // ============================================================
  // Commands
  // ============================================================

  pi.registerCommand("auto", {
    description: "Autonomous task execution loop. Usage: /auto do <description> | run | status | stop | resume",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const parts = (args ?? "").trim().split(/\s+/);
      const subcmd = parts[0]?.toLowerCase() || "status";

      switch (subcmd) {

        // ========== /auto do <description> ==========
        case "do": {
          const description = parts.slice(1).join(" ");
          if (!description) {
            ctx.ui.notify("Usage: /auto do <description of what to implement>", "warn");
            return;
          }

          setAutoRun(cwd, description);
          ctx.ui.notify(`Auto: generating spec + tasks for: ${description}`, "info");

          pi.sendUserMessage(
            `📋 [Auto] Generate a feature specification and task breakdown for:\n\n` +
            `> ${description}\n\n` +
            "Use **@ifi/pi-spec** to:\n" +
            "1. Run `/spec:init` to initialize the spec workspace (if not already done)\n" +
            "2. Run `/spec:specify` to create the feature spec based on the description above\n" +
            "3. Run `/spec:tasks` to generate a structured tasks.md from the spec\n\n" +
            "Once tasks.md is generated, the auto loop will **automatically start executing** the tasks.\n" +
            "Make sure tasks.md follows the format with `[ ] T001` style checkboxes."
          );
          return;
        }

        // ========== /auto run ==========
        case "run": {
          const specDir = findLatestSpec(cwd);
          if (!specDir) {
            ctx.ui.notify("No spec with tasks.md found in specs/", "error");
            return;
          }

          const tasksFile = path.join(specDir, "tasks.md");
          const { pending, all } = parseTasks(tasksFile);

          if (pending.length === 0) {
            ctx.ui.notify("All tasks already completed!", "info");
            clearState(cwd);
            sessions.delete(cwd);
            ctx.ui.setWidget("auto", ["📋 Auto: all complete!"]);
            return;
          }

          const session: AutoSession = {
            specDir,
            tasksFile,
            stateFile: path.join(cwd, ".auto-state.json"),
            active: true,
            lastTask: "",
            completedCount: all.length - pending.length,
            totalTasks: all.length,
            stopped: false,
          };
          sessions.set(cwd, session);
          saveState(session);
          updateWidget(ctx, session);

          const first = pending[0];
          ctx.ui.notify(`Auto: ${session.completedCount}/${session.totalTasks} — starting ${first.id}`, "info");
          pi.sendUserMessage(
            `🎯 [Auto] Implement task **${first.id}** from ${path.basename(specDir)}:\n\n` +
            `Phase: *${first.phase || "—"}*\n\n` +
            `Read \`${tasksFile}\` (line ${first.lineNumber}) for the full task description and acceptance criteria.\n` +
            `\`\`\`\n${first.line}\n\`\`\`\n\n` +
            "**Rules:**\n" +
            "1. Implement ONLY this one task\n" +
            "2. After completing, mark it as `[x]` in tasks.md\n" +
            "3. Run typecheck/tests — **do NOT commit broken code**\n" +
            "4. If blocked, note the reason in a comment in tasks.md and stop"
          );
          return;
        }

        // ========== /auto stop ==========
        case "stop": {
          const session = getOrCreateSession(cwd);
          if (!session) {
            ctx.ui.notify("No active auto session.", "info");
            return;
          }
          session.active = false;
          session.stopped = true;
          saveState(session);
          updateWidget(ctx, session);
          ctx.ui.notify("Auto paused.", "info");
          return;
        }

        // ========== /auto resume ==========
        case "resume": {
          const session = getOrCreateSession(cwd);
          if (!session) {
            ctx.ui.notify("No saved auto session found.", "info");
            return;
          }
          session.active = true;
          session.stopped = false;
          saveState(session);

          const { pending, all } = parseTasks(session.tasksFile);
          session.completedCount = all.length - pending.length;
          saveState(session);
          updateWidget(ctx, session);

          if (pending.length === 0) {
            ctx.ui.notify("All tasks complete! Clearing session.", "info");
            clearState(cwd);
            sessions.delete(cwd);
            return;
          }

          const next = pending[0];
          ctx.ui.notify(`Auto resumed: next up ${next.id}`, "info");
          pi.sendUserMessage(
            `🎯 [Auto] Resume — implement task **${next.id}**:\n\n` +
            `\`\`\`\n${next.line}\n\`\`\`\n\n` +
            "Full details in `" + session.tasksFile + "`.\n" +
            "Mark as `[x]` when done. One task only."
          );
          return;
        }

        // ========== /auto status ==========
        default:
        case "status": {
          const specDir = findLatestSpec(cwd);
          const session = getOrCreateSession(cwd);

          let msg = "## Auto Status\n\n";
          if (specDir) {
            const { all, pending } = parseTasks(path.join(specDir, "tasks.md"));
            msg += `Spec: \`${path.basename(specDir)}\`\n`;
            msg += `Tasks: ${all.length} total, ${pending.length} pending\n\n`;
            if (pending.length > 0) {
              msg += `Next up: \`${pending[0].line.trim()}\`\n`;
            }
            if (session) {
              msg += `\nSession: ${session.active ? "▶️ Active" : session.stopped ? "⏸️ Paused" : "💤 Idle"}\n`;
              msg += `Completed: ${session.completedCount}/${session.totalTasks}\n`;
            }
          } else {
            msg += "No spec with tasks.md found.\n";
            msg += "Run `/auto do <description>` to create and execute a feature.\n";
          }
          ctx.ui.notify(msg, "info");
          return;
        }
      }
    },
  });

  // ============================================================
  // agent_end — the loop driver
  // ============================================================
  pi.on("agent_end", async (_event, ctx) => {
    const cwd = ctx.cwd;
    const session = getOrCreateSession(cwd);

    // Check for auto-run: tasks.md just created via /auto do
    if (!session || !session.active) {
      if (hasAutoRun(cwd)) {
        const specDir = findLatestSpec(cwd);
        if (specDir) {
          const tf = path.join(specDir, "tasks.md");
          if (fs.existsSync(tf)) {
            clearAutoRun(cwd);
            ctx.ui.notify(`Auto: tasks.md detected in ${path.basename(specDir)}, starting...`, "info");

            const { pending, all } = parseTasks(tf);
            if (pending.length > 0) {
              const s: AutoSession = {
                specDir,
                tasksFile: tf,
                stateFile: path.join(cwd, ".auto-state.json"),
                active: true,
                lastTask: "",
                completedCount: all.length - pending.length,
                totalTasks: all.length,
                stopped: false,
              };
              sessions.set(cwd, s);
              saveState(s);
              updateWidget(ctx, s);

              const first = pending[0];
              pi.sendUserMessage(
                `🎯 [Auto] Auto-starting execution. First task: **${first.id}**:\n\n` +
                `\`\`\`\n${first.line}\n\`\`\`\n\n` +
                "Full details in `" + tf + "`.\n" +
                "Implement this task and mark it `[x]` when done."
              );
            }
            return;
          }
        }
      }
      return;
    }

    if (session.stopped) return;

    // Re-read tasks.md to check progress
    const { pending, all } = parseTasks(session.tasksFile);
    session.completedCount = all.length - pending.length;
    saveState(session);
    updateWidget(ctx, session);

    if (pending.length === 0) {
      ctx.ui.notify(`✅ Auto: ALL ${all.length} tasks complete!`, "info");
      ctx.ui.setWidget("auto", [`✅ Auto: all ${all.length} tasks done`]);
      clearState(cwd);
      sessions.delete(cwd);
      pi.sendUserMessage(
        `✅ [Auto] All ${all.length} tasks in \`${path.basename(session.specDir)}\` have been completed. ` +
        `Please provide a summary of what was accomplished.`
      );
      return;
    }

    // Check if the dispatched task was completed
    const completedNow = all.filter(t => !t.line.startsWith("- [ ]"));
    const wasCompleted = !session.lastTask || completedNow.some(t => {
      const idMatch = t.line.match(/\[x\] (T\d+)/);
      return idMatch && idMatch[1] === session.lastTask;
    });

    if (!wasCompleted) {
      session.active = false;
      saveState(session);
      ctx.ui.notify(
        `⚠️ Auto paused: ${session.lastTask} was not marked complete.\n` +
        "Use `/auto resume` to retry or `/auto stop` to cancel.",
        "warn"
      );
      return;
    }

    const next = pending[0];
    session.lastTask = next.id;
    saveState(session);

    ctx.ui.notify(`✅ ${session.completedCount}/${session.totalTasks} — next: ${next.id}`, "info");

    pi.sendUserMessage(
      `🎯 [Auto] ✅ Task complete. Next up: **${next.id}**:\n\n` +
      `\`\`\`\n${next.line}\n\`\`\`\n\n` +
      "Full details in `" + session.tasksFile + "`.\n" +
      "Implement this task and mark it `[x]` when done."
    );
  });
}
