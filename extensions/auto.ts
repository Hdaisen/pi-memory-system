/**
 * Auto — 自主任务执行循环
 *
 * 读取 spec tasks.md，逐个分发 pending 任务，每轮完成后自动触发下一个。
 * agent_end hook 是循环 driver，sendUserMessage 是分派机制。
 *
 * 底层设计借鉴了 snarktank/ralph 的模式：
 *   bash for 循环 → agent_end hook
 *   prd.json      → tasks.md
 *   COMPLETE 标记 → tasks.md 全部 [x]
 *   claude --print → sendUserMessage
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================
// 状态
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
// tasks.md 解析器
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
// 查找最新有 tasks.md 的 spec
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
// 状态栏组件
// ============================================================

function updateWidget(ctx: any, s: AutoSession): void {
  const lines = [
    `📋 Auto: ${s.completedCount}/${s.totalTasks} 个任务`,
    s.stopped ? "⏸️ 已暂停" : s.active ? "▶️ 执行中" : "",
  ].filter(Boolean);
  ctx.ui.setWidget("auto", lines.length > 0 ? lines : ["📋 Auto: 空闲"]);
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

  // 自动执行标记 —— agent_end 检测到新 tasks.md 产生后自动启动循环
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
  // 命令
  // ============================================================

  pi.registerCommand("auto", {
    description: "自主任务执行循环。用法: /auto do <描述> | run | status | stop | resume",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const parts = (args ?? "").trim().split(/\s+/);
      const subcmd = parts[0]?.toLowerCase() || "status";

      switch (subcmd) {

        // ========== /auto do <描述> ==========
        case "do": {
          const description = parts.slice(1).join(" ");
          if (!description) {
            ctx.ui.notify("用法: /auto do <要做什么的描述>", "warn");
            return;
          }

          setAutoRun(cwd, description);
          ctx.ui.notify(`Auto: 正在生成任务规划: ${description}`, "info");

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
            ctx.ui.notify("在 specs/ 中未找到有 tasks.md 的 spec", "error");
            return;
          }

          const tasksFile = path.join(specDir, "tasks.md");
          const { pending, all } = parseTasks(tasksFile);

          if (pending.length === 0) {
            ctx.ui.notify("所有任务已完成！", "info");
            clearState(cwd);
            sessions.delete(cwd);
            ctx.ui.setWidget("auto", ["✅ Auto: 全部完成"]);
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
          ctx.ui.notify(`Auto: ${session.completedCount}/${session.totalTasks} — 开始执行 ${first.id}`, "info");
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
            ctx.ui.notify("没有活跃的 Auto 会话", "info");
            return;
          }
          session.active = false;
          session.stopped = true;
          saveState(session);
          updateWidget(ctx, session);
          ctx.ui.notify("⏸️ Auto 已暂停", "info");
          return;
        }

        // ========== /auto resume ==========
        case "resume": {
          const session = getOrCreateSession(cwd);
          if (!session) {
            ctx.ui.notify("没有保存的 Auto 会话", "info");
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
            ctx.ui.notify("所有任务已全部完成！清除会话。", "info");
            clearState(cwd);
            sessions.delete(cwd);
            return;
          }

          const next = pending[0];
          ctx.ui.notify(`Auto 已恢复: 下一个任务 ${next.id}`, "info");
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

          let msg = "## Auto 状态\n\n";
          if (specDir) {
            const { all, pending } = parseTasks(path.join(specDir, "tasks.md"));
            msg += `Spec: \`${path.basename(specDir)}\`\n`;
            msg += `任务: 共 ${all.length} 个，待办 ${pending.length} 个\n\n`;
            if (pending.length > 0) {
              msg += `下一个: \`${pending[0].line.trim()}\`\n`;
            }
            if (session) {
              msg += `\n会话: ${session.active ? "▶️ 执行中" : session.stopped ? "⏸️ 已暂停" : "💤 空闲"}\n`;
              msg += `已完成: ${session.completedCount}/${session.totalTasks}\n`;
            }
          } else {
            msg += "未找到有 tasks.md 的 spec。\n";
            msg += "运行 `/auto do <描述>` 来创建并执行一个功能。\n";
          }
          ctx.ui.notify(msg, "info");
          return;
        }
      }
    },
  });

  // ============================================================
  // agent_end — 循环 driver
  // ============================================================
  pi.on("agent_end", async (_event, ctx) => {
    const cwd = ctx.cwd;
    const session = getOrCreateSession(cwd);

    // 检查自动执行标记：/auto do 刚生成 tasks.md
    if (!session || !session.active) {
      if (hasAutoRun(cwd)) {
        const specDir = findLatestSpec(cwd);
        if (specDir) {
          const tf = path.join(specDir, "tasks.md");
          if (fs.existsSync(tf)) {
            clearAutoRun(cwd);
            ctx.ui.notify(`Auto: 检测到 tasks.md (${path.basename(specDir)})，自动启动执行...`, "info");

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

    // 重新读取 tasks.md 检查进度
    const { pending, all } = parseTasks(session.tasksFile);
    session.completedCount = all.length - pending.length;
    saveState(session);
    updateWidget(ctx, session);

    if (pending.length === 0) {
      ctx.ui.notify(`✅ Auto: 全部 ${all.length} 个任务已完成！`, "info");
      ctx.ui.setWidget("auto", [`✅ Auto: ${all.length} 个任务全部完成`]);
      clearState(cwd);
      sessions.delete(cwd);
      pi.sendUserMessage(
        `✅ [Auto] All ${all.length} tasks in \`${path.basename(session.specDir)}\` have been completed. ` +
        `Please provide a summary of what was accomplished.`
      );
      return;
    }

    // 检查上次分发的任务是否已完成
    const completedNow = all.filter(t => !t.line.startsWith("- [ ]"));
    const wasCompleted = !session.lastTask || completedNow.some(t => {
      const idMatch = t.line.match(/\[x\] (T\d+)/);
      return idMatch && idMatch[1] === session.lastTask;
    });

    if (!wasCompleted) {
      session.active = false;
      saveState(session);
      ctx.ui.notify(
        `⚠️ Auto 已暂停: ${session.lastTask} 未标记完成。\n` +
        "使用 `/auto resume` 重试或 `/auto stop` 取消。",
        "warn"
      );
      return;
    }

    const next = pending[0];
    session.lastTask = next.id;
    saveState(session);

    ctx.ui.notify(`✅ ${session.completedCount}/${session.totalTasks} — 下一个: ${next.id}`, "info");

    pi.sendUserMessage(
      `🎯 [Auto] ✅ Task complete. Next up: **${next.id}**:\n\n` +
      `\`\`\`\n${next.line}\n\`\`\`\n\n` +
      "Full details in `" + session.tasksFile + "`.\n" +
      "Implement this task and mark it `[x]` when done."
    );
  });
}
