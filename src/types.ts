export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /**
   * Description to advertise instead of `description`, for tools whose wording
   * depends on runtime configuration. `exec_command` uses it to name the shell
   * it will actually launch, which is not knowable at module load.
   */
  describe?: (config: AppConfig) => string;
  handler: (
    args: Record<string, unknown>,
    config: AppConfig,
    session: SessionState,
  ) => Promise<ToolResult>;
}

/**
 * MCP content blocks a tool may return. The `never` markers keep the union
 * discriminated while still letting callers read `.text` off any block, so
 * text-only tools (the majority) stay ergonomic.
 */
export type ToolContent =
  | { type: "text"; text: string; data?: never; mimeType?: never }
  | { type: "image"; data: string; mimeType: string; text?: never };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /**
   * Machine-readable form of `content`, matching the tool's `outputSchema`.
   * Only tools whose schema is not the usual `{ content: string }` need to set
   * this; the server fills in that default (see `withStructuredContent`).
   */
  structuredContent?: Record<string, unknown>;
}

// ─── Session state ─────────────────────────────────────────────────────

export type PlanStepStatus = "pending" | "in_progress" | "completed";

export interface PlanItem {
  step: string;
  status: PlanStepStatus;
}

export interface PlanState {
  explanation?: string;
  plan: PlanItem[];
}

/**
 * A shell process started by `exec_command` that did not finish within its
 * yield window. It stays resident so `write_stdin` can feed it input and drain
 * further output, mirroring Codex's unified-exec session model.
 */
export interface ExecSession {
  id: number;
  command: string;
  proc: import("bun").Subprocess<"pipe", "pipe", "pipe">;
  /** Output produced but not yet handed back to the model. */
  pending: string;
  exitCode: number | null;
  startedAt: number;
  /** Resolves once both stdout and stderr readers reach EOF. */
  draining: Promise<void>;
}

/**
 * Per-MCP-session mutable state. A fresh instance is created for every MCP
 * session so concurrent clients never share exec sessions or plans.
 */
export interface SessionState {
  execSessions: Map<number, ExecSession>;
  nextExecSessionId: number;
  plan: PlanState | null;
}

export function createSessionState(): SessionState {
  return {
    execSessions: new Map(),
    nextExecSessionId: 1,
    plan: null,
  };
}

// ─── Config ────────────────────────────────────────────────────────────

export type ExecMode = "allowlist" | "unrestricted";

export interface ExecConfig {
  /**
   * `allowlist` validates every command-position token in a shell string
   * against the allowlists. `unrestricted` disables the check entirely.
   */
  mode: ExecMode;
  /**
   * Extra binaries accepted by `exec_command` on top of `allowedCommands`.
   * Defaults to common read-only utilities so allowlist mode stays usable for
   * shell pipelines without widening what `run_command` accepts.
   */
  extraAllowedCommands: string[];
  /** Upper bound on concurrently resident exec sessions. */
  maxSessions: number;
  /**
   * Shell binary `exec_command` launches when a call names none. Defaults to
   * `$SHELL`, then PowerShell on Windows and `/bin/sh` elsewhere. Set this when
   * the shell the server was started from is not the one commands should run
   * in — launching from Git Bash but wanting PowerShell, say.
   */
  defaultShell?: string;
}

export interface AppConfig {
  workDir: string;
  apiKey?: string;
  port: number;
  allowedCommands: string[];
  tree: { defaultDepth: number; ignore: string[] };
  command: { defaultTimeout: number; maxTimeout: number };
  exec: ExecConfig;
}

export interface CliArgs {
  workDir: string;
  port?: number;
  apiKey?: string;
  configPath?: string;
}
