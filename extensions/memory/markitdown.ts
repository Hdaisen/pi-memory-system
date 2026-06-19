import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

let _wslSymlinkChecked = false;

/**
 * Create a WSL symlink from ~/.pi/agent/memory to the Windows path
 * when the WSL username differs from the Windows username.
 * This ensures bash commands (which run in WSL) can find memory files.
 * Cached: only runs execSync once per process.
 * 
 * Note: This function is only relevant on Windows with WSL.
 * On Linux/macOS, it does nothing.
 */
export function ensureWslSymlink(): void {
  if (_wslSymlinkChecked) return;
  _wslSymlinkChecked = true;
  
  // Skip on non-Windows platforms
  if (os.platform() !== 'win32') return;
  
  try {
    // Check if WSL is available
    const wslPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe");
    if (!fs.existsSync(wslPath)) return;

    // Get WSL username
    const wslUser = execSync(`"${wslPath}" whoami`, { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "ignore"] }).trim();
    const winUser = process.env.USERNAME || "";
    if (!wslUser || !winUser) return;
    if (wslUser === winUser) return;

    // Paths (use WSL paths inside WSL)
    const winMemoryPath = `/mnt/c/Users/${winUser}/.pi/agent/memory`;
    const wslMemoryPath = `/home/${wslUser}/.pi/agent/memory`;

    // Check if symlink already exists
    try {
      const existing = execSync(
        `"${wslPath}" readlink "${wslMemoryPath}" 2>/dev/null || echo NOT_LINK`,
        { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
      if (existing === winMemoryPath) return;
    } catch {}

    // Create parent dir and symlink — use wsl default shell, no -e flag (Windows doesn't understand single quotes)
    execSync(
      `"${wslPath}" mkdir -p /home/${wslUser}/.pi/agent`,
      { encoding: "utf8", timeout: 10000 }
    );
    execSync(
      `"${wslPath}" ln -sf "${winMemoryPath}" "${wslMemoryPath}"`,
      { encoding: "utf8", timeout: 10000 }
    );
  } catch (e) {
    // WSL not available or command failed — not critical, suppress
  }
}

// Formats that need conversion (binary, unreadable by read tool)
const BINARY_EXTENSIONS = new Set([
  ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".epub", ".msg",
]);

export function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Convert a binary file to Markdown via MarkItDown.
 * Returns Markdown text on success, or null if conversion fails.
 * 
 * On Windows: Uses WSL with markitdown installed in ~/.markitdown-venv/
 * On Linux/macOS: Uses local markitdown command if available
 */
export function convertWithMarkitdown(filePath: string): string | null {
  try {
    const platform = os.platform();
    
    if (platform === 'win32') {
      // Windows with WSL
      const wslExe = process.env.WSL_EXE || "wsl.exe";
      
      // Convert Windows path → WSL path via wslpath
      const wslPath = execSync(
        `${wslExe} wslpath -u "${filePath.replace(/\\/g, "/")}"`,
        { encoding: "utf-8", timeout: 5000 },
      ).trim();

      if (!wslPath) return null;

      // Run markitdown in WSL
      const markitdownCmd = `${wslExe} ~/.markitdown-venv/bin/markitdown "${wslPath}"`;
      const mdOutput = execSync(markitdownCmd, {
        encoding: "utf-8",
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024, // 50MB max output
      });

      return mdOutput || null;
    } else {
      // Linux/macOS - try local markitdown command
      // First check if markitdown is available in PATH
      try {
        execSync('which markitdown', { encoding: "utf-8", timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
      } catch {
        // markitdown not found in PATH
        return null;
      }
      
      // Run markitdown locally
      const markitdownCmd = `markitdown "${filePath}"`;
      const mdOutput = execSync(markitdownCmd, {
        encoding: "utf-8",
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024, // 50MB max output
      });

      return mdOutput || null;
    }
  } catch {
    return null;
  }
}
