/**
 * PaddleOCR Extension for Pi
 *
 * PP-OCRv6 OCR — extract text from images/PDFs.
 * Requires WSL2 with PaddleOCR installed.
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
import { execSync } from "node:child_process";

interface OCRData {
  texts: string[];
  scores: number[];
  boxes?: number[][];
  det_scores?: number[];
}

function runPaddleOCR(path: string): OCRData[] {
  const escaped = path.replace(/'/g, "'\\''");
  const cmd = `wsl bash -ic "export PATH=\\$HOME/.local/bin:\\$PATH && paddleocr-cli '${escaped}'"`;
  const stdout = execSync(cmd, { timeout: 60_000, encoding: "utf-8" });
  return JSON.parse(stdout);
}

export default function ocrExtension(pi: ExtensionAPI) {
  // Register /ocr command
  pi.registerCommand("ocr", {
    description: "OCR an image/PDF using PP-OCRv6. Usage: /ocr <image_path> [--simple]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const path = parts[0];
      const simple = parts.includes("--simple");

      if (!path) {
        ctx.ui.notify("Usage: /ocr <image_path> [--simple]", "error");
        return;
      }

      ctx.ui.notify(`🧐 OCR: ${path}`, "info");

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
