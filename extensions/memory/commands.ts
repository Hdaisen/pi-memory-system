import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { HOME } from "./config";
import { safeRead } from "./utils";

export function registerCommands(pi: ExtensionAPI): void {
  const SUBAGENT_MODEL_FILE = path.join(HOME, ".pi", "agent", "memory", "subagent-model.txt");
  const CLEANER_PROMPT = path.join(HOME, ".pi", "agent", "agents", "memory-cleaner.md");

  function getSubagentModel(): string {
    const saved = safeRead(SUBAGENT_MODEL_FILE);
    return saved?.trim() || "(default)";
  }

  pi.registerCommand("subagent-model", {
    description: "Pick model for memory-extractor subagent",
    handler: async (_args, ctx) => {
      const current = getSubagentModel();

      // Dynamically load available models from Pi's model registry
      const available = ctx.modelRegistry.getAvailable();
      const modelIds = available.map((m: any) => `${m.provider}/${m.id}`);
      modelIds.sort();

      const options = ["(default)", ...modelIds];

      const choice = await ctx.ui.select(
        `Subagent model (current: ${current})`,
        options,
      );
      if (!choice) return;

      const selected = choice;
      if (!selected) return;

      if (selected === "(default)") {
        fs.rmSync(SUBAGENT_MODEL_FILE, { force: true });
      } else {
        fs.writeFileSync(SUBAGENT_MODEL_FILE, selected, "utf-8");
      }
      console.log(`✓ Subagent model set to: ${selected}`);
    },
  });

  pi.registerCommand("memory-clean", {
    description: "Run memory cleaner subagent — dedupe, supersede and fix memory files",
    handler: async (_args, ctx) => {
      if (!fs.existsSync(CLEANER_PROMPT)) {
        console.error("❌ memory-cleaner.md not found at " + CLEANER_PROMPT);
        return;
      }
      const cwd = ctx.cwd;
      const model = getSubagentModel();

      const isWin = process.platform === "win32";
      // On Windows, use full path to avoid PowerShell PATH issues
      const piPath = process.env.PI_PATH || (isWin ? 'F:\\scoop\\apps\\nodejs\\current\\bin\\pi.ps1' : 'pi');
      let cmd = `"${piPath}" -p --no-session --tools read,write,edit,remember,recall,forget,supersede`;
      if (model && model !== "(default)") {
        cmd += ` --model "${model}"`;
      }
      cmd += ` --append-system-prompt "${CLEANER_PROMPT}"`;
      const isWin = process.platform === "win32";
      const shell = isWin ? "powershell.exe" : undefined;

      const prompt =
        "记忆维护（海马体整理）。扫描当前项目的长期记忆（memories/）与全局记忆（personal/）并执行清理：" +
        "修复格式污染、合并重复条目、supersede 过期/矛盾条目、报告死链与空文件。" +
        "不碰 notebook.md（主 LLM 独家维护），不碰 turns/ 短期记忆。最后输出清理报告。";

      // 后台运行：输出重定向到 maintenance 日志，不阻塞终端，状态栏显示进度
      const maintenanceDir = path.join(HOME, ".pi", "agent", "memory", "maintenance");
      fs.mkdirSync(maintenanceDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const logPath = path.join(maintenanceDir, `clean-${ts}.log`);
      const logFd = fs.openSync(logPath, "a");
      fs.writeSync(logFd, `# Memory cleaner — ${new Date().toISOString()}\n\ncwd: ${cwd}\nmodel: ${model}\n\n`);

      const theme = ctx.ui.theme;
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let i = 0;
      ctx.ui.setStatus("memory-clean", theme.fg("accent", frames[0]) + theme.fg("dim", " memory-clean 运行中…"));
      const timer = setInterval(() => {
        i = (i + 1) % frames.length;
        ctx.ui.setStatus("memory-clean", theme.fg("accent", frames[i]) + theme.fg("dim", " memory-clean 运行中…"));
      }, 120);

      console.log(`🧹 Memory cleaner running in background — log: ${logPath}`);

      const child = spawn(isWin ? "powershell.exe" : "sh", isWin ? ["-Command", cmd] : ["-c", cmd], {
        cwd,
        env: { ...process.env, PI_SUBAGENT: "1" },
        stdio: ["pipe", logFd, logFd],
        detached: true,
      });
      child.stdin?.write(prompt);
      child.stdin?.end();
      child.unref();

      let done = false;
      const finish = (msg: string, type: "info" | "warning" | "error") => {
        if (done) return;
        done = true;
        clearInterval(timer);
        ctx.ui.setStatus("memory-clean", undefined);
        try { fs.closeSync(logFd); } catch { /* already closed */ }
        ctx.ui.notify(msg, type);
      };
      child.on("exit", (code) => {
        finish(code === 0
          ? `✅ Memory cleaner finished — log: ${logPath}`
          : `⚠️ Memory cleaner exited with code ${code} — log: ${logPath}`,
          code === 0 ? "info" : "warning");
      });
      child.on("error", (err) => {
        finish("❌ Failed to spawn memory cleaner: " + err.message, "error");
      });
    },
  });
}
