import { resolveSafePath } from "../safe-path.js";
import type { ToolDefinition } from "../types.js";

/**
 * Images are base64-inlined into the response, which roughly grows them by a
 * third. 5 MB of source keeps a single tool result within what an MCP client
 * will accept.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Sniffs the format from magic bytes rather than trusting the extension, so a
 * mislabelled file is reported instead of being sent with the wrong mime type.
 */
function detectMimeType(bytes: Uint8Array): string | null {
  const startsWith = (sig: number[], offset = 0) =>
    sig.every((byte, i) => bytes[offset + i] === byte);

  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith([0x42, 0x4d])) return "image/bmp";
  // RIFF....WEBP
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

export default {
  name: "view_image",
  description: "View a local image file from the filesystem when visual inspection is needed. Use this for images already available on disk — screenshots, diagrams, design mockups, rendered charts. Path is relative to the project root (work-dir). Supports PNG, JPEG, GIF, BMP and WebP up to 5 MB.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Image file path relative to work-dir" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args, config) => {
    try {
      const inputPath = args.path as string;
      const filePath = resolveSafePath(inputPath, config.workDir);

      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return { content: [{ type: "text", text: `File not found: ${inputPath}` }], isError: true };
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return {
          content: [{
            type: "text",
            text: `Image too large: ${file.size} bytes (limit ${MAX_IMAGE_BYTES}). Resize it before viewing.`,
          }],
          isError: true,
        };
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = detectMimeType(bytes);
      if (!mimeType) {
        return {
          content: [{
            type: "text",
            text: `Not a recognised image file: ${inputPath}. Supported: PNG, JPEG, GIF, BMP, WebP.`,
          }],
          isError: true,
        };
      }

      return {
        content: [{ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType }],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
