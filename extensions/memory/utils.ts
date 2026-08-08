import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "./config";

/** Safely read a file; returns null if missing or unreadable. */
/**
 * Extract the last N "### 轮次" sections from a dialogue-summary.md file.
 * Used by the consolidation / hippocampus subagents as their incremental
 * input window: input stays ≤ N sections regardless of total round count,
 * and the subagent system prompt stays stable (prefix-cache friendly).
 */
export function lastSections(text: string, n: number): string {
  const sections = text.split(/(?=^### 轮次 )/m).filter((s) => /^### 轮次 /.test(s));
  return sections.slice(-n).join("\n");
}

/** Count "### 轮次" sections in a dialogue-summary.md file (round count). */
export function countSections(text: string): number {
  if (!text) return 0;
  return text.split(/(?=^### 轮次 )/m).filter((s) => /^### 轮次 /.test(s)).length;
}

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

/** 记忆文件中的一个 ## 条目。 */
export interface MemoryEntry {
  file: string; // relative path from memory dir (with .md)
  section: string; // full ## title
  date?: string;
  confidence?: string;
  tags: string[];
  superseded: boolean;
}

/** superseded 条目标记(兼容 tools.ts 当前格式 + 历史格式)。 */
const SUPERSEDED_MARKERS = [
  /↗\s*\*\*Superseded/,
  /↗\s*\*\*被取代/,
  /\+\s*Superseded\s+by/i,
  /superseded\s*:\s*true/i,
];

/** 解析记忆文件中的 ## 条目 → 结构化 MemoryEntry(含 tags、superseded 状态)。 */
export function parseMemoryEntries(content: string, relativePath: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const sections = content.split(/(?=^## )/m);
  for (const section of sections) {
    const titleMatch = section.match(/^## (.+)/m);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();
    const dateMatch = section.match(/- Date: (\d{4}-\d{2}-\d{2})/);
    const confidenceMatch = section.match(/\[(confirmed|inferred|intuition)\]/);
    const tagsMatch = section.match(/tags:\s*\[([^\]]*)\]/);
    const tags = tagsMatch
      ? tagsMatch[1]
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const superseded = SUPERSEDED_MARKERS.some((re) => re.test(section));
    entries.push({
      file: relativePath,
      section: title,
      date: dateMatch ? dateMatch[1] : undefined,
      confidence: confidenceMatch ? confidenceMatch[1] : undefined,
      tags,
      superseded,
    });
  }
  return entries;
}

/** 提取条目元数据行里的 Related 链接(`Related: [[...]]` 或 `Related: ...`)。 */
export function extractRelatedLinks(text: string): string[] {
  const links: string[] = [];
  const re = /Related:?\s*(.+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const l of extractLinks(m[1])) {
      if (!links.includes(l)) links.push(l);
    }
  }
  return links;
}

/** 分类目录名 → 语义化标签(供认知地图索引展示)。 */
const CATEGORY_LABELS: Record<string, string> = {
  decisions: "决策",
  events: "事件",
  facts: "事实",
  preferences: "偏好",
};

/**
 * Build a cognitive-map memory index for project and global memories.
 * Injected into the system prompt so the main LLM knows what knowledge
 * exists (entry titles + confidence + tags), not just which files exist.
 *
 * - entries grouped by semantic category, active before superseded
 * - budget-aware: stops appending once maxChars is exceeded (head preserved)
 */
export function readMemoryIndex(cwd: string, maxChars = 2500): string {
  const scopes: [string, string][] = [
    ["项目记忆", PATHS.memoriesDir(cwd)],
    ["全局记忆", PATHS.personalDir],
  ];
  const lines: string[] = [];
  let used = 0;
  let truncated = false;

  const pushLine = (l: string) => {
    if (used + l.length + 1 > maxChars) {
      truncated = true;
      return;
    }
    lines.push(l);
    used += l.length + 1;
  };

  for (const [label, dir] of scopes) {
    if (!fs.existsSync(dir)) continue;
    const files = walkMarkdownFiles(dir);
    if (files.length === 0) continue;

    const entries: MemoryEntry[] = [];
    for (const f of files) {
      const rel = path.relative(dir, f).replace(/\\/g, "/");
      const content = safeRead(f);
      if (!content) continue;
      entries.push(...parseMemoryEntries(content, rel));
    }
    if (entries.length === 0) continue;

    // 分类分组:目录名 → 语义标签
    const byCat = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const dirName = path.dirname(e.file);
      const cat = dirName === "." ? "其他" : (CATEGORY_LABELS[dirName] ?? dirName);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(e);
    }

    pushLine(`### ${label}`);
    for (const [cat, items] of [...byCat.entries()].sort()) {
      // 活跃条目在前(按日期倒序),superseded 沉底
      const sortByDate = (arr: MemoryEntry[]) =>
        arr.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      const ordered = [...sortByDate(items.filter((i) => !i.superseded)), ...sortByDate(items.filter((i) => i.superseded))];

      const supersededCount = items.filter((i) => i.superseded).length;
      pushLine(`- **${cat}** · ${items.length} 条`);
      for (const e of ordered) {
        if (e.superseded) continue; // 折叠:只计数,条目明细在 _index.md
        const conf = e.confidence ?? "";
        const date = e.date ? ` ${e.date.slice(5)}` : "";
        const meta = `${conf}${date}`.trim();
        const fileRef = e.file.replace(/^memories\//, "").replace(/\.md$/, "");
        const label = e.section.length > 36 ? e.section.slice(0, 36) + "…" : e.section;
        const tags = e.tags.length > 0 ? ` #${e.tags.slice(0, 3).join(" #")}` : "";
        pushLine(`  - ${label} | ${meta} | ${fileRef}${tags}`);
      }
      if (supersededCount > 0) {
        pushLine(`  - (${supersededCount} 条已 superseded — 见 _index.md)`);
      }
    }
  }

  if (truncated) {
    lines.push("…(记忆索引已截断,可对具体主题用 recall 查询)");
  }
  return lines.join("\n");
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
  if (!userPrompt) return [];

  // 用关键词数而非字符数判断:中文信息密度高,"记忆系统注入问题"(8字符)
  // 是完整查询,但英文 8 字符可能是噪音。有实质关键词即可搜索。
  const keywords = extractKeywords(userPrompt);
  if (keywords.length === 0) return [];

  const results: { file: string; content: string; score: number; related: string[] }[] = [];

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
                related: extractRelatedLinks(sectionLines.join("\n")),
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
            related: extractRelatedLinks(sectionLines.join("\n")),
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
    .map(r => {
      const base = `- **${r.file}** (${r.score} matches)\n  ${r.content.split("\n").slice(0, 3).join("\n  ")}`;
      const related = r.related.length > 0
        ? `\n  ↳ 相关: ${r.related.map((l) => `[[${l}]]`).join(", ")}`
        : "";
      return base + related;
    });
}

// ============================================================
// Skills — procedural memory (triggered by prompt matching)
// ============================================================

export interface Skill {
  name: string;
  description: string;
  filePath: string; // absolute path to SKILL.md
  scope: "project" | "global"; // 存储范围
}

/**
 * Parse SKILL.md frontmatter: extract name and description.
 * Format mirrors Pi's agent skills specification.
 */
function parseSkillFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = match[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  if (!nameMatch || !descMatch) return null;
  return {
    name: nameMatch[1].trim(),
    description: descMatch[1].trim(),
  };
}

/**
 * Scan a skills directory for SKILL.md files, parse frontmatter.
 */
function scanSkillsDir(dir: string, scope: "project" | "global"): Skill[] {
  if (!fs.existsSync(dir)) return [];
  const skills: Skill[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (!item.isDirectory()) continue;
    const skillPath = path.join(dir, item.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const content = safeRead(skillPath);
    if (!content) continue;
    const parsed = parseSkillFrontmatter(content);
    if (parsed) {
      skills.push({
        name: parsed.name,
        description: parsed.description,
        filePath: skillPath,
        scope,
      });
    }
  }
  return skills;
}

/**
 * Scan both project-level and global skills directories.
 * Project skills override global skills with same name.
 */
export function readSkills(cwd: string): Skill[] {
  const globalSkills = scanSkillsDir(PATHS.personalSkillsDir, "global");
  const projectSkills = scanSkillsDir(PATHS.skillsDir(cwd), "project");

  // Merge: project skills override global skills with same name
  const skillMap = new Map<string, Skill>();
  for (const s of globalSkills) skillMap.set(s.name, s);
  for (const s of projectSkills) skillMap.set(s.name, s);

  return Array.from(skillMap.values());
}

/**
 * Match skills against user prompt using keyword overlap.
 * Returns skills whose description contains prompt keywords.
 */
export function matchSkills(userPrompt: string, skills: Skill[]): Skill[] {
  if (!userPrompt || skills.length === 0) return [];
  const keywords = extractKeywords(userPrompt);
  if (keywords.length === 0) return [];

  return skills.filter((skill) => {
    const lower = skill.description.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  });
}

/**
 * Format matched skills for injection into system prompt.
 * Mirrors Pi's agent skills XML format (spec: agentskills.io).
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const items = skills
    .map((s) => `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`)
    .join("\n");
  return `\n<available-memory-skills>\n${items}\n</available-memory-skills>\n`;
}

// ============================================================
// Linked content (wiki-links)
// ============================================================

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
