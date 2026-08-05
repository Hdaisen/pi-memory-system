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
        options.map((id, i) => ({ id: String(i), label: id })),
      );
      if (!choice) return;

      const selected = options[Number(choice)];
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

      let cmd = `pi -p --no-session --tools read,write,edit,remember,recall,forget,supersede`;
      if (model && model !== "(default)") {
        cmd += ` --model "${model}"`;
      }
      cmd += ` --append-system-prompt "${CLEANER_PROMPT}"`;

      const prompt =
        "记忆维护（海马体整理）。扫描当前项目的长期记忆（memories/）与全局记忆（personal/）并执行清理：" +
        "修复格式污染、合并重复条目、supersede 过期/矛盾条目、报告死链与空文件。" +
        "不碰 notebook.md（主 LLM 独家维护），不碰 turns/ 短期记忆。最后输出清理报告。";

      console.log("🧹 Running memory cleaner subagent...");
      return new Promise<void>((resolve) => {
        const child = spawn(cmd, {
          shell: true,
          cwd,
          env: { ...process.env, PI_SUBAGENT: "1" },
          stdio: ["pipe", "inherit", "inherit"],
        });
        child.stdin?.write(prompt);
        child.stdin?.end();
        child.on("exit", (code) => {
          console.log(code === 0
            ? "✅ Memory cleaner finished"
            : `⚠️ Memory cleaner exited with code ${code}`);
          resolve();
        });
        child.on("error", (err) => {
          console.error("❌ Failed to spawn memory cleaner: " + err.message);
          resolve();
        });
      });
    },
  });
}
