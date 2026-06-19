/**
 * Token Tracker Extension for Pi
 *
 * Displays cumulative token usage in the footer.
 * Updates only at turn_end, not during tool calls.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  let enabled = true;

  // Cumulative stats (updated at turn_end only)
  let totalCacheHit = 0;
  let totalCacheMiss = 0;
  let totalCacheWrite = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let lastTurnDuration: number | null = null;
  let turnStartTime = 0;
  let turnCount = 0;

  // Format numbers compactly
  const fmt = (n: number): string => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  // Register toggle command
  pi.registerCommand("token-tracker", {
    description: "Toggle token tracker footer",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      ctx.ui.notify(`Token tracker ${enabled ? "enabled" : "disabled"}`, "info");
    },
  });

  // Set up footer
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          if (!enabled) return [];

          const parts: string[] = [];

          // Total input = cacheHit + cacheMiss + cacheWrite
          const totalInput = totalCacheHit + totalCacheMiss + totalCacheWrite;

          // Cache hit rate
          const hitRate = totalInput > 0 ? (totalCacheHit / totalInput) * 100 : 0;
          const hitColor = hitRate >= 80 ? "success" : hitRate >= 50 ? "warning" : "error";
          parts.push(theme.fg(hitColor, `Cache:${hitRate.toFixed(0)}%`));

          // Input/Output
          parts.push(theme.fg("dim", `In:${fmt(totalInput)}`));
          parts.push(theme.fg("dim", `Out:${fmt(totalOutput)}`));

          // Cost
          if (totalCost > 0) {
            parts.push(theme.fg("dim", `$${totalCost.toFixed(4)}`));
          }

          // Turn count and last duration
          if (turnCount > 0) {
            parts.push(theme.fg("dim", `#${turnCount}`));
            if (lastTurnDuration !== null) {
              const dur = lastTurnDuration < 1000
                ? `${lastTurnDuration}ms`
                : `${(lastTurnDuration / 1000).toFixed(1)}s`;
              parts.push(theme.fg("dim", dur));
            }
          }

          const line = parts.join(" ");
          return [truncateToWidth(line, width)];
        },
      };
    });
  });

  // Track turn start (just record time)
  pi.on("turn_start", async (_event, _ctx) => {
    turnStartTime = Date.now();
  });

  // Update stats at turn_end (not during tool calls)
  pi.on("turn_end", async (event, ctx) => {
    const msg = event.message;
    if (!msg || !msg.usage) return;

    const usage = msg.usage;

    // Accumulate stats
    totalCacheHit += usage.cacheRead || 0;
    totalCacheMiss += usage.input || 0;
    totalCacheWrite += usage.cacheWrite || 0;
    totalOutput += usage.output || 0;
    totalCost += usage.cost?.total || 0;
    turnCount++;

    // Calculate duration
    if (turnStartTime > 0) {
      lastTurnDuration = Date.now() - turnStartTime;
    }

    // Force footer re-render
    ctx.ui.setStatus("token-tracker", `${turnCount} turns`);
  });
}
