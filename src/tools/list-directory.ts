import { readdir, stat } from "fs/promises";
import { join } from "path";
import { resolveSafePath } from "../safe-path.js";
import type { ToolDefinition } from "../types.js";

export default {
  name: "list_directory",
  description: "List files and directories in the given path. Returns name, type, and size.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path relative to work-dir. Default: root" },
    },
  },
  handler: async (args, config) => {
    try {
      const dirPath = args.path
        ? resolveSafePath(args.path as string, config.workDir)
        : config.workDir;

      const entries = await readdir(dirPath, { withFileTypes: true });
      const lines: string[] = [];

      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const type = entry.isDirectory() ? "dir" : "file";
        if (type === "file") {
          const s = await stat(join(dirPath, entry.name));
          lines.push(`${type}\t${formatSize(s.size)}\t${entry.name}`);
        } else {
          lines.push(`${type}\t-\t${entry.name}/`);
        }
      }

      if (lines.length === 0) {
        return { content: [{ type: "text", text: "Directory is empty." }] };
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
