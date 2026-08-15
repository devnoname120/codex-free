import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_IGNORE,
  buildIgnore,
  fastGlobIgnore,
  isIgnored,
  shouldPrune,
  toRelPosix,
} from "../ignore.js";
import globTool from "../tools/glob.js";
import grepTool from "../tools/grep.js";
import treeTool from "../tools/tree.js";
import listTool from "../tools/list-directory.js";
import { createSessionState } from "../types.js";
import type { AppConfig, IgnoreConfig, ToolDefinition } from "../types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-ignore-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(ignore?: IgnoreConfig, workDir = root): AppConfig {
  return {
    workDir,
    port: 3000,
    allowedCommands: [],
    tree: { defaultDepth: 5, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
    ignore: ignore ?? {},
  };
}

function write(rel: string, content = "x"): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

/** Runs a tool handler and returns its single text block. */
async function runText(tool: ToolDefinition, args: Record<string, unknown>, config: AppConfig): Promise<string> {
  const res = await tool.handler(args, config, createSessionState());
  return res.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

describe("toRelPosix", () => {
  test("returns null for the work directory itself and for paths outside it", () => {
    expect(toRelPosix(root, root)).toBeNull();
    expect(toRelPosix(join(root, "..", "elsewhere"), root)).toBeNull();
  });

  test("returns a forward-slash relative path for a child", () => {
    expect(toRelPosix(join(root, "src", "a.ts"), root)).toBe("src/a.ts");
  });
});

describe("buildIgnore", () => {
  test("ignores the default heavy directories by name and by content", () => {
    const ig = buildIgnore(makeConfig());
    for (const name of DEFAULT_IGNORE) {
      expect(isIgnored(ig, join(root, name), root)).toBe(true);
      expect(isIgnored(ig, join(root, name, "deep", "file.js"), root)).toBe(true);
    }
    expect(isIgnored(ig, join(root, "src", "index.ts"), root)).toBe(false);
  });

  test("reads the work directory's .gitignore", () => {
    write(".gitignore", "secret.txt\nlogs/\n");
    const ig = buildIgnore(makeConfig());
    expect(isIgnored(ig, join(root, "secret.txt"), root)).toBe(true);
    expect(isIgnored(ig, join(root, "logs", "today.log"), root)).toBe(true);
    expect(isIgnored(ig, join(root, "keep.txt"), root)).toBe(false);
  });

  test("reads .git/info/exclude", () => {
    write(join(".git", "info", "exclude"), "local-only.tmp\n");
    const ig = buildIgnore(makeConfig());
    expect(isIgnored(ig, join(root, "local-only.tmp"), root)).toBe(true);
  });

  test("useDefaultPatterns:false stops skipping the built-in set", () => {
    const ig = buildIgnore(makeConfig({ useDefaultPatterns: false }));
    expect(isIgnored(ig, join(root, "dist", "app.js"), root)).toBe(false);
  });

  test("useGitignore:false stops reading .gitignore", () => {
    write(".gitignore", "secret.txt\n");
    const ig = buildIgnore(makeConfig({ useGitignore: false }));
    expect(isIgnored(ig, join(root, "secret.txt"), root)).toBe(false);
  });

  test("customPatterns are applied on top", () => {
    const ig = buildIgnore(makeConfig({ customPatterns: ["*.snap"] }));
    expect(isIgnored(ig, join(root, "a.snap"), root)).toBe(true);
  });
});

describe("shouldPrune", () => {
  test("always prunes node_modules and .git even with defaults off", () => {
    const ig = buildIgnore(makeConfig({ useDefaultPatterns: false }));
    expect(shouldPrune(ig, "node_modules", join(root, "node_modules"), root)).toBe(true);
    expect(shouldPrune(ig, ".git", join(root, ".git"), root)).toBe(true);
    expect(shouldPrune(ig, "dist", join(root, "dist"), root)).toBe(false);
  });
});

describe("fastGlobIgnore", () => {
  test("expands the default set to fast-glob globs", () => {
    const globs = fastGlobIgnore(makeConfig());
    expect(globs).toContain("**/node_modules");
    expect(globs).toContain("**/node_modules/**");
    expect(globs).toContain("**/dist/**");
  });

  test("falls back to only node_modules and .git when defaults are off", () => {
    expect(fastGlobIgnore(makeConfig({ useDefaultPatterns: false }))).toEqual([
      "**/node_modules/**",
      "**/.git/**",
    ]);
  });
});

describe("glob tool", () => {
  test("does not descend node_modules and respects .gitignore", async () => {
    write("src/a.ts");
    write("node_modules/pkg/index.ts");
    write("secret.ts");
    write(".gitignore", "secret.ts\n");

    const out = await runText(globTool, { pattern: "**/*.ts" }, makeConfig());
    expect(out).toContain("src/a.ts");
    expect(out).not.toContain("node_modules");
    expect(out).not.toContain("secret.ts");
  });
});

describe("grep tool", () => {
  test("skips node_modules and .gitignore'd files", async () => {
    write("src/a.ts", "needle here");
    write("node_modules/pkg/b.ts", "needle here");
    write("ignored.ts", "needle here");
    write(".gitignore", "ignored.ts\n");

    const out = await runText(grepTool, { pattern: "needle" }, makeConfig());
    expect(out).toContain("src/a.ts");
    expect(out).not.toContain("node_modules");
    expect(out).not.toContain("ignored.ts");
  });
});

describe("tree tool", () => {
  test("omits ignored directories and files", async () => {
    write("src/a.ts");
    write("node_modules/pkg/index.ts");
    write("build/out.js");
    write("keep.txt");
    write(".gitignore", "build/\n");

    const out = await runText(treeTool, {}, makeConfig());
    expect(out).toContain("src");
    expect(out).toContain("keep.txt");
    expect(out).not.toContain("node_modules");
    expect(out).not.toContain("build");
  });
});

describe("list_directory tool", () => {
  test("hides ignored entries from a normal directory", async () => {
    write("src/a.ts");
    write("node_modules/pkg/index.ts");
    write("keep.txt");

    const out = await runText(listTool, {}, makeConfig());
    expect(out).toContain("keep.txt");
    expect(out).toContain("src/");
    expect(out).not.toContain("node_modules");
  });

  test("still lists contents when pointed straight at an ignored directory", async () => {
    write("node_modules/pkg/index.ts");

    const out = await runText(listTool, { path: "node_modules" }, makeConfig());
    expect(out).toContain("pkg");
  });
});
