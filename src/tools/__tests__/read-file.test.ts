import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import readFileTool from "../read-file.js";
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

describe("read_file", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "codex-test-"));
    await writeFile(join(workDir, "hello.txt"), "line1\nline2\nline3\nline4\nline5\n");
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true });
  });

  test("reads entire file with line numbers", async () => {
    const result = await readFileTool.handler({ path: "hello.txt" }, makeConfig(workDir));
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("1\tline1");
    expect(result.content[0].text).toContain("5\tline5");
  });

  test("reads with offset and limit", async () => {
    const result = await readFileTool.handler({ path: "hello.txt", offset: 2, limit: 2 }, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("3\tline3");
    expect(text).toContain("4\tline4");
    expect(text).not.toContain("1\tline1");
  });

  test("rejects path traversal", async () => {
    const result = await readFileTool.handler({ path: "../../etc/passwd" }, makeConfig(workDir));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Path must be within work directory");
  });

  test("returns error for missing file", async () => {
    const result = await readFileTool.handler({ path: "nope.txt" }, makeConfig(workDir));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("File not found");
  });
});
