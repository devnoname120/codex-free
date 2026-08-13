import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readFile from "../read-file.js";
import globTool from "../glob.js";
import listDirectory from "../list-directory.js";
import tree from "../tree.js";
import type { AppConfig, OutputConfig } from "../../types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-free-caps-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(output?: OutputConfig): AppConfig {
  return {
    workDir: root,
    port: 3000,
    allowedCommands: [],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
    ...(output ? { output } : {}),
  };
}

const text = (result: { content: { text?: string }[] }) => result.content[0]!.text!;

describe("read_file", () => {
  beforeEach(() => {
    writeFileSync(
      join(root, "big.txt"),
      Array.from({ length: 50 }, (_, i) => `line${i + 1}`).join("\n"),
    );
  });

  test("stops at the line budget and names the offset to continue from", async () => {
    const result = await readFile.handler({ path: "big.txt" }, makeConfig({ maxFileLines: 10 }));
    const body = text(result);
    expect(body).toContain("10\tline10");
    expect(body).not.toContain("11\tline11");
    expect(body).toContain("(showing lines 1-10 of 50 — call again with offset=10 for the rest)");
  });

  test("the offset it names actually continues the file", async () => {
    const config = makeConfig({ maxFileLines: 10 });
    const body = text(await readFile.handler({ path: "big.txt", offset: 10 }, config));
    expect(body).toContain("11\tline11");
    expect(body).toContain("(showing lines 11-20 of 50");
  });

  test("a small file comes back whole, with no notice", async () => {
    writeFileSync(join(root, "small.txt"), "a\nb");
    const body = text(await readFile.handler({ path: "small.txt" }, makeConfig()));
    expect(body).toBe("1\ta\n2\tb");
  });

  // A line cap alone would return a minified bundle in full.
  test("a single enormous line is cut at the byte budget", async () => {
    writeFileSync(join(root, "bundle.js"), "x".repeat(10_000));
    const body = text(
      await readFile.handler({ path: "bundle.js" }, makeConfig({ maxFileBytes: 500 })),
    );
    expect(body.length).toBeLessThan(1_000);
    expect(body).toContain("cut at the byte budget");
  });
});

describe("glob", () => {
  test("cuts the match list and says how to narrow it", async () => {
    for (let i = 0; i < 20; i++) writeFileSync(join(root, `f${i}.ts`), "");
    const body = text(await globTool.handler({ pattern: "*.ts" }, makeConfig({ maxEntries: 5 })));
    expect(body.split("\n").filter((l) => l.endsWith(".ts"))).toHaveLength(5);
    expect(body).toContain("(showing 5 of 20 matches");
    expect(body).toContain("narrow the pattern");
  });

  test("says nothing about limits when everything fit", async () => {
    writeFileSync(join(root, "only.ts"), "");
    const body = text(await globTool.handler({ pattern: "*.ts" }, makeConfig()));
    expect(body).not.toContain("showing");
  });
});

describe("list_directory", () => {
  test("cuts the entry list and points at glob", async () => {
    for (let i = 0; i < 20; i++) writeFileSync(join(root, `f${i}.txt`), "");
    const body = text(await listDirectory.handler({}, makeConfig({ maxEntries: 5 })));
    expect(body).toContain("(showing 5 of 20 entries");
    expect(body).toContain("use glob");
  });

  test("leaves a small directory alone", async () => {
    writeFileSync(join(root, "a.txt"), "");
    const body = text(await listDirectory.handler({}, makeConfig()));
    expect(body).toContain("a.txt");
    expect(body).not.toContain("showing");
  });
});

describe("tree", () => {
  test("stops at the node budget and says how to get less", async () => {
    for (let i = 0; i < 20; i++) writeFileSync(join(root, `f${i}.txt`), "");
    const body = text(await tree.handler({}, makeConfig({ maxTreeNodes: 6 })));
    expect(body).toContain("(stopped at 6 nodes");
    expect(body).toContain('lower "depth"');
  });

  // The budget spans the whole walk, so one huge directory cannot silently
  // starve its siblings out of the output.
  test("the budget is shared across directories, not per directory", async () => {
    for (const dir of ["a", "b"]) {
      mkdirSync(join(root, dir));
      for (let i = 0; i < 10; i++) writeFileSync(join(root, dir, `f${i}.txt`), "");
    }
    const body = text(await tree.handler({}, makeConfig({ maxTreeNodes: 8 })));
    expect(body.split("\n").filter((l) => l.includes("f")).length).toBeLessThanOrEqual(8);
    expect(body).toContain("stopped at 8 nodes");
  });

  test("a tree that fits carries no notice", async () => {
    writeFileSync(join(root, "a.txt"), "");
    const body = text(await tree.handler({}, makeConfig()));
    expect(body).toContain("a.txt");
    expect(body).not.toContain("stopped at");
  });
});
