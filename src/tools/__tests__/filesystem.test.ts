import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import globTool from "../glob.js";
import grepTool from "../grep.js";
import listDirectoryTool from "../list-directory.js";
import treeTool from "../tree.js";
import type { AppConfig } from "../../types.js";

function makeConfig(workDir: string): AppConfig {
  return {
    workDir,
    port: 3000,
    allowedCommands: [],
    tree: { defaultDepth: 3, ignore: ["node_modules", ".git"] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
  };
}

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "codex-fs-test-"));
  await mkdir(join(workDir, "src"), { recursive: true });
  await mkdir(join(workDir, "docs"), { recursive: true });
  await writeFile(join(workDir, "src/index.ts"), "export const hello = 'world';\nconsole.log(hello);\n");
  await writeFile(join(workDir, "src/utils.ts"), "export function add(a: number, b: number) { return a + b; }\n");
  await writeFile(join(workDir, "docs/README.md"), "# Hello\nThis is a readme.\n");
  await writeFile(join(workDir, "package.json"), '{"name": "test"}');
});

afterAll(async () => {
  await rm(workDir, { recursive: true });
});

describe("glob", () => {
  test("finds files matching pattern", async () => {
    const result = await globTool.handler({ pattern: "**/*.ts" }, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("src/index.ts");
    expect(text).toContain("src/utils.ts");
    expect(text).not.toContain("README.md");
  });

  test("finds in subdirectory", async () => {
    const result = await globTool.handler({ pattern: "*.md", path: "docs" }, makeConfig(workDir));
    expect(result.content[0].text).toContain("README.md");
  });
});

describe("grep", () => {
  test("finds matching lines", async () => {
    const result = await grepTool.handler({ pattern: "hello" }, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("index.ts");
    expect(text).toContain("hello");
  });

  test("includes context lines", async () => {
    const result = await grepTool.handler({ pattern: "hello", context: 1 }, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("console.log");
  });

  test("filters by include pattern", async () => {
    const result = await grepTool.handler({ pattern: "Hello", include: "*.md" }, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("README.md");
    expect(text).not.toContain("index.ts");
  });
});

describe("list_directory", () => {
  test("lists root directory", async () => {
    const result = await listDirectoryTool.handler({}, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("src");
    expect(text).toContain("docs");
    expect(text).toContain("package.json");
  });

  test("lists subdirectory", async () => {
    const result = await listDirectoryTool.handler({ path: "src" }, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("index.ts");
    expect(text).toContain("utils.ts");
  });
});

describe("tree", () => {
  test("shows directory tree", async () => {
    const result = await treeTool.handler({}, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("src");
    expect(text).toContain("index.ts");
    expect(text).toContain("docs");
  });

  test("respects depth limit", async () => {
    const result = await treeTool.handler({ depth: 1 }, makeConfig(workDir));
    const text = result.content[0].text;
    expect(text).toContain("src");
    expect(text).not.toContain("index.ts");
  });
});
