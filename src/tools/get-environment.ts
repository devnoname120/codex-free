import { sep } from "node:path";
import { effectiveAllowlist } from "../exec-policy.js";
import { resolveShell, shellTypeOf } from "../exec-sessions.js";
import type { AppConfig, ToolDefinition } from "../types.js";

/**
 * Codex hands its model an `<environment_context>` block containing `<cwd>` and
 * `<shell>` before the first turn (codex-rs/core/src/compact_tests.rs). MCP has
 * no equivalent channel — a server can only expose tools — so the same facts
 * are offered as a tool call instead. The server also repeats them in its
 * `instructions`, for clients that read those.
 */

/** Friendly OS name, since `process.platform` says "darwin" and "win32". */
export function osName(platform: string = process.platform): string {
  switch (platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

export interface EnvironmentInfo {
  os: string;
  platform: string;
  arch: string;
  cwd: string;
  path_separator: string;
  shell: { bin: string; type: string; argv_prefix: string[] };
  exec: { mode: string; max_sessions: number; allowed_commands: string[] };
  run_command_allowed: string[];
}

export function describeEnvironment(config: AppConfig): EnvironmentInfo {
  const [bin, ...args] = resolveShell(config.exec.defaultShell);
  return {
    os: osName(),
    platform: process.platform,
    arch: process.arch,
    cwd: config.workDir,
    path_separator: sep,
    shell: { bin: bin!, type: shellTypeOf(bin!), argv_prefix: args },
    exec: {
      mode: config.exec.mode,
      max_sessions: config.exec.maxSessions,
      allowed_commands: effectiveAllowlist(config),
    },
    run_command_allowed: [...config.allowedCommands].sort(),
  };
}

/**
 * Prose rather than the raw JSON, because the shell type is the one fact that
 * changes what a caller should write, and it is easy to miss in a nested object.
 */
export function renderEnvironment(info: EnvironmentInfo): string {
  const shellAdvice =
    info.shell.type === "powershell"
      ? "Write PowerShell, not POSIX sh: `Get-ChildItem` not `ls -la`, `Select-String` not `grep`, `$env:FOO='bar'` not `FOO=bar`. Names like ls/cat/rm are aliases for cmdlets and take different flags."
      : info.shell.type === "cmd"
        ? "Write cmd.exe syntax: `dir` not `ls`, `%VAR%` not `$VAR`, `&&` chains but no pipelines of POSIX tools unless they are installed."
        : "Write POSIX sh syntax. Standard utilities (ls, grep, sed, awk) behave as usual.";

  return [
    `OS: ${info.os} (${info.platform}/${info.arch})`,
    `Working directory: ${info.cwd}`,
    `Path separator: ${JSON.stringify(info.path_separator)}`,
    `Shell for exec_command: ${info.shell.bin} (${info.shell.type})`,
    "",
    shellAdvice,
    "",
    `exec_command policy: ${info.exec.mode}` +
      (info.exec.mode === "allowlist"
        ? `, allowing: ${info.exec.allowed_commands.join(", ")}`
        : " (any command runs)"),
    `run_command allows: ${info.run_command_allowed.join(", ")}`,
    `Concurrent exec sessions: up to ${info.exec.max_sessions}`,
  ].join("\n");
}

export default {
  name: "get_environment",
  description:
    "Report the machine this bridge is running on: operating system, the shell exec_command will use, the working directory, and which commands the policy allows. Call this before writing any shell command — the same command string behaves differently under PowerShell, cmd and POSIX sh, and guessing wrong wastes a turn.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      os: { type: "string", description: "Friendly OS name: Windows, macOS, Linux." },
      platform: { type: "string", description: "Node platform identifier, e.g. win32, darwin, linux." },
      arch: { type: "string", description: "CPU architecture, e.g. x64, arm64." },
      cwd: { type: "string", description: "Absolute path of the work directory all tools operate on." },
      path_separator: { type: "string", description: "Native path separator on this host." },
      shell: {
        type: "object",
        description: "The shell exec_command launches when a call names none.",
        properties: {
          bin: { type: "string", description: "Shell binary path." },
          type: { type: "string", enum: ["posix", "powershell", "cmd"], description: "Syntax family the shell expects." },
          argv_prefix: { type: "array", items: { type: "string" }, description: "Arguments placed before the command string." },
        },
        required: ["bin", "type", "argv_prefix"],
        additionalProperties: false,
      },
      exec: {
        type: "object",
        description: "Policy applied to exec_command.",
        properties: {
          mode: { type: "string", enum: ["allowlist", "unrestricted"], description: "Whether commands are checked against an allowlist." },
          max_sessions: { type: "number", description: "Cap on concurrent background exec sessions." },
          allowed_commands: { type: "array", items: { type: "string" }, description: "Commands exec_command accepts under allowlist mode." },
        },
        required: ["mode", "max_sessions", "allowed_commands"],
        additionalProperties: false,
      },
      run_command_allowed: { type: "array", items: { type: "string" }, description: "Commands run_command accepts, which is the narrower list." },
    },
    required: ["os", "platform", "arch", "cwd", "path_separator", "shell", "exec", "run_command_allowed"],
    additionalProperties: false,
  },
  handler: async (_args, config) => {
    const info = describeEnvironment(config);
    return {
      content: [{ type: "text", text: renderEnvironment(info) }],
      structuredContent: { ...info },
    };
  },
} satisfies ToolDefinition;
