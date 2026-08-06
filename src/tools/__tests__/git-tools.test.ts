import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import gitCommitTool from "../git-commit.js";
import gitLogTool from "../git-log.js";
import type { AppConfig } from "../../types.js";

function makeConfig(workDir: string): AppConfig {
  return {
    workDir,
    port: 3000,
    allowedCommands: [],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
  };
}

describe("git_commit", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "codex-git-commit-test-"));
    Bun.spawnSync(["git", "init"], { cwd: workDir });
    Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: workDir });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: workDir });
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true });
  });

  test("commits staged changes", async () => {
    await writeFile(join(workDir, "file.txt"), "content");
    Bun.spawnSync(["git", "add", "file.txt"], { cwd: workDir });
    const result = await gitCommitTool.handler({ message: "initial commit" }, makeConfig(workDir));
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("initial commit");
  });

  test("commits with -a flag", async () => {
    await writeFile(join(workDir, "file.txt"), "updated content");
    const result = await gitCommitTool.handler({ message: "update file", all: true }, makeConfig(workDir));
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("update file");
  });

  test("fails when nothing to commit", async () => {
    const result = await gitCommitTool.handler({ message: "empty" }, makeConfig(workDir));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nothing to commit");
  });
});

describe("git_log", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "codex-git-log-test-"));
    Bun.spawnSync(["git", "init"], { cwd: workDir });
    Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: workDir });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: workDir });
    await writeFile(join(workDir, "a.txt"), "a");
    Bun.spawnSync(["git", "add", "."], { cwd: workDir });
    Bun.spawnSync(["git", "commit", "-m", "first commit"], { cwd: workDir });
    await writeFile(join(workDir, "b.txt"), "b");
    Bun.spawnSync(["git", "add", "."], { cwd: workDir });
    Bun.spawnSync(["git", "commit", "-m", "second commit"], { cwd: workDir });
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true });
  });

  test("shows commit history", async () => {
    const result = await gitLogTool.handler({}, makeConfig(workDir));
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("first commit");
    expect(result.content[0].text).toContain("second commit");
  });

  test("limits count", async () => {
    const result = await gitLogTool.handler({ count: 1 }, makeConfig(workDir));
    expect(result.content[0].text).toContain("second commit");
    expect(result.content[0].text).not.toContain("first commit");
  });

  test("supports oneline format", async () => {
    const result = await gitLogTool.handler({ oneline: true }, makeConfig(workDir));
    const lines = result.content[0].text.trim().split("\n");
    expect(lines.length).toBe(2);
  });
});
