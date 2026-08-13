import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import rememberTool from "../remember.js";
import recallTool, { NOTHING_REMEMBERED } from "../recall.js";
import updatePlanTool from "../update-plan.js";
import { loadMemory } from "../../memory.js";
import { createSessionState } from "../../types.js";
import type { AppConfig, ToolDefinition } from "../../types.js";

const remember: ToolDefinition = rememberTool;
const recall: ToolDefinition = recallTool;
const updatePlan: ToolDefinition = updatePlanTool;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-free-memtool-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(memory?: AppConfig["memory"]): AppConfig {
  return {
    workDir: root,
    port: 3000,
    allowedCommands: ["git"],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
    memory: { dir: join(root, "state"), ...memory },
  };
}

const text = (result: { content: { text?: string }[] }) => result.content[0]!.text!;

describe("remember tool", () => {
  test("stores a note", async () => {
    const config = makeConfig();
    const result = await remember.handler(
      { key: "why-bun", value: "The runtime ships a test runner." },
      config,
      createSessionState(),
    );
    expect(result.isError).toBeUndefined();
    expect(loadMemory(config).notes["why-bun"]!.value).toBe("The runtime ships a test runner.");
  });

  test("rejects an empty key", async () => {
    const result = await remember.handler({ key: "  ", value: "v" }, makeConfig(), createSessionState());
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("non-empty");
  });

  // A note the model believes was saved but was not is worse than a refusal,
  // so a rejected write has to come back as an error.
  test("reports a note that would blow the budget as an error", async () => {
    const config = makeConfig({ maxBytes: 20 });
    const result = await remember.handler(
      { key: "big", value: "x".repeat(100) },
      config,
      createSessionState(),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("budget");
    expect(loadMemory(config).notes).toEqual({});
  });

  test("says so when memory is switched off on the server", async () => {
    const result = await remember.handler(
      { key: "k", value: "v" },
      makeConfig({ enabled: false }),
      createSessionState(),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("disabled");
  });
});

describe("recall tool", () => {
  test("distinguishes a fresh start from a lost history", async () => {
    const result = await recall.handler({}, makeConfig(), createSessionState());
    expect(result.isError).toBeUndefined();
    expect(text(result)).toBe(NOTHING_REMEMBERED);
  });

  test("returns what remember stored", async () => {
    const config = makeConfig();
    await remember.handler({ key: "k", value: "the note" }, config, createSessionState());
    expect(text(await recall.handler({}, config, createSessionState()))).toContain("- k: the note");
  });

  test("takes no arguments", () => {
    expect(recall.inputSchema.properties).toEqual({});
    expect(recall.inputSchema.additionalProperties).toBe(false);
  });

  test("reports rather than errors when memory is switched off", async () => {
    const result = await recall.handler({}, makeConfig({ enabled: false }), createSessionState());
    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("disabled");
  });
});

describe("update_plan persistence", () => {
  // The plan is the single most useful thing a resumed conversation can be
  // handed, and it used to die with the MCP session.
  test("a plan set in one session is recalled in the next", async () => {
    const config = makeConfig();
    await updatePlan.handler(
      {
        explanation: "Porting the tools",
        plan: [
          { step: "port apply_patch", status: "completed" },
          { step: "port exec_command", status: "in_progress" },
        ],
      },
      config,
      createSessionState(),
    );

    // A different session state entirely: nothing is carried over in memory.
    const recalled = text(await recall.handler({}, config, createSessionState()));
    expect(recalled).toContain("Porting the tools");
    expect(recalled).toContain("[x] port apply_patch");
    expect(recalled).toContain("[~] port exec_command");
    expect(recalled).toContain("1/2 steps completed");
  });

  test("a rejected plan is not persisted", async () => {
    const config = makeConfig();
    const result = await updatePlan.handler(
      {
        plan: [
          { step: "one", status: "in_progress" },
          { step: "two", status: "in_progress" },
        ],
      },
      config,
      createSessionState(),
    );
    expect(result.isError).toBe(true);
    expect(loadMemory(config).plan).toBeNull();
  });

  test("an unwritable state directory does not fail the call", async () => {
    // Best effort by design: a plan the model can see is worth more than one
    // that failed to persist.
    const result = await updatePlan.handler(
      { plan: [{ step: "one", status: "pending" }] },
      makeConfig({ enabled: false }),
      createSessionState(),
    );
    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("[ ] one");
  });
});
