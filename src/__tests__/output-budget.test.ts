import { describe, test, expect } from "bun:test";
import {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILE_LINES,
  DEFAULT_MAX_TREE_NODES,
  entryBudget,
  fileBudget,
  limitList,
  treeNodeBudget,
  windowFileLines,
} from "../output-budget.js";
import type { AppConfig, OutputConfig } from "../types.js";

function makeConfig(output?: OutputConfig): AppConfig {
  return {
    workDir: "/tmp",
    port: 3000,
    allowedCommands: ["git"],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
    ...(output ? { output } : {}),
  };
}

const GENEROUS = { maxLines: 10_000, maxBytes: 10_000_000 };

function lines(count: number, text = "x"): string[] {
  return Array.from({ length: count }, (_, i) => `${text}${i}`);
}

describe("budget accessors", () => {
  test("fall back to the defaults when nothing is configured", () => {
    const config = makeConfig();
    expect(fileBudget(config)).toEqual({
      maxLines: DEFAULT_MAX_FILE_LINES,
      maxBytes: DEFAULT_MAX_FILE_BYTES,
    });
    expect(entryBudget(config)).toBe(DEFAULT_MAX_ENTRIES);
    expect(treeNodeBudget(config)).toBe(DEFAULT_MAX_TREE_NODES);
  });

  test("take each configured key on its own", () => {
    const config = makeConfig({ maxFileLines: 10, maxEntries: 7 });
    expect(fileBudget(config)).toEqual({ maxLines: 10, maxBytes: DEFAULT_MAX_FILE_BYTES });
    expect(entryBudget(config)).toBe(7);
  });
});

describe("windowFileLines", () => {
  test("returns the whole file with no notice when it fits", () => {
    const window = windowFileLines(lines(3), 0, undefined, GENEROUS);
    expect(window.lines).toEqual(["x0", "x1", "x2"]);
    expect(window.start).toBe(0);
    expect(window.total).toBe(3);
    expect(window.notice).toBeNull();
  });

  test("caps at the line budget and points at the next window", () => {
    const window = windowFileLines(lines(10), 0, undefined, { ...GENEROUS, maxLines: 4 });
    expect(window.lines).toEqual(["x0", "x1", "x2", "x3"]);
    expect(window.notice).toBe(
      "(showing lines 1-4 of 10 — call again with offset=4 for the rest)",
    );
  });

  test("a requested limit above the budget does not raise it", () => {
    const window = windowFileLines(lines(10), 0, 9, { ...GENEROUS, maxLines: 4 });
    expect(window.lines).toHaveLength(4);
  });

  test("honours a requested limit below the budget", () => {
    const window = windowFileLines(lines(10), 2, 3, GENEROUS);
    expect(window.lines).toEqual(["x2", "x3", "x4"]);
    expect(window.start).toBe(2);
    expect(window.notice).toBe(
      "(showing lines 3-5 of 10 — call again with offset=5 for the rest)",
    );
  });

  test("says so, and offers no next window, at the end of a file", () => {
    const window = windowFileLines(lines(10), 8, undefined, GENEROUS);
    expect(window.lines).toEqual(["x8", "x9"]);
    expect(window.notice).toBe("(showing lines 9-10 of 10)");
  });

  test("an offset past the end returns nothing rather than throwing", () => {
    const window = windowFileLines(lines(3), 99, undefined, GENEROUS);
    expect(window.lines).toEqual([]);
    expect(window.start).toBe(3);
  });

  test("cuts on bytes before the line budget is reached", () => {
    const long = Array.from({ length: 10 }, () => "a".repeat(100));
    const window = windowFileLines(long, 0, undefined, { maxLines: 10, maxBytes: 250 });
    expect(window.lines).toHaveLength(2);
    expect(window.notice).toContain("cut at the byte budget");
    expect(window.notice).toContain("offset=2");
  });

  // The case the byte budget exists for: a minified bundle is one enormous line,
  // which a line cap alone would hand back in full.
  test("returns a prefix when a single line exceeds the whole budget", () => {
    const window = windowFileLines(["b".repeat(5000)], 0, undefined, {
      maxLines: 10,
      maxBytes: 100,
    });
    expect(window.lines).toHaveLength(1);
    expect(window.lines[0]).toHaveLength(100);
    expect(window.notice).toContain("cut at the byte budget");
  });
});

describe("limitList", () => {
  test("passes a short list through untouched", () => {
    expect(limitList([1, 2, 3], 10)).toEqual({ items: [1, 2, 3], dropped: 0 });
  });

  test("cuts and reports the remainder", () => {
    expect(limitList([1, 2, 3, 4], 2)).toEqual({ items: [1, 2], dropped: 2 });
  });

  test("treats a non-positive max as no limit rather than as zero results", () => {
    expect(limitList([1, 2, 3], 0)).toEqual({ items: [1, 2, 3], dropped: 0 });
  });
});
