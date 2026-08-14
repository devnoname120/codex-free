import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  openSync,
  closeSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MEMORY_MAX_BYTES,
  loadMemory,
  lockPath,
  memoryDir,
  memoryEnabled,
  memoryMaxBytes,
  memoryPath,
  notesBytes,
  remember,
  renderMemory,
  savePlan,
} from "../memory.js";
import type { AppConfig, MemoryConfig } from "../types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-free-mem-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(memory?: MemoryConfig): AppConfig {
  return {
    workDir: join(root, "work"),
    port: 3000,
    allowedCommands: ["git"],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
    memory: { dir: join(root, "state"), ...memory },
  };
}

const NOW = "2026-01-01T00:00:00.000Z";

describe("memoryDir", () => {
  test("defaults to a per-project directory under the home directory", () => {
    const config = makeConfig();
    delete config.memory!.dir;
    const dir = memoryDir(config);
    expect(dir.startsWith(join(homedir(), ".codex-free", "projects"))).toBe(true);
    // Never inside the repository being worked on.
    expect(dir.startsWith(config.workDir)).toBe(false);
  });

  // Two checkouts of the same repo are different tasks and must not share notes.
  test("keys on the absolute work directory, not on its name", () => {
    const a = makeConfig();
    const b = makeConfig();
    delete a.memory!.dir;
    delete b.memory!.dir;
    b.workDir = join(root, "other", "work");
    expect(memoryDir(a)).not.toBe(memoryDir(b));
  });

  test("an explicit dir wins", () => {
    expect(memoryDir(makeConfig())).toBe(join(root, "state"));
    expect(memoryPath(makeConfig())).toBe(join(root, "state", "memory.json"));
  });
});

describe("memoryEnabled and memoryMaxBytes", () => {
  test("memory is on unless explicitly disabled", () => {
    expect(memoryEnabled(makeConfig())).toBe(true);
    expect(memoryEnabled(makeConfig({ enabled: true }))).toBe(true);
    expect(memoryEnabled(makeConfig({ enabled: false }))).toBe(false);
  });

  test("the byte budget falls back to the default", () => {
    expect(memoryMaxBytes(makeConfig())).toBe(DEFAULT_MEMORY_MAX_BYTES);
    expect(memoryMaxBytes(makeConfig({ maxBytes: 64 }))).toBe(64);
  });
});

describe("loadMemory", () => {
  test("returns an empty memory when nothing was ever written", () => {
    const memory = loadMemory(makeConfig());
    expect(memory.plan).toBeNull();
    expect(memory.notes).toEqual({});
  });

  // A corrupt state file must not take the session down with it.
  test("degrades to empty on unparseable JSON", () => {
    const config = makeConfig();
    remember(config, "k", "v", NOW);
    writeFileSync(memoryPath(config), "{ not json");
    expect(loadMemory(config).notes).toEqual({});
  });

  test("drops malformed note entries but keeps the good ones", () => {
    const config = makeConfig();
    remember(config, "good", "kept", NOW);
    const raw = JSON.parse(readFileSync(memoryPath(config), "utf8"));
    raw.notes.bad = { value: 42 };
    writeFileSync(memoryPath(config), JSON.stringify(raw));
    const notes = loadMemory(config).notes;
    expect(Object.keys(notes)).toEqual(["good"]);
  });

  test("reads nothing while memory is disabled", () => {
    const config = makeConfig();
    remember(config, "k", "v", NOW);
    const disabled = makeConfig({ enabled: false });
    expect(loadMemory(disabled).notes).toEqual({});
  });
});

describe("remember", () => {
  test("stores a note and reports the budget used", () => {
    const config = makeConfig();
    const result = remember(config, "why-bun", "Because the runtime ships a test runner.", NOW);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("why-bun");
    expect(loadMemory(config).notes["why-bun"]).toEqual({
      value: "Because the runtime ships a test runner.",
      updated_at: NOW,
    });
  });

  test("survives a reload from disk", () => {
    const config = makeConfig();
    remember(config, "k", "first", NOW);
    expect(existsSync(memoryPath(config))).toBe(true);
    expect(loadMemory(makeConfig()).notes["k"]!.value).toBe("first");
  });

  // Overwriting is what keeps memory current; an append log would accumulate
  // contradictory entries until it was worthless.
  test("writing a key again replaces it", () => {
    const config = makeConfig();
    remember(config, "k", "first", NOW);
    remember(config, "k", "second", "2026-02-02T00:00:00.000Z");
    const notes = loadMemory(config).notes;
    expect(Object.keys(notes)).toEqual(["k"]);
    expect(notes["k"]).toEqual({ value: "second", updated_at: "2026-02-02T00:00:00.000Z" });
  });

  test("an empty value removes the key", () => {
    const config = makeConfig();
    remember(config, "k", "v", NOW);
    const result = remember(config, "k", "   ", NOW);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Removed");
    expect(loadMemory(config).notes).toEqual({});
  });

  test("removing a key that was never there is an error, not a silent no-op", () => {
    const result = remember(makeConfig(), "ghost", "", NOW);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ghost");
  });

  test("keys are trimmed", () => {
    const config = makeConfig();
    remember(config, "  spaced  ", "v", NOW);
    expect(Object.keys(loadMemory(config).notes)).toEqual(["spaced"]);
  });

  // Rejected rather than evicted: the model knows which of its own notes matter
  // least, and this server does not.
  test("a note over the budget is rejected and nothing is stored", () => {
    const config = makeConfig({ maxBytes: 40 });
    remember(config, "keep", "small", NOW);
    const result = remember(config, "big", "x".repeat(100), NOW);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("40-byte budget");
    expect(result.message).toContain("keep");
    expect(Object.keys(loadMemory(config).notes)).toEqual(["keep"]);
  });

  test("notesBytes counts keys as well as values", () => {
    expect(notesBytes({ ab: { value: "cde", updated_at: NOW } })).toBe(5);
  });
});

describe("savePlan", () => {
  test("stores the plan without disturbing the notes", () => {
    const config = makeConfig();
    remember(config, "k", "v", NOW);
    savePlan(config, { explanation: "why", plan: [{ step: "one", status: "pending" }] });
    const memory = loadMemory(config);
    expect(memory.plan?.plan).toEqual([{ step: "one", status: "pending" }]);
    expect(memory.notes["k"]!.value).toBe("v");
  });

  test("returns false instead of throwing when memory is disabled", () => {
    expect(savePlan(makeConfig({ enabled: false }), null)).toBe(false);
  });
});

describe("durability", () => {
  // The temp file an atomic write goes through, and the write lock, must both be
  // gone once the call returns — a stray temp would read back as a phantom file
  // and a stray lock would stall the next writer until it went stale.
  test("leaves no temp or lock files behind", () => {
    const config = makeConfig();
    remember(config, "k", "v", NOW);
    savePlan(config, { plan: [{ step: "one", status: "pending" }] });
    const entries = readdirSync(memoryDir(config));
    expect(entries).toEqual(["memory.json"]);
  });

  // A writer that crashed mid-write leaves its lock; a later writer must steal it
  // once it is old enough rather than wait on it forever.
  test("steals a stale lock and still writes", () => {
    const config = makeConfig();
    remember(config, "before", "x", NOW);
    const lock = lockPath(config);
    closeSync(openSync(lock, "w"));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);

    const result = remember(config, "after", "y", NOW);
    expect(result.ok).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(Object.keys(loadMemory(config).notes).sort()).toEqual(["after", "before"]);
  });

  // Losing the lock race must degrade to a valid write, not a dropped note: a
  // fresh foreign lock is waited on, then the write proceeds anyway.
  test("still writes when a live lock is held, degrading to last-writer-wins", () => {
    const config = makeConfig();
    const lock = lockPath(config);
    remember(config, "seed", "1", NOW);
    const held = openSync(lock, "w"); // simulate another writer holding the lock
    try {
      const result = remember(config, "raced", "2", NOW);
      expect(result.ok).toBe(true);
      expect(loadMemory(config).notes["raced"]!.value).toBe("2");
    } finally {
      closeSync(held);
      rmSync(lock, { force: true });
    }
  });
});

describe("renderMemory", () => {
  test("returns null when there is nothing to hand over", () => {
    expect(renderMemory(loadMemory(makeConfig()))).toBeNull();
  });

  test("renders the plan as a checklist with progress", () => {
    const config = makeConfig();
    savePlan(config, {
      explanation: "Porting the tools",
      plan: [
        { step: "one", status: "completed" },
        { step: "two", status: "in_progress" },
        { step: "three", status: "pending" },
      ],
    });
    const rendered = renderMemory(loadMemory(config))!;
    expect(rendered).toContain("Plan in progress:");
    expect(rendered).toContain("Porting the tools");
    expect(rendered).toContain("[x] one");
    expect(rendered).toContain("[~] two");
    expect(rendered).toContain("[ ] three");
    expect(rendered).toContain("1/3 steps completed");
  });

  test("renders notes sorted by key", () => {
    const config = makeConfig();
    remember(config, "zeta", "last", NOW);
    remember(config, "alpha", "first", NOW);
    const rendered = renderMemory(loadMemory(config))!;
    expect(rendered.indexOf("alpha")).toBeLessThan(rendered.indexOf("zeta"));
    expect(rendered).toContain("- alpha: first");
  });

  test("an empty plan does not produce an empty section", () => {
    const config = makeConfig();
    savePlan(config, { plan: [] });
    remember(config, "k", "v", NOW);
    const rendered = renderMemory(loadMemory(config))!;
    expect(rendered).not.toContain("Plan in progress");
    expect(rendered).toContain("Notes:");
  });
});
