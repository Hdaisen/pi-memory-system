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

/** Resolve a [[Wiki-link]] to an actual file path. */
export function resolveLink(link: string, cwd: string): string | null {
  // Check project memories first
  const projectMem = path.join(
    PATHS.memoriesDir(cwd),
    link.endsWith(".md") ? link : `${link}.md`,
  );
  if (fs.existsSync(projectMem)) return projectMem;

  // Check project root (for notebook.md etc.)
  const projectRoot = path.join(
    PATHS.projectDir(cwd),
    link.endsWith(".md") ? link : `${link}.md`,
  );
  if (fs.existsSync(projectRoot)) return projectRoot;

  // Check personal (global)
  const personal = path.join(
    PATHS.personalDir,
    link.endsWith(".md") ? link : `${link}.md`,
  );
  if (fs.existsSync(personal)) return personal;

  // Legacy fallback: check old .pi/memory/ location
  const oldProjectDir = path.join(cwd, ".pi", "memory");
  const legacyMem = path.join(oldProjectDir, link.endsWith(".md") ? link : `${link}.md`);
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
 * Read memory index (_index.md) for both project and global scopes.
 * Returns a summary of available memories.
 */
export function readMemoryIndex(cwd: string): string {
  const sections: string[] = [];

  // Project memories index
  const projectIndex = path.join(PATHS.memoriesDir(cwd), "_index.md");
  const projectContent = safeRead(projectIndex);
  if (projectContent) {
    sections.push("### Project Memories\n" + projectContent.trim());
  }

  // Global memories index
  const globalIndex = path.join(PATHS.personalDir, "_index.md");
  const globalContent = safeRead(globalIndex);
  if (globalContent) {
    sections.push("### Global Memories\n" + globalContent.trim());
  }

  return sections.join("\n\n");
}

/**
 * Simple keyword-based semantic search across memory files.
 * Extracts keywords from user input and finds matching paragraphs.
 */
export function searchMemories(
  userPrompt: string,
  cwd: string,
  maxResults: number = 5,
): string[] {
  if (!userPrompt || userPrompt.trim().length < 10) return [];

  // Extract keywords (remove common words, keep significant ones)
  const stopWords = new Set([
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

  const words = userPrompt
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));

  // Also extract Chinese phrases (2-4 chars)
  const chineseChars = userPrompt.match(/[\u4e00-\u9fff]{2,4}/g) || [];
  const keywords = [...new Set([...words, ...chineseChars])];

  if (keywords.length === 0) return [];

  // Search across all memory files
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

        // Track current section
        if (line.startsWith("## ")) {
          // Process previous section
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

        // Score based on keyword matches
        const lower = line.toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw)) {
            score++;
          }
        }
      }

      // Process last section
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

  // Search project memories
  searchDir(PATHS.memoriesDir(cwd), "project");

  // Search global memories
  searchDir(PATHS.personalDir, "global");

  // Sort by score and return top results
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

      if (keywords.length > 0) {
        const lower = line.toLowerCase();
        if (keywords.some((k) => lower.includes(k.toLowerCase()))) {
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
