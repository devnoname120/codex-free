import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ROOT_MARKERS,
  PROJECT_DOC_MAX_BYTES,
  candidateFilenames,
  findProjectRoot,
  loadProjectDoc,
  projectDocPaths,
} from "../project-doc.js";
import type { AppConfig, ProjectDocConfig } from "../types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-free-doc-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(workDir: string, projectDoc?: ProjectDocConfig): AppConfig {
  return {
    workDir,
    port: 3000,
    allowedCommands: ["git"],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
    ...(projectDoc ? { projectDoc } : {}),
  };
}

/** Creates `<root>/<dir>` and writes `name` into it, returning the file path. */
function write(dir: string, name: string, contents: string): string {
  const target = join(root, dir);
  mkdirSync(target, { recursive: true });
  const path = join(target, name);
  writeFileSync(path, contents);
  return path;
}

describe("candidateFilenames", () => {
  test("tries the local override ahead of AGENTS.md", () => {
    expect(candidateFilenames()).toEqual(["AGENTS.override.md", "AGENTS.md"]);
  });

  test("appends configured fallbacks without duplicating or keeping blanks", () => {
    expect(
      candidateFilenames({ fallbackFilenames: ["CLAUDE.md", "AGENTS.md", "", "CLAUDE.md"] }),
    ).toEqual(["AGENTS.override.md", "AGENTS.md", "CLAUDE.md"]);
  });
});

describe("findProjectRoot", () => {
  test("returns the nearest ancestor holding a marker", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    mkdirSync(join(root, "repo", "src", "deep"), { recursive: true });
    expect(findProjectRoot(join(root, "repo", "src", "deep"), DEFAULT_ROOT_MARKERS)).toBe(
      join(root, "repo"),
    );
  });

  test("counts the start directory itself", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    expect(findProjectRoot(join(root, "repo"), DEFAULT_ROOT_MARKERS)).toBe(join(root, "repo"));
  });

  test("returns null when no ancestor has one, rather than walking to the filesystem root", () => {
    mkdirSync(join(root, "loose"), { recursive: true });
    expect(findProjectRoot(join(root, "loose"), ["marker-that-does-not-exist"])).toBeNull();
  });

  test("an empty marker list disables the walk", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    expect(findProjectRoot(join(root, "repo"), [])).toBeNull();
  });
});

describe("projectDocPaths", () => {
  test("collects one doc per directory from the project root down to the work dir", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    const outer = write("repo", "AGENTS.md", "outer");
    const inner = write("repo/src", "AGENTS.md", "inner");
    expect(projectDocPaths(makeConfig(join(root, "repo", "src")))).toEqual([outer, inner]);
  });

  test("prefers AGENTS.override.md over AGENTS.md in the same directory", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    const override = write("repo", "AGENTS.override.md", "override");
    write("repo", "AGENTS.md", "plain");
    expect(projectDocPaths(makeConfig(join(root, "repo")))).toEqual([override]);
  });

  test("stops at the project root, so a doc above the repo is ignored", () => {
    write("", "AGENTS.md", "above the repo");
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    const inside = write("repo", "AGENTS.md", "inside");
    expect(projectDocPaths(makeConfig(join(root, "repo")))).toEqual([inside]);
  });

  test("searches only the work dir when nothing marks a project root", () => {
    write("", "AGENTS.md", "above");
    const own = write("loose", "AGENTS.md", "own");
    expect(projectDocPaths(makeConfig(join(root, "loose")))).toEqual([own]);
  });

  test("honours configured root markers and fallback filenames", () => {
    write("repo", "package.json", "{}");
    const doc = write("repo", "CONTRIBUTING.md", "fallback");
    expect(
      projectDocPaths(
        makeConfig(join(root, "repo"), {
          rootMarkers: ["package.json"],
          fallbackFilenames: ["CONTRIBUTING.md"],
        }),
      ),
    ).toEqual([doc]);
  });

  test("returns nothing when the project has no doc", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    expect(projectDocPaths(makeConfig(join(root, "repo")))).toEqual([]);
  });
});

describe("loadProjectDoc", () => {
  test("concatenates outermost first so a nested doc qualifies the one above it", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    write("repo", "AGENTS.md", "root rules");
    write("repo/src", "AGENTS.md", "src rules");
    expect(loadProjectDoc(makeConfig(join(root, "repo", "src")))!.text).toBe(
      "root rules\n\nsrc rules",
    );
  });

  test("returns null rather than an empty doc when there is nothing to say", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    expect(loadProjectDoc(makeConfig(join(root, "repo")))).toBeNull();
  });

  test("skips a whitespace-only doc without spending any of the budget", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    write("repo", "AGENTS.md", "   \n\n\t\n");
    write("repo/src", "AGENTS.md", "real rules");
    const doc = loadProjectDoc(makeConfig(join(root, "repo", "src")))!;
    expect(doc.entries.map((e) => e.contents)).toEqual(["real rules"]);
  });

  test("cuts a doc short at the byte budget and says so", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    write("repo", "AGENTS.md", "abcdefghij");
    const doc = loadProjectDoc(makeConfig(join(root, "repo"), { maxBytes: 4 }))!;
    expect(doc.entries[0]!.contents).toBe("abcd");
    expect(doc.entries[0]!.truncated).toBe(true);
  });

  test("shares one budget across docs, so a later one gets what the first left", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    write("repo", "AGENTS.md", "12345");
    write("repo/src", "AGENTS.md", "67890");
    const doc = loadProjectDoc(makeConfig(join(root, "repo", "src"), { maxBytes: 8 }))!;
    expect(doc.entries.map((e) => e.contents)).toEqual(["12345", "678"]);
    expect(doc.entries.map((e) => e.truncated)).toEqual([false, true]);
  });

  test("counts bytes, not characters, the way Codex does", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    // "é" is two bytes in UTF-8, so a four-byte budget holds two of them.
    write("repo", "AGENTS.md", "ééé");
    expect(loadProjectDoc(makeConfig(join(root, "repo"), { maxBytes: 4 }))!.text).toBe("éé");
  });

  test("maxBytes of zero disables discovery entirely", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    write("repo", "AGENTS.md", "rules");
    expect(loadProjectDoc(makeConfig(join(root, "repo"), { maxBytes: 0 }))).toBeNull();
  });

  test("defaults to Codex's 32 KiB budget", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    write("repo", "AGENTS.md", "x".repeat(PROJECT_DOC_MAX_BYTES + 10));
    const doc = loadProjectDoc(makeConfig(join(root, "repo")))!;
    expect(doc.text.length).toBe(PROJECT_DOC_MAX_BYTES);
    expect(doc.entries[0]!.truncated).toBe(true);
  });
});
