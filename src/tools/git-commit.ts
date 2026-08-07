import type { ToolDefinition } from "../types.js";

export default {
  name: "git_commit",
  description: "Create a git commit with the given message. Set all=true to automatically stage all tracked modified files before committing (equivalent to git commit -a). Without all=true, only previously staged files (via git add) will be committed. Use git_status first to see what will be committed.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message" },
      all: { type: "boolean", description: "Stage all tracked changes before committing (git commit -a). Default: false" },
    },
    required: ["message"],
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Git commit output text including branch, hash, and summary" },
    },
  },
  handler: async (args, config) => {
    const message = args.message as string;
    const commitArgs = ["git", "commit"];

    if (args.all) {
      commitArgs.push("-a");
    }

    commitArgs.push("-m", message);

    try {
      const proc = Bun.spawn(commitArgs, {
        cwd: config.workDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      const output = (stdout + "\n" + stderr).trim();

      if (exitCode !== 0) {
        return { content: [{ type: "text", text: `git commit failed (exit ${exitCode}):\n${output}` }], isError: true };
      }

      return { content: [{ type: "text", text: output }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
