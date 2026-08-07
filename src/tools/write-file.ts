import { dirname } from "path";
import { mkdir } from "fs/promises";
import { resolveSafePath } from "../safe-path.js";
import type { ToolDefinition } from "../types.js";

export default {
  name: "write_file",
  description: "Write content to a file at the given path relative to work-dir. Creates parent directories if needed.",
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
