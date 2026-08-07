import { dirname } from "path";
import { mkdir } from "fs/promises";
import { resolveSafePath } from "../safe-path.js";
import type { ToolDefinition } from "../types.js";

export default {
  name: "write_file",
  description: "Write or overwrite a file with the given content. Path is relative to the project root (work-dir). Parent directories are created automatically. Use this to create new files, update existing files, or save generated code. Always read the file first before overwriting to avoid losing content.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to work-dir" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Confirmation message with bytes written and file path" },
    },
  },
  handler: async (args, config) => {
    try {
      const filePath = resolveSafePath(args.path as string, config.workDir);
      await mkdir(dirname(filePath), { recursive: true });
      await Bun.write(filePath, args.content as string);
      return { content: [{ type: "text", text: `Written ${(args.content as string).length} bytes to ${args.path}` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
