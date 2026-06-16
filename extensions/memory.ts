/**
 * Pi Memory System Extension
 *
 * A three-layer Markdown memory system for Pi coding agent.
 * - Core Prompt: identity & principles (global, agent-level)
 * - Session Notebook: active tasks & context (per project)
 * - Long-term Memory: facts, preferences, decisions, events (project + global)
 *
 * @see https://github.com/Hdaisen/pi-memory-system
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureWslSymlink } from "./memory/markitdown";
import { registerHooks } from "./memory/hooks";
import { registerTools } from "./memory/tools";
import { registerCommands } from "./memory/commands";

// Suppress Node.js SQLite ExperimentalWarning from context-mode's MCP bridge child process.
process.env.NODE_NO_WARNINGS = "1";

export default function (pi: ExtensionAPI) {
  ensureWslSymlink();
  registerHooks(pi);
  registerTools(pi);
  registerCommands(pi);
}
