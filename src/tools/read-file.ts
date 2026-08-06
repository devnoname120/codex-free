import { resolveSafePath } from "../safe-path.js";
import type { ToolDefinition } from "../types.js";

export default {
  name: "read_file",
  description: "Read the contents of a file at the given path relative to work-dir. Returns content with line numbers.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to work-dir" },
      offset: { type: "number", description: "Start reading from this line (0-based). Default: 0" },
      limit: { type: "number", description: "Maximum number of lines to return. Default: all lines" },
    },
    required: ["path"],
  },
  handler: async (args, config) => {
    try {
      const filePath = resolveSafePath(args.path as string, config.workDir);
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        return { content: [{ type: "text", text: `File not found: ${args.path}` }], isError: true };
      }

      const text = await file.text();
      let lines = text.split("\n");

      const offset = typeof args.offset === "number" ? args.offset : 0;
      const limit = typeof args.limit === "number" ? args.limit : lines.length;
      lines = lines.slice(offset, offset + limit);

      const numbered = lines.map((line, i) => `${offset + i + 1}\t${line}`).join("\n");
      return { content: [{ type: "text", text: numbered }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
