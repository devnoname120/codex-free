import { readdir } from "fs/promises";
import { join } from "path";
import { resolveSafePath } from "../safe-path.js";
import { treeNodeBudget } from "../output-budget.js";
import { buildIgnore, isIgnored, shouldPrune } from "../ignore.js";
import type { Ignore } from "ignore";
import type { AppConfig, ToolDefinition } from "../types.js";

export default {
  name: "tree",
  description: "Show the project directory structure as an ASCII tree. Automatically ignores common directories (node_modules, .git, dist, __pycache__). Use this first to understand the project layout before diving into specific files. Depth defaults to 3 and the walk stops at a node budget, so point 'path' at a subdirectory rather than asking for a deep tree of the whole repo.",
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
      const ig = buildIgnore(config);

      const state: WalkState = { lines: ["."], remaining: treeNodeBudget(config), stopped: false };
      await buildTree(rootPath, "", 0, maxDepth, ig, config, state);

      const text = state.stopped
        ? `${state.lines.join("\n")}\n\n(stopped at ${state.lines.length - 1} nodes — lower "depth" or point "path" at a subdirectory)`
        : state.lines.join("\n");
      return { content: [{ type: "text", text }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;

/**
 * Walk state shared across the recursion. `remaining` is a whole-tree budget
 * rather than a per-directory one, so a single enormous directory cannot starve
 * its siblings out of the output without the result saying so.
 */
interface WalkState {
  lines: string[];
  remaining: number;
  stopped: boolean;
}

async function buildTree(
  dirPath: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  ig: Ignore,
  config: AppConfig,
  state: WalkState,
): Promise<void> {
  if (depth >= maxDepth || state.stopped) return;

  const entries = await readdir(dirPath, { withFileTypes: true });
  const filtered = entries
    .filter((e) => {
      const abs = join(dirPath, e.name);
      // Directories the walk should never descend are also never shown; a file
      // the ignore policy hides is dropped the same way.
      return e.isDirectory()
        ? !shouldPrune(ig, e.name, abs, config.workDir)
        : !isIgnored(ig, abs, config.workDir);
    })
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (let i = 0; i < filtered.length; i++) {
    if (state.remaining === 0) {
      state.stopped = true;
      return;
    }

    const entry = filtered[i];
    const isLast = i === filtered.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    state.lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    state.remaining--;

    if (entry.isDirectory()) {
      await buildTree(join(dirPath, entry.name), prefix + childPrefix, depth + 1, maxDepth, ig, config, state);
      if (state.stopped) return;
    }
  }
}
