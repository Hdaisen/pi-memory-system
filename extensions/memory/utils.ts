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
