import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "./config";

/** Safely read a file; returns null if missing or unreadable. */
export function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Extract all [[Wiki-links]] from Markdown text. */
export function extractLinks(text: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const ref = match[1].split("#")[0].trim();
    if (ref && !links.includes(ref)) links.push(ref);
  }
  return links;
}

/** Common stopwords shared by keyword extraction paths. */
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off", "over",
  "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "just", "because", "but", "and", "or",
  "if", "while", "about", "up", "it", "its", "my", "me", "i", "we",
  "our", "you", "your", "he", "she", "they", "them", "this", "that",
  "these", "those", "what", "which", "who", "whom", "help", "please",
  "want", "need", "like", "know", "think", "make", "get", "go", "come",
  "帮我", "请", "一下", "怎么", "什么", "是", "的", "了", "在", "我",
]);

/**
 * Extract search keywords from text for matching.
 * - English words / identifiers (length >= 2, not stopwords)
 * - CJK 2-grams from contiguous Chinese runs (Chinese has no spaces, so
 *   2-grams are the smallest unit that survives phrasing variations)
 * Capped at 32 keywords to bound matching cost.
 */
export function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const words = new Set<string>();

  for (const m of lower.matchAll(/[a-z][a-z0-9_]{1,}/g)) {
    const w = m[0];
    if (w.length >= 2 && !/^\d+$/.test(w) && !STOPWORDS.has(w)) words.add(w);
  }

  for (const run of lower.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const s = run[0];
    for (let i = 0; i < s.length - 1; i++) {
      const gram = s.slice(i, i + 2);
      if (gram.trim() && !STOPWORDS.has(gram)) words.add(gram);
    }
  }

  return Array.from(words).slice(0, 32);
}

/** Resolve a [[Wiki-link]] to an actual file path. */
export function resolveLink(link: string, cwd: string): string | null {
  // Normalize: strip known prefixes so both `decisions/design.md` and
  // `memories/decisions/design.md` resolve to the same file.
  let l = link.trim();
  if (l.startsWith("memories/")) l = l.slice("memories/".length);
  if (l.startsWith("personal/")) l = l.slice("personal/".length);
  const base = l.endsWith(".md") ? l : `${l}.md`;

  const candidates = [
    path.join(PATHS.memoriesDir(cwd), base),
    path.join(PATHS.projectDir(cwd), base),
    path.join(PATHS.personalDir, base),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Legacy fallback: check old .pi/memory/ location
  const legacyMem = path.join(cwd, ".pi", "memory", base);
  if (fs.existsSync(legacyMem)) return legacyMem;

  return null;
}

/** Recursively find all .md files in a directory, excluding _index.md. */
export function walkMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        results.push(...walkMarkdownFiles(full));
      } else if (item.isFile() && item.name.endsWith(".md") && item.name !== "_index.md") {
        results.push(full);
      }
    }
  } catch { /* dir not found */ }
  return results;
}

/**
 * Build a compact memory directory (scope → category → file names) for
 * project and global memories. Injected into the system prompt so the
 * main LLM knows what memories exist without paying the full _index.md
 * size (which can be tens of KB for memory-heavy projects).
 */
export function readMemoryIndex(cwd: string, maxChars = 2000): string {
  const scopes: [string, string][] = [
    ["项目记忆", PATHS.memoriesDir(cwd)],
    ["全局记忆", PATHS.personalDir],
  ];
  const parts: string[] = [];

  for (const [label, dir] of scopes) {
    if (!fs.existsSync(dir)) continue;
    const files = walkMarkdownFiles(dir);
    if (files.length === 0) continue;

    const byDir = new Map<string, string[]>();
    for (const f of files) {
      const rel = path.relative(dir, f).replace(/\\/g, "/");
      const d = path.dirname(rel);
      if (!byDir.has(d)) byDir.set(d, []);
      byDir.get(d)!.push(path.basename(f).replace(/\.md$/, ""));
    }

    const lines = [`### ${label}`];
    for (const [d, names] of [...byDir.entries()].sort()) {
      const dirLabel = d === "." ? "(顶层)" : `${d}/`;
      const shown = names.slice(0, 12).join(", ");
      const more = names.length > 12 ? ` 等 ${names.length} 个文件` : "";
      lines.push(`- ${dirLabel} ${shown}${more}`);
    }
    parts.push(lines.join("\n"));
  }

  let out = parts.join("\n\n");
  if (out.length > maxChars) {
    out = out.slice(0, maxChars) + "\n…(记忆目录已截断,可对具体主题用 recall 查询)";
  }
  return out;
}

/**
 * Keyword-based search across project + global memory files.
 * Scores each ## section by keyword hits and returns the top results.
 */
export function searchMemories(
  userPrompt: string,
  cwd: string,
  maxResults: number = 5,
): string[] {
  if (!userPrompt || userPrompt.trim().length < 10) return [];

  const keywords = extractKeywords(userPrompt);
  if (keywords.length === 0) return [];

  const results: { file: string; content: string; score: number }[] = [];

  const searchDir = (dir: string, scope: string) => {
    const files = walkMarkdownFiles(dir);
    for (const filePath of files) {
      const content = safeRead(filePath);
      if (!content) continue;

      const lines = content.split("\n");
      let currentSection = "";
      let sectionLines: string[] = [];
      let score = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith("## ")) {
          if (currentSection && score > 0) {
            const preview = sectionLines.slice(0, 5).join("\n").trim();
            if (preview) {
              results.push({
                file: path.relative(dir, filePath).replace(/\\/g, "/"),
                content: `[${scope}] ${currentSection}\n${preview}`,
                score,
              });
            }
          }
          currentSection = line.replace("## ", "").trim();
          sectionLines = [];
          score = 0;
          continue;
        }

        sectionLines.push(line);
        const lower = line.toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw)) score++;
        }
      }

      if (currentSection && score > 0) {
        const preview = sectionLines.slice(0, 5).join("\n").trim();
        if (preview) {
          results.push({
            file: path.relative(dir, filePath).replace(/\\/g, "/"),
            content: `[${scope}] ${currentSection}\n${preview}`,
            score,
          });
        }
      }
    }
  };

  searchDir(PATHS.memoriesDir(cwd), "project");
  searchDir(PATHS.personalDir, "global");

  results.sort((a, b) => b.score - a.score);

  return results
    .slice(0, maxResults)
    .map(r => `- **${r.file}** (${r.score} matches)\n  ${r.content.split("\n").slice(0, 3).join("\n  ")}`);
}

/** Read linked files and extract relevant paragraphs. */
export function readLinkedContent(
  links: string[],
  cwd: string,
  keywords: string[] = [],
): string[] {
  const results: string[] = [];
  // Expand the (usually full-prompt) keyword list into matchable terms:
  // English words + CJK 2-grams. A full user prompt as a single substring
  // would never match a memory line — this fixes that.
  const kw = keywords.flatMap(extractKeywords);

  for (const link of links) {
    const resolved = resolveLink(link, cwd);
    if (!resolved) {
      results.push(`- [[${link}]] → ⚠️ Not found`);
      continue;
    }

    const content = safeRead(resolved);
    if (!content) {
      results.push(`- [[${link}]] → ⚠️ Unreadable`);
      continue;
    }

    const lines = content.split("\n");
    const matchedLines: string[] = [];
    let inHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim() === "---") {
        inHeader = !inHeader;
        continue;
      }
      if (inHeader) continue;

      if (kw.length > 0) {
        const lower = line.toLowerCase();
        if (kw.some((k) => lower.includes(k))) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 3);
          matchedLines.push(`... (lines ${start + 1}-${end})`);
          matchedLines.push(...lines.slice(start, end));
          matchedLines.push("---");
        }
      } else {
        if (i < 20) matchedLines.push(line);
      }
    }

    const summary =
      matchedLines.length > 0
        ? matchedLines.join("\n")
        : "（File exists but no matching sections found for current keywords）";

    results.push(`📄 [[${link}]]\n${summary}`);
  }

  return results;
}
