/**
 * Token Tracker Extension for Pi
 *
 * Displays token usage in the footer (persistently at bottom of terminal).
 * Shows: cache hit rate, input tokens, output tokens, cost.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

interface TurnStats {
  cacheHit: number;
  cacheMiss: number;
  cacheWrite: number;
  input: number;
  output: number;
  cost: number;
  duration: number | null;
  turnStart: number;
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let currentTurn: TurnStats | null = null;
  let turnIndex = 0;

  // Format numbers compactly
  const fmt = (n: number): string => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  // Format duration
  const fmtDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
  };

  // Calculate cache hit rate
  const getHitRate = (stats: TurnStats): number => {
    const total = stats.cacheHit + stats.cacheMiss + stats.cacheWrite;
    return total > 0 ? (stats.cacheHit / total) * 100 : 0;
  };

  // Register toggle command
  pi.registerCommand("token-tracker", {
    description: "Toggle token tracker footer",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      if (enabled) {
        ctx.ui.notify("Token tracker enabled", "info");
      } else {
        ctx.ui.notify("Token tracker disabled", "info");
      }
    },
  });

  // Set up footer
  pi.on("session_start", async (_event, ctx) => {
    if (!enabled) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          if (!enabled) return [];

          // Aggregate stats from session
          let totalInput = 0;
          let totalOutput = 0;
          let totalCacheRead = 0;
          let totalCost = 0;

          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              totalInput += m.usage.input || 0;
              totalOutput += m.usage.output || 0;
              totalCacheRead += m.usage.cacheRead || 0;
              totalCost += m.usage.cost?.total || 0;
            }
          }

          // Build status line
          const parts: string[] = [];

          // Cache hit rate
          const totalTokens = totalInput + totalCacheRead;
          const hitRate = totalTokens > 0 ? (totalCacheRead / totalTokens) * 100 : 0;
          const hitColor = hitRate >= 80 ? "success" : hitRate >= 50 ? "warning" : "error";
          parts.push(theme.fg(hitColor, `Cache:${hitRate.toFixed(0)}%`));

          // Input/Output
          parts.push(theme.fg("dim", `In:${fmt(totalInput)}`));
          parts.push(theme.fg("dim", `Out:${fmt(totalOutput)}`));

          // Cost
          if (totalCost > 0) {
            parts.push(theme.fg("dim", `$${totalCost.toFixed(3)}`));
          }

          // Current turn stats (if in progress)
          if (currentTurn) {
            const turnRate = getHitRate(currentTurn);
            parts.push(theme.fg("accent", `| Turn:${turnRate.toFixed(0)}%`));

            if (currentTurn.duration !== null) {
              parts.push(theme.fg("dim", fmtDuration(currentTurn.duration)));
            }
          }

          const line = parts.join(" ");
          return [truncateToWidth(line, width)];
        },
      };
    });
  });

  // Track turn start
  pi.on("turn_start", async (event, _ctx) => {
    turnIndex = event.turnIndex;
    currentTurn = {
      cacheHit: 0,
      cacheMiss: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
      cost: 0,
      duration: null,
      turnStart: Date.now(),
    };
  });

  // Track turn end
  pi.on("turn_end", async (event, ctx) => {
    const msg = event.message;
    if (!msg || !msg.usage) return;

    const usage = msg.usage;
    currentTurn = {
      cacheHit: usage.cacheRead || 0,
      cacheMiss: usage.input || 0,
      cacheWrite: usage.cacheWrite || 0,
      input: (usage.input || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0),
      output: usage.output || 0,
      cost: usage.cost?.total || 0,
      duration: currentTurn ? Date.now() - currentTurn.turnStart : null,
      turnStart: currentTurn?.turnStart || Date.now(),
    };

    // Request render to update footer
    ctx.ui.setStatus("token-tracker", "");
  });

  // Clear turn stats when idle
  pi.on("agent_end", async () => {
    // Keep stats visible for a bit, then clear
    setTimeout(() => {
      currentTurn = null;
    }, 5000);
  });
}
