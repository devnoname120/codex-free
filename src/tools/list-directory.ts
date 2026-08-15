import { readdir, stat } from "fs/promises";
import { join } from "path";
import { resolveSafePath } from "../safe-path.js";
import { entryBudget, limitList } from "../output-budget.js";
import { buildIgnore, isIgnored } from "../ignore.js";
import type { ToolDefinition } from "../types.js";

export default {
  name: "list_directory",
  description: "List all files and subdirectories in a directory with their type (file/dir) and size. Returns tab-separated lines. Use this to inspect a specific directory's contents in detail, unlike tree which shows the full hierarchy.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path relative to work-dir. Default: root" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Tab-separated lines of 'type\\tsize\\tname' for each directory entry" },
    },
  },
  handler: async (args, config) => {
    try {
      const dirPath = args.path
        ? resolveSafePath(args.path as string, config.workDir)
        : config.workDir;

      const ig = buildIgnore(config);
      // Escape hatch: when the caller points `path` straight at an ignored
      // directory (e.g. list_directory node_modules), show its contents rather
      // than an empty listing. Filtering only hides ignored entries from an
      // otherwise-visible directory.
      const targetIgnored = isIgnored(ig, dirPath, config.workDir);

      const all = (await readdir(dirPath, { withFileTypes: true }))
        .filter((e) => targetIgnored || !isIgnored(ig, join(dirPath, e.name), config.workDir))
        .sort((a, b) => a.name.localeCompare(b.name));
      // Cut before stat()ing, so a directory with 50k files does not cost 50k
      // syscalls to produce output that would be thrown away anyway.
      const { items: entries, dropped } = limitList(all, entryBudget(config));
      const lines: string[] = [];

      for (const entry of entries) {
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

      const text = dropped
        ? `${lines.join("\n")}\n\n(showing ${lines.length} of ${lines.length + dropped} entries — use glob for a filtered view)`
        : lines.join("\n");
      return { content: [{ type: "text", text }] };
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
