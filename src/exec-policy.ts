import type { AppConfig } from "./types.js";

/**
 * Policy check for `exec_command`, which takes a free-form shell string rather
 * than the (command, args) pair `run_command` uses.
 *
 * This is a GUARDRAIL, NOT A SANDBOX. It exists so a model cannot casually reach
 * for `curl` or `rm -rf /` when the operator only meant to expose a build
 * toolchain — it is not a security boundary. The default allowlist already
 * contains `node`, `python` and `bun`, any of which will run arbitrary code in
 * one line. Output redirection (`> /etc/hosts`) also escapes the work directory.
 * Treat the work directory, and the machine running the bridge, as fully
 * reachable by whoever can call these tools.
 */

export class ExecPolicyError extends Error {}

/**
 * Splits a shell string into command segments, dropping redirection operators
 * and their targets. Throws when the string uses command substitution, which
 * would hide a command from the allowlist entirely.
 */
export function splitShellSegments(cmd: string): string[][] {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let hasToken = false;
  let skipNextToken = false;

  const endToken = () => {
    if (!hasToken) return;
    if (skipNextToken) {
      skipNextToken = false;
    } else {
      tokens.push(token);
    }
    token = "";
    hasToken = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
    skipNextToken = false;
  };

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;

    if (ch === "'") {
      const close = cmd.indexOf("'", i + 1);
      if (close === -1) throw new ExecPolicyError("Unterminated single quote in cmd");
      token += cmd.slice(i + 1, close);
      hasToken = true;
      i = close;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        if (cmd[j] === "\\") {
          token += cmd[j + 1] ?? "";
          j += 1;
          continue;
        }
        if (cmd[j] === "`" || (cmd[j] === "$" && cmd[j + 1] === "(")) {
          throw new ExecPolicyError(
            "Command substitution ($(...) or backticks) is not allowed under exec.mode=\"allowlist\"",
          );
        }
        token += cmd[j];
      }
      if (j >= cmd.length) throw new ExecPolicyError("Unterminated double quote in cmd");
      hasToken = true;
      i = j;
      continue;
    }

    if (ch === "`" || (ch === "$" && cmd[i + 1] === "(")) {
      throw new ExecPolicyError(
        "Command substitution ($(...) or backticks) is not allowed under exec.mode=\"allowlist\"",
      );
    }

    if (ch === "\\") {
      token += cmd[i + 1] ?? "";
      hasToken = true;
      i += 1;
      continue;
    }

    if (ch === " " || ch === "\t") {
      endToken();
      continue;
    }

    // Anything that starts a new command position.
    if (ch === ";" || ch === "\n" || ch === "|" || ch === "&" || ch === "(" || ch === ")") {
      endSegment();
      continue;
    }

    // Redirections: the following word is a filename, not a command.
    if (ch === ">" || ch === "<") {
      endToken();
      while (cmd[i + 1] === ">" || cmd[i + 1] === "<" || cmd[i + 1] === "&") i += 1;
      skipNextToken = true;
      continue;
    }

    token += ch;
    hasToken = true;
  }

  endSegment();
  return segments;
}

/** The set of binaries `exec_command` may invoke under allowlist mode. */
export function effectiveAllowlist(config: AppConfig): string[] {
  return [...new Set([...config.allowedCommands, ...config.exec.extraAllowedCommands])].sort();
}

/** Strips directory and Windows extension so `/usr/bin/node` matches `node`. */
function commandName(token: string): string {
  const base = token.split(/[\\/]/).pop() ?? token;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Throws `ExecPolicyError` when `cmd` would run anything outside the effective
 * allowlist. A no-op when `exec.mode` is `"unrestricted"`.
 */
export function assertExecAllowed(cmd: string, config: AppConfig): void {
  if (config.exec.mode === "unrestricted") return;

  const allowed = effectiveAllowlist(config);
  const segments = splitShellSegments(cmd);

  if (segments.length === 0) {
    throw new ExecPolicyError("cmd is empty");
  }

  for (const tokens of segments) {
    // Leading VAR=value assignments precede the actual command.
    const commandToken = tokens.find((t) => !ENV_ASSIGNMENT.test(t));
    if (commandToken === undefined) continue;

    if (!allowed.includes(commandName(commandToken))) {
      throw new ExecPolicyError(
        `Command not allowed: "${commandToken}". Allowed: ${allowed.join(", ")}. ` +
          `Set exec.mode to "unrestricted" in the config to lift this restriction.`,
      );
    }
  }
}
