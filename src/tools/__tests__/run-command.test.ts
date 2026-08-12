import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import runCommandTool from "../run-command.js";
import type { AppConfig } from "../../types.js";

function makeConfig(workDir: string, allowedCommands: string[] = ["echo", "ls", "dir"]): AppConfig {
  return {
    workDir,
    port: 3000,
    allowedCommands,
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
  };
}

describe("run_command", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "codex-test-"));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true });
  });

  test("runs allowed command and returns output", async () => {
    const result = await runCommandTool.handler({ command: "echo", args: ["hello"] }, makeConfig(workDir));
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("hello");
  });

  test("rejects command not in allowlist", async () => {
    const result = await runCommandTool.handler({ command: "curl", args: ["http://evil.com"] }, makeConfig(workDir));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Command not allowed");
    expect(result.content[0].text).toContain("echo");
  });

  test("returns exit code on failure", async () => {
    // On Windows, use a command that will fail. "dir" with a nonexistent path returns exit code 1
    const result = await runCommandTool.handler({ command: "dir", args: ["__nonexistent_path_xyz__"] }, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("exit code");
  });

  test("respects timeout", async () => {
    // On Windows use "ping -n 60 127.0.0.1" instead of "sleep 60"
    // Or just use a cross-platform approach with a long-running command
    const config = makeConfig(workDir, ["ping"]);
    const result = await runCommandTool.handler({ command: "ping", args: ["-n", "60", "127.0.0.1"], timeout: 1000 }, config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("timed out");
  });
});
