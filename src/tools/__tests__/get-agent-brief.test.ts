import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import getAgentBrief from "../get-agent-brief.js";
import { buildInstructions } from "../../instructions.js";
import { createSessionState } from "../../types.js";
import type { AppConfig, ToolDefinition } from "../../types.js";

const tool: ToolDefinition = getAgentBrief;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-free-brieftool-"));
  mkdirSync(join(root, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(): AppConfig {
  return {
    workDir: root,
    port: 3000,
    allowedCommands: ["git"],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8, defaultShell: "bash" },
  };
}

describe("get_agent_brief tool", () => {
  test("returns exactly what the initialize instructions carry", async () => {
    // One source of truth: a client that reads instructions and one that calls
    // the tool must end up with the same brief, or they behave differently.
    writeFileSync(join(root, "AGENTS.md"), "Run bun test before committing.");
    const config = makeConfig();
    const result = await tool.handler({}, config, createSessionState());
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe(buildInstructions(config));
  });

  test("covers behaviour, environment and project rules in one call", async () => {
    writeFileSync(join(root, "AGENTS.md"), "Run bun test before committing.");
    const text = (await tool.handler({}, makeConfig(), createSessionState())).content[0]!.text!;
    expect(text).toContain("You are acting as a coding agent");
    expect(text).toContain("Working directory:");
    expect(text).toContain("Run bun test before committing.");
  });

  test("takes no arguments", () => {
    expect(tool.inputSchema.properties).toEqual({});
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  test("works in a project with no AGENTS.md", async () => {
    const result = await tool.handler({}, makeConfig(), createSessionState());
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("You are acting as a coding agent");
  });
});
