import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { HOME } from "./config";
import { safeRead } from "./utils";

export function registerCommands(pi: ExtensionAPI): void {
  const SUBAGENT_MODEL_FILE = path.join(HOME, ".pi", "agent", "memory", "subagent-model.txt");

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
        `Subagent model (current: ${current}):`,
        options,
      );

      if (!choice) return;

      if (choice === "(default)") {
        // Remove file → run_extraction.py uses no --model flag
        try { fs.unlinkSync(SUBAGENT_MODEL_FILE); } catch {}
        ctx.ui.notify("Subagent model reset to default", "info");
      } else {
        fs.writeFileSync(SUBAGENT_MODEL_FILE, choice, "utf-8");
        ctx.ui.notify(`Subagent model set to: ${choice}`, "info");
      }
    },
  });
}
