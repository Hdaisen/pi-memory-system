/**
 * Content Compression Module (inspired by Headroom's structural compression)
 *
 * Compresses bash tool outputs before they reach the LLM context:
 * - JSON arrays: schema extraction + row dedup
 * - Search/grep results: file clustering + representative samples
 * - Repeated log lines: dedup with frequency annotation
 *
 * Original data is stored in a local CCR (Cache-Compress-Retrieve) store.
 * The LLM can call ccr_retrieve({ hash }) to get back the full original.
 */

import * as crypto from "node:crypto";

// ============================================================
// CCR Store — in-memory, process-scoped
// ============================================================

export class CcrStore {
  private store = new Map<string, string>();

  put(hash: string, content: string): void {
    // Bound store to prevent memory leak (1000 entries)
    if (this.store.size >= 1000) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(hash, content);
  }

  get(hash: string): string | undefined {
    return this.store.get(hash);
  }

  get size(): number {
    return this.store.size;
  }
}

export const ccrStore = new CcrStore();

/** Compute a short content hash (first 12 hex chars of SHA-256). */
function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

// ============================================================
// Content type detection
// ============================================================

type ContentType = "json_array" | "search_output" | "repeated_log" | "plain_text";

interface CompressResult {
  compressed: string;
  contentType: ContentType;
  hash: string;
  stats: Record<string, number>;
}

// ============================================================
// JSON Array Compressor
// ============================================================

/**
 * Detect and compress JSON arrays of objects.
 * Format: [{...}, {...}, ...] where each item shares similar fields.
 *
 * Strategy:
 * 1. Extract schema (union of all keys)
 * 2. Compute diversity score to determine adaptive K (how many rows to keep)
 * 3. Compact format: schema header + tabular rows
 */
function tryCompressJsonArray(text: string): CompressResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;

  let arr: unknown[];
  try {
    arr = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!Array.isArray(arr) || arr.length < 10) return null;
  if (typeof arr[0] !== "object" || arr[0] === null) return null;

  // Only compress arrays of objects
  const objects = arr.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item));
  if (objects.length < 10) return null;

  // Extract schema: union of all keys, ordered by frequency (most common first)
  const keyFreq = new Map<string, number>();
  for (const obj of objects) {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      keyFreq.set(key, (keyFreq.get(key) || 0) + 1);
    }
  }
  const schema = [...keyFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);

  // Adaptive K: determine information saturation point
  const total = objects.length;
  const k = computeAdaptiveK(objects as Record<string, unknown>[], schema, total);

  // Build compact output: schema header + tab-separated rows
  const kept = objects.slice(0, k);
  const dropped = total - k;

  const compactRows = kept.map((obj) => {
    const record = obj as Record<string, unknown>;
    return schema.map((key) => formatCell(record[key])).join("\t");
  });

  const schemaLine = `// schema: ${schema.join(", ")}`;
  const statsLine = `// rows: ${k} kept (${dropped} offloaded — use ccr_retrieve if needed)`;
  const table = compactRows.join("\n");

  const compressed = `${schemaLine}\n${statsLine}\n${table}`;

  // Only use if we actually saved bytes
  if (compressed.length >= text.length) return null;

  const hash = contentHash(text);
  return {
    compressed,
    contentType: "json_array",
    hash,
    stats: { total, kept, dropped, bytesOriginal: text.length, bytesCompressed: compressed.length },
  };
}

/** Format a cell value for the compact table. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "string") {
    // Truncate long strings
    if (value.length > 80) return value.slice(0, 77) + "...";
    return value;
  }
  if (typeof value === "object") return JSON.stringify(value).slice(0, 60);
  return String(value);
}

/**
 * Compute how many rows to keep based on content diversity.
 * Greedy: pick rows that add the most new key-value pairs.
 */
function computeAdaptiveK(
  objects: Record<string, unknown>[],
  schema: string[],
  maxRows: number,
  minRows: number = 5,
): number {
  const hardCap = Math.min(maxRows, 100);
  if (hardCap <= minRows) return Math.min(maxRows, hardCap);

  // Simple diversity metric: unique value combinations across schema keys
  const seen = new Set<string>();
  let uniqueCount = 0;

  for (let i = 0; i < objects.length && uniqueCount < hardCap; i++) {
    const obj = objects[i];
    // Create a signature from the most important (non-null) fields
    const sig = schema
      .filter((key) => obj[key] !== null && obj[key] !== undefined)
      .map((key) => `${key}=${JSON.stringify(obj[key])}`)
      .join("|");

    if (!seen.has(sig)) {
      seen.add(sig);
      uniqueCount++;
    }
  }

  // Keep at least minRows, at most hardCap
  const k = Math.max(minRows, Math.min(uniqueCount + 2, hardCap));
  return k;
}

// ============================================================
// Search/Grep Output Compressor
// ============================================================

/**
 * Detect and compress grep/ripgrep search output.
 * Format: file:line:content or file:line:col:content per line.
 *
 * Strategy:
 * 1. Parse lines into (file, line, content) groups
 * 2. Cluster by file
 * 3. Per file: keep representative samples + count
 */
function tryCompressSearchOutput(text: string): CompressResult | null {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 10) return null;

  // Match both file:line:content and file:line:col:content
  const searchPattern = /^([^:]+):(\d+)(?::(\d+))?:(.+)$/;
  const matches: Array<{ file: string; line: number; content: string }> = [];

  for (const line of lines) {
    const m = line.match(searchPattern);
    if (m) {
      matches.push({ file: m[1], line: parseInt(m[2], 10), content: m[3] });
    }
  }

  // Require at least 5 matched lines and at least 80% match rate
  const matchRate = matches.length / lines.length;
  if (matches.length < 5 || matchRate < 0.6) return null;

  // Cluster by file
  const byFile = new Map<string, string[]>();
  for (const match of matches) {
    if (!byFile.has(match.file)) byFile.set(match.file, []);
    byFile.get(match.file)!.push(match.content);
  }

  // Build compact output
  const totalMatches = matches.length;
  const totalFiles = byFile.size;
  const outputLines: string[] = [];
  const sampleSize = 3;

  for (const [file, contents] of byFile) {
    const count = contents.length;
    // Dedup similar lines within each file
    const unique = [...new Set(contents)];
    if (count > 1) {
      outputLines.push(`${file}: ${count} matches`);
    }
    // Show samples (up to sampleSize)
    for (const sample of unique.slice(0, sampleSize)) {
      outputLines.push(`  ${sample}`);
    }
    if (unique.length > sampleSize) {
      outputLines.push(`  ... (${unique.length - sampleSize} more unique lines)`);
    }
  }

  const statsLine = `// search results: ${totalMatches} matches across ${totalFiles} files (compressed via ccr)`;
  const compressed = `${statsLine}\n${outputLines.join("\n")}`;

  if (compressed.length >= text.length) return null;

  const hash = contentHash(text);
  return {
    compressed,
    contentType: "search_output",
    hash,
    stats: {
      totalMatches,
      totalFiles,
      uniqueLines: matches.length,
      bytesOriginal: text.length,
      bytesCompressed: compressed.length,
    },
  };
}

// ============================================================
// Repeated Log Line Compressor
// ============================================================

/**
 * Compress output with many repeated lines.
 * Count frequency per unique line, collapse repeats with (×N) annotation.
 */
function tryCompressRepeatedLog(text: string): CompressResult | null {
  const lines = text.split("\n");
  if (lines.length < 15) return null;

  // Count line frequencies
  const freq = new Map<string, number>();
  for (const line of lines) {
    // Skip empty lines for frequency counting
    if (line.trim()) {
      freq.set(line, (freq.get(line) || 0) + 1);
    }
  }

  // Check if there are enough repeats to make compression worthwhile
  let repeatCount = 0;
  let repeatLines = 0;
  for (const [_, count] of freq) {
    if (count >= 3) {
      repeatCount++;
      repeatLines += count;
    }
  }

  // Need at least 3 unique lines with repeats, and repeats should be >30% of total
  if (repeatCount < 3 || repeatLines < lines.length * 0.3) return null;

  // Build compact output
  const output: string[] = [];
  for (const [line, count] of freq) {
    if (count >= 3) {
      output.push(`${line} (×${count})`);
    } else {
      for (let i = 0; i < count; i++) {
        output.push(line);
      }
    }
  }

  const statsLine = `// log output: ${lines.length} lines reduced to ${output.length} unique lines (repeats collapsed via ccr)`;
  const compressed = `${statsLine}\n${output.join("\n")}`;

  if (compressed.length >= text.length) return null;

  const hash = contentHash(text);
  return {
    compressed,
    contentType: "repeated_log",
    hash,
    stats: {
      originalLines: lines.length,
      compressedLines: freq.size,
      repeatLines,
      repeatGroups: repeatCount,
      bytesOriginal: text.length,
      bytesCompressed: compressed.length,
    },
  };
}

// ============================================================
// Main entry point
// ============================================================

/** Minimum text length to attempt compression (2KB). */
const COMPRESS_THRESHOLD = 2048;

/**
 * Try to compress text content. Returns null if content type is not
 * recognized or compression wouldn't save enough bytes.
 *
 * Attempt order: JSON array → search output → repeated log
 */
/**
 * Generic fallback compressor: keep head + tail, omit middle.
 * For any large text that didn't match JSON/search/log patterns.
 */
function tryCompressGenericText(text: string): CompressResult | null {
  if (text.length < COMPRESS_THRESHOLD) return null;

  const lines = text.split("\n");
  const totalLines = lines.length;
  if (totalLines < 20) return null;

  const keepHead = 20;
  const keepTail = 10;
  const omitted = totalLines - keepHead - keepTail;

  if (omitted <= 0) return null;

  const head = lines.slice(0, keepHead);
  const tail = lines.slice(-keepTail);
  const compressed = [
    `// ${totalLines} lines total (${omitted} lines omitted — use ccr_retrieve for full)`,
    ...head,
    `// ... ${omitted} lines omitted (ccr_retrieve to recover) ...`,
    ...tail,
  ].join("\n");

  if (compressed.length >= text.length) return null;

  const hash = contentHash(text);
  return {
    compressed,
    contentType: "plain_text",
    hash,
    stats: {
      originalLines: totalLines,
      compressedLines: keepHead + keepTail + 2,
      bytesOriginal: text.length,
      bytesCompressed: compressed.length,
    },
  };
}

/**
 * Try to compress text content. Returns null if content type is not
 * recognized or compression wouldn't save enough bytes.
 *
 * Attempt order: JSON array → search output → repeated log → generic text
 */
export function compressContent(text: string): CompressResult | null {
  if (!text || text.length < COMPRESS_THRESHOLD) return null;

  // Skip if already compressed (has CCR marker)
  if (text.includes("<<ccr:")) return null;

  const result =
    tryCompressJsonArray(text) ??
    tryCompressSearchOutput(text) ??
    tryCompressRepeatedLog(text) ??
    tryCompressGenericText(text);

  if (result) {
    // Store original for retrieval
    ccrStore.put(result.hash, text);
  }

  return result;
}

/** Get stats about the CCR store for monitoring. */
export function getCcrStats(): { size: number } {
  return { size: ccrStore.size };
}

// No-op default export: this file is a library module for memory.ts.
// Without it, Pi would try to load this file as an extension and fail.
export default function () {
  void 0; // no-op
}
