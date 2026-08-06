import type { ToolDefinition } from "../types.js";

export default {
  name: "git_log",
  description: "Show recent git commit history. Returns formatted log with hash, author, date, and message.",
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number", description: "Number of commits to show. Default: 10" },
      oneline: { type: "boolean", description: "Show compact one-line format. Default: false" },
    },
  },
  handler: async (args, config) => {
    const count = typeof args.count === "number" ? args.count : 10;
    const logArgs = ["git", "log", `--max-count=${count}`];

    if (args.oneline) {
      logArgs.push("--oneline");
    } else {
      logArgs.push("--format=%H %an <%ae> %ai%n  %s%n");
    }

    try {
      const proc = Bun.spawn(logArgs, {
        cwd: config.workDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        return { content: [{ type: "text", text: `git log failed: ${stderr}` }], isError: true };
      }

      if (!stdout.trim()) {
        return { content: [{ type: "text", text: "No commits found." }] };
      }

      return { content: [{ type: "text", text: stdout.trim() }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
