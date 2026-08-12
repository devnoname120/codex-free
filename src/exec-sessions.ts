import type { AppConfig, ExecSession, SessionState } from "./types.js";

/**
 * Unified-exec session management, modelled on Codex's `exec_command` /
 * `write_stdin` pair (codex-rs/core/src/tools/handlers/unified_exec).
 *
 * Codex runs commands in a PTY; Bun has no built-in PTY, so commands run with
 * plain pipes instead. Codex's own `tty` parameter documents plain pipes as the
 * default ("false or omitted uses plain pipes"), so the default path matches —
 * only `tty: true` is unsupported here.
 */

// Codex constants (shell_spec.rs). Kept as code, not config, because they are
// part of matching Codex's tool semantics rather than local policy.
export const EXEC_DEFAULT_YIELD_MS = 10_000;
export const EXEC_MIN_YIELD_MS = 250;
export const EXEC_MAX_YIELD_MS = 30_000;
export const STDIN_WRITE_DEFAULT_YIELD_MS = 250;
export const STDIN_POLL_DEFAULT_YIELD_MS = 5_000;
export const STDIN_POLL_MAX_YIELD_MS = 300_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;

/** Codex's approx_token_count equivalent: roughly four characters per token. */
export function approxTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface UnifiedExecOutput {
  chunk_id?: string;
  wall_time_seconds: number;
  exit_code?: number;
  session_id?: number;
  original_token_count?: number;
  output: string;
}

/**
 * Trims `text` to the token budget, keeping the head and tail and marking the
 * elided middle. Shell output is most informative at its start (what ran) and
 * end (what failed), so the middle is what gets dropped.
 */
export function truncateOutput(
  text: string,
  maxOutputTokens: number,
): { output: string; originalTokenCount?: number } {
  const budgetChars = Math.max(maxOutputTokens, 1) * 4;
  if (text.length <= budgetChars) return { output: text };

  const originalTokenCount = approxTokenCount(text);
  const keep = Math.floor(budgetChars / 2);
  const head = text.slice(0, keep);
  const tail = text.slice(text.length - keep);
  const omitted = text.length - head.length - tail.length;
  return {
    output: `${head}\n\n[... ${omitted} bytes omitted ...]\n\n${tail}`,
    originalTokenCount,
  };
}

export type ShellType = "posix" | "powershell" | "cmd";

/**
 * Classifies a shell binary by name. Both separators are handled explicitly
 * because a Windows path can arrive on a POSIX host and vice versa — Git Bash
 * reports `$SHELL` as `C:\Program Files\Git\bin\bash.exe`.
 */
export function shellTypeOf(bin: string): ShellType {
  const base = bin.split(/[\\/]/).pop()!.replace(/\.exe$/i, "").toLowerCase();
  if (base === "powershell" || base === "pwsh") return "powershell";
  if (base === "cmd") return "cmd";
  return "posix";
}

/**
 * The shell used when the caller names none.
 *
 * `$SHELL` wins on every platform, so launching the server from Git Bash gets
 * bash rather than PowerShell. Windows falls back to PowerShell, matching Codex.
 */
export function defaultShellBin(): string {
  if (process.env.SHELL) return process.env.SHELL;
  return process.platform === "win32" ? "powershell.exe" : "/bin/sh";
}

/**
 * Builds the argv prefix that makes `bin` execute a command string.
 *
 * Mirrors Codex's `Shell::derive_exec_args` (codex-rs/core/src/shell.rs): the
 * flag follows the shell, not the host. Picking it by platform instead meant
 * `shell: "bash"` on Windows was invoked as `bash -NoProfile -Command`.
 */
export function resolveShell(explicit?: string): string[] {
  const bin = explicit || defaultShellBin();
  switch (shellTypeOf(bin)) {
    case "powershell":
      return [bin, "-NoProfile", "-Command"];
    case "cmd":
      return [bin, "/c"];
    case "posix":
      return [bin, "-c"];
  }
}

function isPowerShell(bin: string): boolean {
  return shellTypeOf(bin) === "powershell";
}

/**
 * `powershell -Command` collapses any non-zero child exit code to 1, which
 * would make every failure look the same. Re-raising `$LASTEXITCODE` keeps the
 * real code. When the command was a cmdlet rather than an executable
 * `$LASTEXITCODE` is unset, so fall back to the success flag `$?`.
 */
export function wrapForShell(cmd: string, shellBin: string): string {
  if (!isPowerShell(shellBin)) return cmd;
  return [
    "$ErrorActionPreference = 'Continue'",
    cmd,
    "if ($null -eq $LASTEXITCODE) { if ($?) { exit 0 } else { exit 1 } }",
    "exit $LASTEXITCODE",
  ].join("\n");
}

/**
 * Spawns `cmd` through a shell and registers it as a resident session.
 * The caller is responsible for having validated `cmd` against policy first.
 */
export function startExecSession(
  state: SessionState,
  config: AppConfig,
  cmd: string,
  cwd: string,
  shell?: string,
): ExecSession {
  reapFinishedSessions(state);
  if (state.execSessions.size >= config.exec.maxSessions) {
    throw new Error(
      `Too many live exec sessions (${config.exec.maxSessions}). ` +
        `Finish or terminate an existing session before starting another.`,
    );
  }

  const [bin, ...shellArgs] = resolveShell(shell ?? config.exec.defaultShell);
  const proc = Bun.spawn([bin!, ...shellArgs, wrapForShell(cmd, bin!)], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    // POSIX only: setsid() makes the shell its own process-group leader so the
    // whole tree can be signalled at once (see killExecSession). Windows uses
    // taskkill's parent-child walk instead, and detaching there would cost the
    // child its console.
    detached: process.platform !== "win32",
  });

  const session: ExecSession = {
    id: state.nextExecSessionId++,
    command: cmd,
    proc,
    pending: "",
    exitCode: null,
    startedAt: Date.now(),
    draining: Promise.resolve(),
  };

  // stdout and stderr are drained concurrently and appended in arrival order,
  // approximating the single merged stream a PTY would have produced.
  const append = (chunk: string) => {
    session.pending += chunk;
  };
  session.draining = Promise.all([
    drainStream(proc.stdout, append),
    drainStream(proc.stderr, append),
  ]).then(() => undefined);

  void proc.exited.then((code) => {
    session.exitCode = code;
  });

  state.execSessions.set(session.id, session);
  return session;
}

async function drainStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) onChunk(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onChunk(tail);
  } catch {
    // Stream torn down with the process; whatever was buffered still stands.
  }
}

/**
 * Waits until the process exits or `yieldMs` elapses, then hands back
 * everything buffered so far and clears the buffer.
 */
export async function yieldOutput(
  session: ExecSession,
  yieldMs: number,
): Promise<{ output: string; exited: boolean }> {
  const deadline = Date.now() + yieldMs;
  while (Date.now() < deadline && session.exitCode === null) {
    await Bun.sleep(Math.min(25, Math.max(deadline - Date.now(), 1)));
  }

  if (session.exitCode !== null) {
    // Let the readers finish so the final bytes are not lost to the race
    // between process exit and stream EOF.
    await Promise.race([session.draining, Bun.sleep(250)]);
  }

  const output = session.pending;
  session.pending = "";
  return { output, exited: session.exitCode !== null };
}

/** Removes sessions whose process already exited and left nothing buffered. */
export function reapFinishedSessions(state: SessionState): void {
  for (const [id, session] of state.execSessions) {
    if (session.exitCode !== null && session.pending === "") {
      state.execSessions.delete(id);
    }
  }
}

/**
 * Kills a session's process along with anything it started.
 *
 * The process we hold is the shell, not the command the caller asked for, so
 * signalling it alone would leave the real work running as an orphan — a
 * pipeline like `npm start | tee log` keeps both halves alive. Each platform
 * needs its own way to reach the children: POSIX signals the process group the
 * shell leads, Windows walks the parent-child tree with `taskkill /T`.
 */
export function killExecSession(session: ExecSession): void {
  const pid = session.proc.pid;
  if (pid) {
    if (process.platform === "win32") {
      try {
        Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(pid)], {
          stdout: "ignore",
          stderr: "ignore",
        });
      } catch {
        // taskkill is missing or the tree is already gone; fall through to kill().
      }
    } else {
      try {
        // Negative pid means "the whole process group", which the shell leads
        // because it was spawned detached.
        process.kill(-pid, "SIGKILL");
      } catch {
        // No such group, or it exited between the check and the signal.
      }
    }
  }
  try {
    session.proc.kill();
  } catch {
    // Already gone.
  }
}

/** Kills every resident process. Called when an MCP session goes away. */
export function disposeExecSessions(state: SessionState): void {
  for (const session of state.execSessions.values()) {
    killExecSession(session);
  }
  state.execSessions.clear();
}

let chunkCounter = 0;
export function generateChunkId(): string {
  chunkCounter += 1;
  return `chunk-${chunkCounter}`;
}
