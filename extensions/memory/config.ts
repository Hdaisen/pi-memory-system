import * as fs from "node:fs";
import * as path from "node:path";

export const HOME = process.env.HOME || process.env.USERPROFILE || "~";

/**
 * Detect project name by walking up from cwd looking for a marker.
 * Priority: .pi-project file > .git directory > cwd basename
 * Result is cached to avoid repeated filesystem lookups.
 */
let _projNameCache: { cwd: string; name: string } | null = null;
export function getProjectName(cwd: string): string {
  if (_projNameCache && _projNameCache.cwd === cwd) return _projNameCache.name;

  let dir = path.resolve(cwd);
  while (true) {
    // Marker file with explicit project name
    const marker = path.join(dir, ".pi-project");
    if (fs.existsSync(marker)) {
      const name = fs.readFileSync(marker, "utf-8").trim();
      if (name) {
        _projNameCache = { cwd, name };
        return name;
      }
    }
    // Git repo → use parent dir name
    if (fs.existsSync(path.join(dir, ".git"))) {
      _projNameCache = { cwd, name: path.basename(dir) };
      return path.basename(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }

  // Fallback: use cwd basename
  _projNameCache = { cwd, name: path.basename(cwd) };
  return path.basename(cwd);
}

/**
 * Set or correct the project name. Writes a .pi-project marker so
 * the name persists across sessions. The marker is found by the
 * walk-up detection in getProjectName() — writing to any directory
 * above the marker-less zone is sufficient.
 */
export function setProjectName(cwd: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  // Write marker to cwd (walk-up starts from cwd, so nearest wins)
  fs.writeFileSync(path.join(cwd, ".pi-project"), trimmed, "utf-8");
  // Clear cache so next getProjectName re-computes with new state
  _projNameCache = null;
}

export const PATHS = {
  // Global (agent-level)
  corePrompt: path.join(HOME, ".pi", "agent", "memory", "core-prompt.md"),
  rules: path.join(HOME, ".pi", "agent", "memory", "rules.md"),
  personalDir: path.join(HOME, ".pi", "agent", "memory", "personal"),

  // Project-level — centralized under ~/.pi/agent/memory/projects/<name>/
  projectsRoot: path.join(HOME, ".pi", "agent", "memory", "projects"),
  projectDir: (cwd: string) =>
    path.join(HOME, ".pi", "agent", "memory", "projects", getProjectName(cwd)),
  notebook: (cwd: string) =>
    path.join(HOME, ".pi", "agent", "memory", "projects", getProjectName(cwd), "notebook.md"),
  memoriesDir: (cwd: string) =>
    path.join(HOME, ".pi", "agent", "memory", "projects", getProjectName(cwd), "memories"),
  turnsDir: (cwd: string) =>
    path.join(HOME, ".pi", "agent", "memory", "projects", getProjectName(cwd), "turns"),
};
