import fg from "fast-glob";
import { resolveSafePath } from "../safe-path.js";
import type { ToolDefinition } from "../types.js";

export default {
  name: "glob",
  description: "Find files matching a glob pattern (e.g. **/*.ts) within the work directory.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern to match" },
      path: { type: "string", description: "Subdirectory to search in. Default: work-dir root" },
    },
    required: ["pattern"],
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Newline-separated list of matched file paths relative to work-dir" },
    },
  },
  handler: async (args, config) => {
    try {
      const basePath = args.path
        ? resolveSafePath(args.path as string, config.workDir)
        : config.workDir;

      const matches = await fg(args.pattern as string, {
        cwd: basePath,
        dot: false,
        onlyFiles: true,
      });

      // fast-glob does not sandbox its `cwd`: patterns like "../../etc/passwd"
      // or absolute patterns (e.g. "C:/Windows/win.ini") can match outside of
      // `basePath`. Re-validate every match against the work-dir boundary so
      // glob can't be used to bypass resolveSafePath.
      const files = matches.filter((f) => {
        try {
          resolveSafePath(f, basePath);
          return true;
        } catch {
          return false;
        }
      });

      if (files.length === 0) {
        return { content: [{ type: "text", text: "No files found matching pattern." }] };
      }

      return { content: [{ type: "text", text: files.sort().join("\n") }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
