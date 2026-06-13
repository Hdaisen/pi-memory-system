/**
 * Ralph — autonomous task execution loop for Pi
 *
 * Maps Ralph's bash-driven loop to Pi's extension system:
 *   ralph.sh (bash)  →  ralph.ts (extension via agent_end + sendUserMessage)
 *   prd.json          →  spec tasks.md
 *   <promise>COMPLETE →  tasks.md 全部 [x]
 *   claude --print    →  LLM worker via sendUserMessage
 *
 * The extension is the orchestrator (like ralph.sh). It reads tasks.md,
 * picks pending tasks, and dispatches them to the LLM one at a time.
 * After each turn, agent_end fires → extension checks if task was completed
 * → if yes: dispatch next task → if no: pause.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================
// State
// ============================================================

interface RalphSession {
  specDir: string;         // absolute path to specs/XXX-feature-name/
  tasksFile: string;       // tasks.md path
  stateFile: string;       // .ralph-state.json path
  active: boolean;
  lastTask: string;        // task ID of the most recently dispatched task
  completedCount: number;
  totalTasks: number;
  stopped: boolean;        // manually stopped by user
}

function loadState(stateFile: string): Partial<RalphSession> | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch { return null; }
}

function saveState(s: RalphSession): void {
  fs.mkdirSync(path.dirname(s.stateFile), { recursive: true });
  fs.writeFileSync(s.stateFile, JSON.stringify(s, null, 2), "utf-8");
}

function clearState(cwd: string): void {
  const file = path.join(cwd, ".ralph-state.json");
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

// ============================================================
// Tasks.md parser
// ============================================================

interface TaskItem {
  id: string;
  line: string;          // full line text
  lineNumber: number;    // 1-based line number
  phase?: string;        // Phase header name
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

  // Match: "- [ ] T001 Do something" or "- [x] T002 Done"
  const taskRegex = /^(- )\[( |x)\] (T\d+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track phase headers: "## Phase N: ..."
    const phaseMatch = line.match(/^## (Phase .+)/);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      phaseNames.push(currentPhase);
      continue;
    }

    const m = line.match(taskRegex);
    if (m) {
      const id = m[3]; // e.g. "T001"
      const isDone = m[2] === "x";
      const item: TaskItem = {
        id,
        line,
        lineNumber: i + 1,
        phase: currentPhase,
      };
      all.push(item);
      if (!isDone) pending.push(item);
    }
  }

  return { pending, all, phaseNames };
}

// ============================================================
// Find latest spec with tasks.md
// ============================================================

function findLatestSpec(cwd: string): string | null {
  // Walk up to find project root (has .git or AGENTS.md or CLAUDE.md)
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
    .sort() // alphabetical = numerical order for 001-xxx, 002-yyy
    .reverse(); // latest first

  for (const sd of specDirs) {
    const tasksFile = path.join(sd, "tasks.md");
    if (fs.existsSync(tasksFile)) return sd;
  }

  return null;
}

// ============================================================
// Barry: the status bar widget
// ============================================================

function updateWidget(ctx: any, s: RalphSession): void {
  const lines = [
    `📋 Ralph: ${s.completedCount}/${s.totalTasks} tasks`,
    s.stopped ? "⏸️ Paused" : s.active ? "▶️ Active" : "",
  ].filter(Boolean);
  ctx.ui.setWidget("ralph", lines.length > 0 ? lines : ["📋 Ralph: idle"]);
}

// ============================================================
// Extension
// ============================================================

export default function (pi: ExtensionAPI) {
  // Active session cache (per cwd)
  const sessions = new Map<string, RalphSession>();

  function getOrCreateSession(cwd: string): RalphSession | null {
    // Check memory first
    const cached = sessions.get(cwd);
    if (cached) return cached;

    // Check state file
    const stateFile = path.join(cwd, ".ralph-state.json");
    const saved = loadState(stateFile);
    if (saved?.active && saved.specDir && saved.tasksFile) {
      const session: RalphSession = {
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

  // ============================================================
  // Commands
  // ============================================================

  // Auto-run marker — when set, agent_end will auto-start ralph
  // once a new tasks.md appears
  function setAutoRun(cwd: string, description: string): void {
    const file = path.join(cwd, ".ralph-autorun.json");
    fs.writeFileSync(file, JSON.stringify({ description, createdAt: Date.now() }), "utf-8");
  }
  function clearAutoRun(cwd: string): void {
    try { fs.unlinkSync(path.join(cwd, ".ralph-autorun.json")); } catch {}
  }
  function hasAutoRun(cwd: string): boolean {
    try { return fs.existsSync(path.join(cwd, ".ralph-autorun.json")); } catch { return false; }
  }

  pi.registerCommand("ralph", {
    description: "Autonomous task execution loop. Usage: /ralph do <description> | run | status | stop | resume",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const parts = (args ?? "").trim().split(/\s+/);
      const subcmd = parts[0]?.toLowerCase() || "status";

      switch (subcmd) {

        case "do": {
          const description = parts.slice(1).join(" ");
          if (!description) {
            ctx.ui.notify("Usage: /ralph do <description of what to implement>", "warn");
            return;
          }

          setAutoRun(cwd, description);
          ctx.ui.notify(`Ralph: generating spec + tasks for: ${description}`, "info");

          pi.sendUserMessage(
            `📋 [Ralph] Generate a feature specification and task breakdown for:\n\n` +
            `> ${description}\n\n` +
            "Use **@ifi/pi-spec** to:\n" +
            "1. Run `/spec:init` to initialize the spec workspace (if not already done)\n" +
            "2. Run `/spec:specify` to create the feature spec based on the description above\n" +
            "3. Run `/spec:tasks` to generate a structured tasks.md from the spec\n\n" +
            "Once tasks.md is generated, ralph will **automatically start executing** the tasks.\n" +
            "Make sure the tasks.md follows Ralph-compatible format with `[ ] T001` style checkboxes."
          );
          return;
        }

        case "run": {
          // Find spec
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
            ctx.ui.setWidget("ralph", ["📋 Ralph: all complete!"]);
            return;
          }

          const session: RalphSession = {
            specDir,
            tasksFile,
            stateFile: path.join(cwd, ".ralph-state.json"),
            active: true,
            lastTask: "",
            completedCount: all.length - pending.length,
            totalTasks: all.length,
            stopped: false,
          };
          sessions.set(cwd, session);
          saveState(session);
          updateWidget(ctx, session);

          // Dispatch first task
          const first = pending[0];
          ctx.ui.notify(`Ralph: ${session.completedCount}/${session.totalTasks} — starting ${first.id}`, "info");
          pi.sendUserMessage(
            `🎯 [Ralph] Implement task **${first.id}** from ${path.basename(specDir)}:\n\n` +
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

        case "stop": {
          const session = getOrCreateSession(cwd);
          if (!session) {
            ctx.ui.notify("No active Ralph session.", "info");
            return;
          }
          session.active = false;
          session.stopped = true;
          saveState(session);
          updateWidget(ctx, session);
          ctx.ui.notify("Ralph paused.", "info");
          return;
        }

        case "resume": {
          const session = getOrCreateSession(cwd);
          if (!session) {
            ctx.ui.notify("No saved Ralph session found.", "info");
            return;
          }
          session.active = true;
          session.stopped = false;
          saveState(session);

          // Re-parse to find next pending
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
          ctx.ui.notify(`Ralph resumed: next up ${next.id}`, "info");
          pi.sendUserMessage(
            `🎯 [Ralph] Resume — implement task **${next.id}**:\n\n` +
            `\`\`\`\n${next.line}\n\`\`\`\n\n` +
            "Full details in `" + session.tasksFile + "`.\n" +
            "Mark as `[x]` when done. One task only."
          );
          return;
        }

        default:
        case "status": {
          const { all, pending } = findLatestSpec(cwd)
            ? parseTasks(path.join(findLatestSpec(cwd)!, "tasks.md"))
            : { all: [], pending: [], phaseNames: [] };
          const session = getOrCreateSession(cwd);

          let msg = "## Ralph Status\n\n";
          if (findLatestSpec(cwd)) {
            msg += `Spec: \`${path.basename(findLatestSpec(cwd)!)}\`\n`;
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
            msg += "Run `/spec:specify` to create a feature spec first.\n";
          }
          ctx.ui.notify(msg, "info");
          return;
        }
      }
    },
  });

  // ============================================================
  // agent_end — the loop driver (like bash's for i in 1..N)
  // ============================================================
  pi.on("agent_end", async (_event, ctx) => {
    const cwd = ctx.cwd;
    const session = getOrCreateSession(cwd);

    // Check for auto-run: tasks.md just created via /ralph do
    if (!session || !session.active) {
      if (hasAutoRun(cwd)) {
        const specDir = findLatestSpec(cwd);
        if (specDir) {
          const tf = path.join(specDir, "tasks.md");
          if (fs.existsSync(tf)) {
            clearAutoRun(cwd);
            ctx.ui.notify(`Ralph: tasks.md detected in ${path.basename(specDir)}, auto-starting...`, "info");

            // Build session and start first task
            const { pending, all } = parseTasks(tf);
            if (pending.length > 0) {
              const s: RalphSession = {
                specDir,
                tasksFile: tf,
                stateFile: path.join(cwd, ".ralph-state.json"),
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
                `🎯 [Ralph] Auto-starting execution. First task: **${first.id}**:\n\n` +
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

    // Re-read tasks.md to check if the dispatched task was completed
    const { pending, all } = parseTasks(session.tasksFile);
    session.completedCount = all.length - pending.length;
    saveState(session);
    updateWidget(ctx, session);

    if (pending.length === 0) {
      // All done!
      ctx.ui.notify(`✅ Ralph: ALL ${all.length} tasks complete!`, "info");
      ctx.ui.setWidget("ralph", [`✅ Ralph: all ${all.length} tasks done`]);
      clearState(cwd);
      sessions.delete(cwd);
      pi.sendUserMessage(
        `✅ [Ralph] All ${all.length} tasks in \`${path.basename(session.specDir)}\` have been completed. ` +
        `Please provide a summary of what was accomplished.`
      );
      return;
    }

    // Check if the last dispatched task was actually marked done
    // by looking for the task ID in the completed (marked [x]) items
    const completedNow = all.filter(t => !t.line.startsWith("- [ ]"));
    const wasCompleted = !session.lastTask || completedNow.some(t => {
      // Find the task ID from the line: "- [x] T001 ..."
      const idMatch = t.line.match(/\[x\] (T\d+)/);
      return idMatch && idMatch[1] === session.lastTask;
    });

    if (!wasCompleted) {
      // Task wasn't completed — pause and wait for user
      session.active = false;
      saveState(session);
      ctx.ui.notify(
        `⚠️ Ralph paused: ${session.lastTask} was not marked complete.\n` +
        "Use `/ralph resume` to retry or `/ralph stop` to cancel.",
        "warn"
      );
      return;
    }

    // Mark lastTask as updated, dispatch next
    const next = pending[0];
    session.lastTask = next.id;
    saveState(session);

    ctx.ui.notify(
      `✅ ${session.completedCount}/${session.totalTasks} — next: ${next.id}`,
      "info"
    );

    pi.sendUserMessage(
      `🎯 [Ralph] ✅ Task complete. Next up: **${next.id}**:\n\n` +
      `\`\`\`\n${next.line}\n\`\`\`\n\n` +
      "Full details in `" + session.tasksFile + "`.\n" +
      "Implement this task and mark it `[x]` when done."
    );
  });
}
