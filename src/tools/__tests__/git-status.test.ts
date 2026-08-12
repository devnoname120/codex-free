import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import gitStatusTool from "../git-status.js";
import type { AppConfig } from "../../types.js";

function makeConfig(workDir: string): AppConfig {
  return {
    workDir,
    port: 3000,
    allowedCommands: [],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
  };
}

describe("git_status", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "codex-git-test-"));
    Bun.spawnSync(["git", "init"], { cwd: workDir });
    Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: workDir });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: workDir });
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true });
  });

  test("returns clean status on empty repo with initial commit", async () => {
    await writeFile(join(workDir, "init.txt"), "init");
    Bun.spawnSync(["git", "add", "."], { cwd: workDir });
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: workDir });

    const result = await gitStatusTool.handler({}, makeConfig(workDir));
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("clean");
  });

  test("shows untracked files", async () => {
    await writeFile(join(workDir, "new-file.txt"), "new");
    const result = await gitStatusTool.handler({}, makeConfig(workDir));
    expect(result.content[0].text).toContain("new-file.txt");
    expect(result.content[0].text).toContain("??");
  });
});
