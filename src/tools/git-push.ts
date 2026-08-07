import type { ToolDefinition } from "../types.js";

export default {
  name: "git_push",
  description: "Push commits to a remote repository. Defaults to 'origin' and current branch.",
  inputSchema: {
    type: "object",
    properties: {
      remote: { type: "string", description: "Remote name. Default: origin" },
      branch: { type: "string", description: "Branch name. Default: current branch" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Git push output text" },
    },
  },
  handler: async (args, config) => {
    const remote = (args.remote as string) ?? "origin";
    const cmdArgs = ["git", "push", remote];

    if (args.branch) {
      cmdArgs.push(args.branch as string);
    }

    try {
      const proc = Bun.spawn(cmdArgs, {
        cwd: config.workDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      const output = (stdout + "\n" + stderr).trim();

      if (exitCode !== 0) {
        return { content: [{ type: "text", text: `git push failed (exit ${exitCode}):\n${output}` }], isError: true };
      }

      return { content: [{ type: "text", text: output || "Push successful (no output)." }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
