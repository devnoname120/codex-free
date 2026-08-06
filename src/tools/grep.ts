import { resolveSafePath } from "../safe-path.js";
import type { ToolDefinition } from "../types.js";

export default {
  name: "grep",
  description: "Search file contents by regex pattern. Returns matching lines with file paths and line numbers.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "Subdirectory to search in. Default: work-dir root" },
      include: { type: "string", description: "Only search files matching this glob (e.g. *.ts)" },
      context: { type: "number", description: "Number of context lines before and after each match" },
    },
    required: ["pattern"],
  },
  handler: async (args, config) => {
    const searchPath = args.path
      ? resolveSafePath(args.path as string, config.workDir)
      : config.workDir;

    const grepArgs = ["-rn", "--color=never"];

    if (args.include) {
      grepArgs.push(`--include=${args.include}`);
    }
    if (typeof args.context === "number") {
      grepArgs.push(`-C`, String(args.context));
    }

    grepArgs.push(args.pattern as string, searchPath);

    try {
      const proc = Bun.spawn(["grep", ...grepArgs], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode === 1) {
        return { content: [{ type: "text", text: "No matches found." }] };
      }
      if (exitCode !== 0 && exitCode !== 1) {
        return { content: [{ type: "text", text: `grep error: ${stderr}` }], isError: true };
      }

      // Strip workDir prefix from output for cleaner paths
      const output = stdout
        .trim()
        .replaceAll(config.workDir + "/", "")
        .replaceAll(config.workDir + "\\", "")
        .replaceAll(config.workDir.replaceAll("\\", "/") + "/", "");
      return { content: [{ type: "text", text: output }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
