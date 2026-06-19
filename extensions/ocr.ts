/**
 * PaddleOCR Extension for Pi
 *
 * PP-OCRv6 OCR — extract text from images/PDFs.
 * Requires WSL2 with PaddleOCR installed (Windows) or paddleocr-cli in PATH (Linux/macOS).
 *
 * Usage:
 *   /ocr <image_path>      — OCR an image, show results
 *   /ocr <image_url>       — OCR from URL
 *
 * Tools available to the LLM:
 *   ocr_image     — Extract text from an image/PDF
 *   ocr_document  — Extract structured text paragraphs from document image
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import { execSync } from "node:child_process";

interface OCRData {
  texts: string[];
  scores: number[];
  boxes?: number[][];
  det_scores?: number[];
}

/** Convert Windows path (C:\Users\...) to WSL2 path (/mnt/c/Users/...) */
function toWslPath(windowsPath: string): string {
  let p = windowsPath.replace(/^["']|["']$/g, ""); // strip surrounding quotes
  // Convert C:\... to /mnt/c/...
  p = p.replace(/^([A-Za-z]):\\/i, (_, letter: string) => `/mnt/${letter.toLowerCase()}/`);
  p = p.replace(/\\/g, "/");
  return p;
}

function runPaddleOCR(filePath: string): OCRData[] {
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Windows with WSL
    const wslPath = toWslPath(filePath);
    const escaped = wslPath.replace(/'/g, "'\\''");
    const cmd = `wsl bash -ic "export PATH=\\$HOME/.local/bin:\\$PATH && paddleocr-cli '${escaped}'"`;
    const stdout = execSync(cmd, { timeout: 60_000, encoding: "utf-8" });
    return JSON.parse(stdout);
  } else {
    // Linux/macOS - try local paddleocr-cli command
    // First check if paddleocr-cli is available in PATH
    try {
      execSync('which paddleocr-cli', { encoding: "utf-8", timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      throw new Error('paddleocr-cli not found in PATH. Please install it first.');
    }
    
    // Run paddleocr-cli locally
    const escaped = filePath.replace(/'/g, "'\\''");
    const cmd = `paddleocr-cli '${escaped}'`;
    const stdout = execSync(cmd, { timeout: 60_000, encoding: "utf-8" });
    return JSON.parse(stdout);
  }
}

export default function ocrExtension(pi: ExtensionAPI) {
  // Register /ocr command
  pi.registerCommand("ocr", {
    description: "OCR 识别图片/PDF 文字（PP-OCRv6 中文/英文/日文等 50+ 语言）。用法: /ocr <文件路径> [--simple]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const path = parts[0];
      const simple = parts.includes("--simple");

      if (!path) {
        ctx.ui.notify("用法: /ocr <图片路径> [--simple]", "error");
        return;
      }

      ctx.ui.notify(`🧐 OCR 识别中: ${path}`, "info");

      try {
        const data = runPaddleOCR(path);
        if (!data.length || !data[0].texts.length) {
          pi.sendMessage({
            role: "assistant",
            content: [{ type: "text", text: "⚠️ No text found in image." }],
          });
          return;
        }

        const d = data[0];
        const lines = d.texts
          .map((t: string, i: number) => `  [${(d.scores[i] * 100).toFixed(1)}%] ${t}`)
          .join("\n");

        if (simple) {
          pi.sendMessage({
            role: "assistant",
            content: [{
              type: "text",
              text: `**OCR** (${d.texts.length} regions):\n\`\`\`\n${d.texts.join("\n")}\n\`\`\``,
            }],
          });
        } else {
          pi.sendMessage({
            role: "assistant",
            content: [{
              type: "text",
              text: `**OCR** — ${d.texts.length} text regions\n\`\`\`\n${lines}\n\`\`\``,
            }],
          });
        }
      } catch (e: any) {
        pi.sendMessage({
          role: "assistant",
          content: [{ type: "text", text: `❌ OCR failed: ${e?.message || e}` }],
        });
      }
    },
  });

  // Register ocr_image tool for the LLM
  pi.registerTool({
    name: "ocr_image",
    label: "OCR Image",
    description:
      "Extract text from an image or PDF file using PP-OCRv6 (supports Chinese, English, Japanese, 50+ languages). Returns text with confidence scores.",
    schema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Path to the image/PDF file or URL",
        },
      },
    },
    handler: async ({ path }: { path: string }) => {
      try {
        const data = runPaddleOCR(path);
        if (!data.length || !data[0].texts.length) return "No text found in image.";
        return data[0].texts
          .map((t: string, i: number) => `[${(data[0].scores[i] * 100).toFixed(1)}%] ${t}`)
          .join("\n");
      } catch (e: any) {
        return `OCR failed: ${e?.message || e}`;
      }
    },
  });

  // Register ocr_document tool for structured output
  pi.registerTool({
    name: "ocr_document",
    label: "OCR Document",
    description:
      "Convert a document image/PDF to structured text paragraphs using PP-OCRv6. Best for multi-line document extraction.",
    schema: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Path to the image/PDF file or URL",
        },
      },
    },
    handler: async ({ path }: { path: string }) => {
      try {
        const data = runPaddleOCR(path);
        if (!data.length || !data[0].texts.length) return "No text found.";
        const paragraphs: string[] = [];
        let current = "";
        for (let i = 0; i < data[0].texts.length; i++) {
          const t = data[0].texts[i].trim();
          if (!t) continue;
          if (current && data[0].scores[i] > 0.9) {
            current += " " + t;
          } else {
            if (current) paragraphs.push(current);
            current = t;
          }
        }
        if (current) paragraphs.push(current);
        return paragraphs.join("\n\n");
      } catch (e: any) {
        return `OCR failed: ${e?.message || e}`;
      }
    },
  });
}
