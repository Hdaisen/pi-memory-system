/**
 * Token Tracker Extension for Pi
 *
 * Displays token usage details after each turn and auto-logs to CSV.
 *
 * Displayed:
 *   - Cache hit tokens
 *   - Cache miss tokens
 *   - Total input tokens
 *   - Cache hit rate
 *   - Output tokens
 *   - Duration
 *   - Cost
 *
 * CSV logging:
 *   timestamp, session_id, turn_index, model, cache_hit, cache_miss,
 *   input_total, cache_hit_rate, output_tokens, total_tokens,
 *   duration_ms, cost, cwd
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Turn start time tracking
const turnStartTimes = new Map<number, number>();

// Session start time (used as session_id)
let sessionStartTime = "";

// Python script path
const PYTHON_SCRIPT = path.join(os.homedir(), ".pi", "agent", "scripts", "token_logger.py");

/**
 * Ensure Python script exists
 */
function ensurePythonScript(): void {
  if (fs.existsSync(PYTHON_SCRIPT)) return;

  const scriptDir = path.dirname(PYTHON_SCRIPT);
  fs.mkdirSync(scriptDir, { recursive: true });

  const scriptContent = `#!/usr/bin/env python3
"""
Token Usage Logger

Reads JSON from stdin and appends a row to token_usage.csv in cwd.
"""

import csv
import json
import os
import sys
from datetime import datetime

CSV_HEADERS = [
    "timestamp",
    "session_id",
    "turn_index",
    "model",
    "cache_hit_tokens",
    "cache_miss_tokens",
    "input_total_tokens",
    "cache_hit_rate",
    "output_tokens",
    "total_tokens",
    "duration_ms",
    "cost_usd",
    "cwd",
]


def main():
    data = json.loads(sys.stdin.read())

    cwd = data.get("cwd", os.getcwd())
    csv_path = os.path.join(cwd, "token_usage.csv")

    file_exists = os.path.exists(csv_path)
    is_empty = not file_exists or os.path.getsize(csv_path) == 0

    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        if is_empty:
            writer.writeheader()
        writer.writerow({
            "timestamp": data.get("timestamp", datetime.now().isoformat()),
            "session_id": data.get("session_id", ""),
            "turn_index": data.get("turn_index", ""),
            "model": data.get("model", ""),
            "cache_hit_tokens": data.get("cache_hit", 0),
            "cache_miss_tokens": data.get("cache_miss", 0),
            "input_total_tokens": data.get("input_total", 0),
            "cache_hit_rate": data.get("cache_hit_rate", ""),
            "output_tokens": data.get("output", 0),
            "total_tokens": data.get("total_tokens", 0),
            "duration_ms": data.get("duration_ms", ""),
            "cost_usd": data.get("cost", ""),
            "cwd": cwd,
        })

    print(f"[token-tracker] logged -> {csv_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
`;

  fs.writeFileSync(PYTHON_SCRIPT, scriptContent, "utf-8");
  fs.chmodSync(PYTHON_SCRIPT, 0o755);
}

/**
 * Save data to CSV via Python script
 */
function saveToCSV(data: Record<string, any>): void {
  try {
    const jsonData = JSON.stringify(data);
    execSync(`python3 "${PYTHON_SCRIPT}"`, {
      input: jsonData,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e: any) {
    console.error(`[token-tracker] save failed: ${e.message}`);
  }
}

/**
 * Format number with comma separators
 */
function formatNum(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Format percentage
 */
function formatPercent(n: number): string {
  return n.toFixed(1) + "%";
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * Format cost
 */
function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Draw a progress bar
 */
function drawBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "[" + "#".repeat(filled) + ".".repeat(empty) + "]";
}

export default function (pi: ExtensionAPI) {
  ensurePythonScript();

  // ============================================================
  // session_start
  // ============================================================
  pi.on("session_start", async (_event, _ctx) => {
    sessionStartTime = new Date().toISOString();
    turnStartTimes.clear();
  });

  // ============================================================
  // turn_start
  // ============================================================
  pi.on("turn_start", async (event, _ctx) => {
    turnStartTimes.set(event.turnIndex, Date.now());
  });

  // ============================================================
  // turn_end: display token stats and save to CSV
  // ============================================================
  pi.on("turn_end", async (event, ctx) => {
    const msg = event.message;
    if (!msg || !msg.usage) return;

    const usage = msg.usage;
    const turnIndex = event.turnIndex;

    // Extract token data
    const cacheHit = usage.cacheRead || 0;
    const cacheMiss = usage.input || 0;
    const cacheWrite = usage.cacheWrite || 0;
    const inputTotal = cacheMiss + cacheHit + cacheWrite;
    const outputTokens = usage.output || 0;
    const totalTokens = inputTotal + outputTokens;

    // Cache hit rate
    const cacheHitRate = inputTotal > 0 ? (cacheHit / inputTotal) * 100 : 0;

    // Duration
    const startTime = turnStartTimes.get(turnIndex);
    const durationMs = startTime ? Date.now() - startTime : null;

    // Model
    const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";

    // Cost
    const cost = usage.cost?.total || 0;

    // ─── Terminal display ───
    const w = 50;
    const lines: string[] = [];

    const border = "+" + "-".repeat(w - 2) + "+";
    const sep = "+" + "-".repeat(w - 2) + "+";

    const center = (text: string): string => {
      const pad = Math.max(0, w - 2 - text.length);
      const left = Math.floor(pad / 2);
      const right = pad - left;
      return "|" + " ".repeat(left) + text + " ".repeat(right) + "|";
    };

    const row = (label: string, value: string): string => {
      const content = `  ${label.padEnd(12)}${value}`;
      const pad = Math.max(0, w - 2 - content.length);
      return "|" + content + " ".repeat(pad) + "|";
    };

    lines.push("");
    lines.push(border);
    lines.push(center("TOKEN USAGE"));
    lines.push(sep);
    lines.push(row("Cache Hit", formatNum(cacheHit).padStart(10) + " tokens"));
    lines.push(row("Cache Miss", formatNum(cacheMiss).padStart(10) + " tokens"));
    lines.push(row("Cache Write", formatNum(cacheWrite).padStart(10) + " tokens"));
    lines.push(row("Input Total", formatNum(inputTotal).padStart(10) + " tokens"));
    lines.push(row("Output", formatNum(outputTokens).padStart(10) + " tokens"));
    lines.push(row("Total", formatNum(totalTokens).padStart(10) + " tokens"));
    lines.push(sep);
    lines.push(row("Hit Rate", formatPercent(cacheHitRate).padStart(10) + " " + drawBar(cacheHitRate)));
    if (durationMs !== null) {
      lines.push(row("Duration", formatDuration(durationMs).padStart(10)));
    }
    if (cost > 0) {
      lines.push(row("Cost", formatCost(cost).padStart(10)));
    }
    lines.push(border);
    lines.push("");

    console.error(lines.join("\n"));

    // ─── Save to CSV ───
    const csvData = {
      timestamp: new Date().toISOString(),
      session_id: sessionStartTime,
      turn_index: turnIndex,
      model: model,
      cache_hit: cacheHit,
      cache_miss: cacheMiss,
      input_total: inputTotal,
      cache_hit_rate: parseFloat(cacheHitRate.toFixed(1)),
      output: outputTokens,
      total_tokens: totalTokens,
      duration_ms: durationMs,
      cost: parseFloat(cost.toFixed(6)),
      cwd: ctx.cwd,
    };

    saveToCSV(csvData);
  });
}
