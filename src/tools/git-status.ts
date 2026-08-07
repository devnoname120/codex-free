import type { ToolDefinition } from "../types.js";

export default {
  name: "git_status",
  description: "Show git status of the work directory. Returns parsed list of changed files with status codes.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Changed file count header followed by git porcelain status lines (e.g. ' M file.ts')" },
    },
  },
  handler: async (_args, config) => {
    try {
      const proc = Bun.spawn(["git", "status", "--porcelain"], {
        cwd: config.workDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        return { content: [{ type: "text", text: `git status failed: ${stderr}` }], isError: true };
      }

      if (!stdout.trim()) {
        return { content: [{ type: "text", text: "Working tree clean — no changes." }] };
      }

      const lines = stdout.trim().split("\n");
      const header = `${lines.length} changed file(s):\n\n`;
      return { content: [{ type: "text", text: header + stdout.trim() }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
