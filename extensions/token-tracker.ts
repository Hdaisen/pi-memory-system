/**
 * Token Tracker Extension for Pi
 *
 * 每轮对话结束后显示 token 使用详情，并自动记录到 CSV 文件。
 *
 * 显示内容：
 *   - 缓存命中 tokens (cacheRead)
 *   - 缓存未命中 tokens (input)
 *   - 输入总 tokens (input + cacheRead + cacheWrite)
 *   - 缓存命中率
 *   - 输出 tokens
 *   - 耗时
 *
 * CSV 记录：
 *   timestamp, session_id, turn_index, model, cache_hit, cache_miss,
 *   input_total, cache_hit_rate, output_tokens, total_tokens,
 *   duration_ms, cost, cwd
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 每轮开始时间记录
const turnStartTimes = new Map<number, number>();

// 会话启动时间（作为 session_id）
let sessionStartTime = "";

// Python 脚本路径
const PYTHON_SCRIPT = path.join(os.homedir(), ".pi", "agent", "scripts", "token_logger.py");

/**
 * 确保 Python 脚本存在
 */
function ensurePythonScript(): void {
  if (fs.existsSync(PYTHON_SCRIPT)) return;

  const scriptDir = path.dirname(PYTHON_SCRIPT);
  fs.mkdirSync(scriptDir, { recursive: true });

  const scriptContent = `#!/usr/bin/env python3
"""
Token 使用记录器

从 stdin 读取 JSON 数据，追加写入当前目录的 token_usage.csv。
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

    # CSV 文件路径：当前工作目录
    cwd = data.get("cwd", os.getcwd())
    csv_path = os.path.join(cwd, "token_usage.csv")

    # 检查文件是否存在，不存在则写入表头
    file_exists = os.path.exists(csv_path)
    # 检查文件是否为空（新建或刚创建）
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

    print(f"[token-tracker] ✓ 记录已保存 → {csv_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
`;

  fs.writeFileSync(PYTHON_SCRIPT, scriptContent, "utf-8");
  fs.chmodSync(PYTHON_SCRIPT, 0o755);
}

/**
 * 将数据写入 CSV（调用 Python 脚本）
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
    console.error(`[token-tracker] ✗ 保存失败: ${e.message}`);
  }
}

/**
 * 格式化数字（添加千位分隔符）
 */
function formatNum(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * 格式化百分比
 */
function formatPercent(n: number): string {
  return n.toFixed(1) + "%";
}

/**
 * 格式化耗时
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * 格式化费用
 */
function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export default function (pi: ExtensionAPI) {
  // 确保 Python 脚本存在
  ensurePythonScript();

  // ============================================================
  // session_start: 记录会话开始时间
  // ============================================================
  pi.on("session_start", async (_event, _ctx) => {
    sessionStartTime = new Date().toISOString();
    turnStartTimes.clear();
  });

  // ============================================================
  // turn_start: 记录每轮开始时间
  // ============================================================
  pi.on("turn_start", async (event, _ctx) => {
    turnStartTimes.set(event.turnIndex, Date.now());
  });

  // ============================================================
  // turn_end: 显示 token 使用情况并保存到 CSV
  // ============================================================
  pi.on("turn_end", async (event, ctx) => {
    const msg = event.message;
    if (!msg || !msg.usage) return;

    const usage = msg.usage;
    const turnIndex = event.turnIndex;

    // 提取 token 数据
    const cacheHit = usage.cacheRead || 0;
    const cacheMiss = usage.input || 0;
    const cacheWrite = usage.cacheWrite || 0;
    const inputTotal = cacheMiss + cacheHit + cacheWrite;
    const outputTokens = usage.output || 0;
    const totalTokens = inputTotal + outputTokens;

    // 缓存命中率
    const cacheHitRate = inputTotal > 0 ? (cacheHit / inputTotal) * 100 : 0;

    // 计算耗时
    const startTime = turnStartTimes.get(turnIndex);
    const durationMs = startTime ? Date.now() - startTime : null;

    // 获取模型信息
    const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";

    // 获取费用
    const cost = usage.cost?.total || 0;

    // ─── 终端显示 ───
    const lines: string[] = [];

    // 分隔线
    lines.push("");
    lines.push("  ╭─────────────────────────────────────────────╮");
    lines.push("  │           📊 Token 使用统计                 │");
    lines.push("  ├─────────────────────────────────────────────┤");

    // Token 数据
    lines.push(`  │  🎯 缓存命中:    ${formatNum(cacheHit).padStart(12)}  tokens  │`);
    lines.push(`  │  ❌ 缓存未命中:  ${formatNum(cacheMiss).padStart(12)}  tokens  │`);
    lines.push(`  │  📝 缓存写入:    ${formatNum(cacheWrite).padStart(12)}  tokens  │`);
    lines.push(`  │  📥 输入总计:    ${formatNum(inputTotal).padStart(12)}  tokens  │`);
    lines.push(`  │  📤 输出:        ${formatNum(outputTokens).padStart(12)}  tokens  │`);
    lines.push(`  │  📊 合计:        ${formatNum(totalTokens).padStart(12)}  tokens  │`);
    lines.push("  ├─────────────────────────────────────────────┤");

    // 缓存命中率（带颜色指示）
    const rateStr = formatPercent(cacheHitRate);
    const rateBar = cacheHitRate >= 80 ? "🟢" : cacheHitRate >= 50 ? "🟡" : "🔴";
    lines.push(`  │  ${rateBar} 缓存命中率:  ${rateStr.padStart(12)}          │`);

    // 耗时
    if (durationMs !== null) {
      lines.push(`  │  ⏱️  耗时:        ${formatDuration(durationMs).padStart(12)}          │`);
    }

    // 费用
    if (cost > 0) {
      lines.push(`  │  💰 费用:        ${formatCost(cost).padStart(12)}          │`);
    }

    lines.push("  ╰─────────────────────────────────────────────╯");
    lines.push("");

    // 输出到 stderr（不影响主输出）
    console.error(lines.join("\n"));

    // ─── 保存到 CSV ───
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
