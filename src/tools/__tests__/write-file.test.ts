import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import writeFileTool from "../write-file.js";
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

describe("write_file", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "codex-test-"));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true });
  });

  test("writes content to a new file", async () => {
    const result = await writeFileTool.handler({ path: "out.txt", content: "hello world" }, makeConfig(workDir));
    expect(result.isError).toBeUndefined();
    const written = await readFile(join(workDir, "out.txt"), "utf-8");
    expect(written).toBe("hello world");
  });

  test("creates parent directories", async () => {
    const result = await writeFileTool.handler({ path: "deep/nested/file.txt", content: "nested" }, makeConfig(workDir));
    expect(result.isError).toBeUndefined();
    const written = await readFile(join(workDir, "deep/nested/file.txt"), "utf-8");
    expect(written).toBe("nested");
  });

  test("overwrites existing file", async () => {
    await writeFileTool.handler({ path: "overwrite.txt", content: "v1" }, makeConfig(workDir));
    await writeFileTool.handler({ path: "overwrite.txt", content: "v2" }, makeConfig(workDir));
    const written = await readFile(join(workDir, "overwrite.txt"), "utf-8");
    expect(written).toBe("v2");
  });

  test("rejects path traversal", async () => {
    const result = await writeFileTool.handler({ path: "../../evil.txt", content: "bad" }, makeConfig(workDir));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Path must be within work directory");
  });
});
