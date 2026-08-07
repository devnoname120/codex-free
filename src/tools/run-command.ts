import type { ToolDefinition } from "../types.js";

export default {
  name: "run_command",
  description: "Execute a command in the work directory. Only commands in the configured allowlist are permitted.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command/binary to run" },
      args: { type: "array", items: { type: "string" }, description: "Command arguments" },
      timeout: { type: "number", description: "Timeout in milliseconds. Default: 30000" },
    },
    required: ["command"],
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Combined stdout/stderr output followed by exit code" },
    },
  },
  handler: async (args, config) => {
    const command = args.command as string;
    const cmdArgs = (args.args as string[]) ?? [];
    const timeout = Math.min(
      typeof args.timeout === "number" ? args.timeout : config.command.defaultTimeout,
      config.command.maxTimeout,
    );

    if (!config.allowedCommands.includes(command)) {
      return {
        content: [{ type: "text", text: `Command not allowed: "${command}". Allowed: ${config.allowedCommands.join(", ")}` }],
        isError: true,
      };
    }

    try {
      const proc = Bun.spawn([command, ...cmdArgs], {
        cwd: config.workDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      clearTimeout(timer);

      if (timedOut) {
        return {
          content: [{ type: "text", text: `Command timed out after ${timeout / 1000}s` }],
          isError: true,
        };
      }

      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;
      if (!output) output = "(no output)";
      output += `\n\nexit code: ${exitCode}`;

      return { content: [{ type: "text", text: output }], isError: exitCode !== 0 ? true : undefined };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
