import { assertExecAllowed, effectiveAllowlist } from "../exec-policy.js";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  EXEC_DEFAULT_YIELD_MS,
  EXEC_MAX_YIELD_MS,
  EXEC_MIN_YIELD_MS,
  clamp,
  generateChunkId,
  resolveShell,
  shellTypeOf,
  startExecSession,
  truncateOutput,
  yieldOutput,
} from "../exec-sessions.js";
import { resolveSafePath } from "../safe-path.js";
import type { AppConfig, ToolDefinition } from "../types.js";
import type { ShellType, UnifiedExecOutput } from "../exec-sessions.js";

export const UNIFIED_EXEC_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    chunk_id: { type: "string", description: "Chunk identifier included when the response reports one." },
    wall_time_seconds: { type: "number", description: "Elapsed wall time spent waiting for output in seconds." },
    exit_code: { type: "number", description: "Process exit code when the command finished during this call." },
    session_id: { type: "number", description: "Session identifier to pass to write_stdin when the process is still running." },
    original_token_count: { type: "number", description: "Approximate token count before output truncation." },
    output: { type: "string", description: "Command output text, possibly truncated." },
  },
  required: ["wall_time_seconds", "output"],
  additionalProperties: false,
} as const;

export function renderUnifiedExecOutput(result: UnifiedExecOutput): string {
  return JSON.stringify(result, null, 2);
}

const BASE_DESCRIPTION = `Runs a command in a shell and returns its output. Use this for anything the structured tools do not cover: build pipelines, test runners, package managers, interactive REPLs.

If the command finishes within yield_time_ms the full result is returned with its exit_code. If it is still running, a session_id comes back instead — pass that to write_stdin to send input, poll for more output, or wait for it to finish. That makes long-running and interactive processes (dev servers, REPLs, prompts asking for confirmation) workable in a single session.

Commands run through the platform shell, so pipes, redirection and && chains work. Note this bridge runs commands with plain pipes, not a PTY.`;

/**
 * Codex appends these rules to the `exec_command` description on Windows
 * (shell_spec.rs::windows_shell_guidance). They carry more weight here than
 * they do there: Codex backs them with a sandbox, this bridge does not, so the
 * description is the only thing standing between a mis-composed delete and the
 * filesystem.
 */
const WINDOWS_SHELL_GUIDANCE = `Windows safety rules:
- Do not compose destructive filesystem commands across shells. Do not enumerate paths in PowerShell and then pass them to \`cmd /c\`, batch builtins, or another shell for deletion or moving. Use one shell end-to-end, prefer native PowerShell cmdlets such as \`Remove-Item\` / \`Move-Item\` with \`-LiteralPath\`, and avoid string-built shell commands for file operations.
- Before any recursive delete or move on Windows, verify the resolved absolute target paths stay within the intended workspace or explicitly named target directory. Never issue a recursive delete or move against a computed path if the final target has not been checked.
- When using \`Start-Process\` to launch a background helper or service, pass \`-WindowStyle Hidden\` unless the user explicitly asked for a visible interactive window. Use visible windows only for interactive tools the user needs to see or control.`;

export const EXEC_COMMAND_DESCRIPTION =
  process.platform === "win32"
    ? `${BASE_DESCRIPTION}\n\n${WINDOWS_SHELL_GUIDANCE}`
    : BASE_DESCRIPTION;

const SYNTAX_HINT: Record<ShellType, string> = {
  powershell:
    "Commands are PowerShell, so `ls`, `cat` and `rm` are cmdlet aliases with different flags — prefer `Get-ChildItem`, `Get-Content`, `Remove-Item`, and `$env:FOO='bar'` for environment variables.",
  cmd: "Commands are cmd.exe, so use `dir`, `%VAR%` and `copy` rather than POSIX equivalents.",
  posix: "Commands are POSIX shell, so the usual utilities and syntax apply.",
};

/**
 * The static description names no shell, because which one runs depends on
 * `$SHELL` and config that is only known once the server starts. Naming it here
 * saves the model a `get_environment` call and a wrong first guess.
 */
export function describeExecCommand(config: AppConfig): string {
  const [bin] = resolveShell(config.exec.defaultShell);
  const type = shellTypeOf(bin!);
  return `${EXEC_COMMAND_DESCRIPTION}\n\nThis server runs commands with: ${bin} (${type}). ${SYNTAX_HINT[type]}`;
}

export default {
  name: "exec_command",
  description: EXEC_COMMAND_DESCRIPTION,
  describe: describeExecCommand,
  inputSchema: {
    type: "object",
    properties: {
      cmd: { type: "string", description: "Shell command to execute." },
      workdir: { type: "string", description: "Working directory for the command, relative to the project root. Defaults to the project root." },
      tty: { type: "boolean", description: "Unsupported by this bridge — commands always run with plain pipes. Passing true returns an error." },
      yield_time_ms: { type: "number", description: `Wait before yielding output. Defaults to ${EXEC_DEFAULT_YIELD_MS} ms; effective range is ${EXEC_MIN_YIELD_MS}-${EXEC_MAX_YIELD_MS} ms.` },
      max_output_tokens: { type: "number", description: `Output token budget. Defaults to ${DEFAULT_MAX_OUTPUT_TOKENS} tokens; the middle of longer output is elided.` },
      shell: { type: "string", description: "Shell binary to launch. Defaults to the platform shell." },
    },
    required: ["cmd"],
    additionalProperties: false,
  },
  outputSchema: UNIFIED_EXEC_OUTPUT_SCHEMA,
  handler: async (args, config, session) => {
    const cmd = args.cmd;
    if (typeof cmd !== "string" || cmd.trim() === "") {
      return { content: [{ type: "text", text: "cmd must be a non-empty string" }], isError: true };
    }
    if (args.tty === true) {
      return {
        content: [{ type: "text", text: "tty is not supported by this bridge; commands run with plain pipes. Omit tty or pass false." }],
        isError: true,
      };
    }

    const yieldMs = clamp(
      typeof args.yield_time_ms === "number" ? args.yield_time_ms : EXEC_DEFAULT_YIELD_MS,
      EXEC_MIN_YIELD_MS,
      EXEC_MAX_YIELD_MS,
    );
    const maxOutputTokens =
      typeof args.max_output_tokens === "number" && args.max_output_tokens > 0
        ? args.max_output_tokens
        : DEFAULT_MAX_OUTPUT_TOKENS;

    let cwd: string;
    try {
      cwd = resolveSafePath((args.workdir as string) ?? "", config.workDir, true);
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }

    try {
      assertExecAllowed(cmd, config);
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }

    const started = Date.now();
    try {
      const execSession = startExecSession(
        session,
        config,
        cmd,
        cwd,
        typeof args.shell === "string" ? args.shell : undefined,
      );
      const { output, exited } = await yieldOutput(execSession, yieldMs);
      const { output: text, originalTokenCount } = truncateOutput(output, maxOutputTokens);

      const result: UnifiedExecOutput = {
        chunk_id: generateChunkId(),
        wall_time_seconds: (Date.now() - started) / 1000,
        output: text,
      };
      if (originalTokenCount !== undefined) result.original_token_count = originalTokenCount;

      if (exited) {
        result.exit_code = execSession.exitCode ?? undefined;
        session.execSessions.delete(execSession.id);
      } else {
        result.session_id = execSession.id;
      }

      return {
        content: [{ type: "text", text: renderUnifiedExecOutput(result) }],
        structuredContent: { ...result },
        isError: exited && execSession.exitCode !== 0 ? true : undefined,
      };
    } catch (err: any) {
      const hint =
        config.exec.mode === "allowlist"
          ? `\nAllowed commands: ${effectiveAllowlist(config).join(", ")}`
          : "";
      return { content: [{ type: "text", text: `${err.message}${hint}` }], isError: true };
    }
  },
} satisfies ToolDefinition;
