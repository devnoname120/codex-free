import { readdir } from "fs/promises";
import { join } from "path";
import { resolveSafePath } from "../safe-path.js";
import type { ToolDefinition } from "../types.js";

export default {
  name: "tree",
  description: "Show directory tree as ASCII art. Ignores node_modules, .git, etc. by default.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path relative to work-dir. Default: root" },
      depth: { type: "number", description: "Max depth to traverse. Default: 3" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "ASCII tree representation of directory structure" },
    },
  },
  handler: async (args, config) => {
    try {
      const rootPath = args.path
        ? resolveSafePath(args.path as string, config.workDir)
        : config.workDir;
      const maxDepth = typeof args.depth === "number" ? args.depth : config.tree.defaultDepth;
      const ignoreSet = new Set(config.tree.ignore);

      const lines: string[] = ["."];
      await buildTree(rootPath, "", 0, maxDepth, ignoreSet, lines);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;

async function buildTree(
  dirPath: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  ignore: Set<string>,
  lines: string[],
): Promise<void> {
  if (depth >= maxDepth) return;

  const entries = await readdir(dirPath, { withFileTypes: true });
  const filtered = entries
    .filter((e) => !ignore.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const isLast = i === filtered.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);

    if (entry.isDirectory()) {
      await buildTree(join(dirPath, entry.name), prefix + childPrefix, depth + 1, maxDepth, ignore, lines);
    }
  }
}
