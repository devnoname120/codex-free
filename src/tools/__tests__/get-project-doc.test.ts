import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import getProjectDoc, { renderProjectDoc } from "../get-project-doc.js";
import { loadProjectDoc } from "../../project-doc.js";
import { buildInstructions } from "../../server.js";
import { createSessionState } from "../../types.js";
import type { AppConfig, ToolDefinition } from "../../types.js";

const tool: ToolDefinition = getProjectDoc;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-free-doctool-"));
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

describe("renderProjectDoc", () => {
  test("names the source files ahead of the text", () => {
    writeFileSync(join(root, "AGENTS.md"), "Use tabs.");
    const text = renderProjectDoc(loadProjectDoc(makeConfig()));
    expect(text).toContain(join(root, "AGENTS.md"));
    expect(text).toContain("Use tabs.");
  });

  test("flags a truncated file so the model knows the rules are incomplete", () => {
    writeFileSync(join(root, "AGENTS.md"), "Use tabs everywhere.");
    const config = makeConfig();
    config.projectDoc = { maxBytes: 5 };
    expect(renderProjectDoc(loadProjectDoc(config))).toContain("truncated");
  });

  test("says plainly that the project has no conventions when none were found", () => {
    expect(renderProjectDoc(null)).toContain("No AGENTS.md found");
  });
});

describe("get_project_doc tool", () => {
  test("returns the text and the paths it came from", async () => {
    writeFileSync(join(root, "AGENTS.md"), "Run bun test before committing.");
    const result = await tool.handler({}, makeConfig(), createSessionState());
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Run bun test before committing.");
    expect(result.structuredContent).toEqual({
      files: [{ path: join(root, "AGENTS.md"), truncated: false }],
      content: "Run bun test before committing.",
    });
  });

  test("is not an error when the project has no doc", async () => {
    const result = await tool.handler({}, makeConfig(), createSessionState());
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ files: [], content: "" });
  });

  test("structuredContent carries exactly the keys its schema requires", async () => {
    const result = await tool.handler({}, makeConfig(), createSessionState());
    const required = tool.outputSchema!.required as string[];
    expect(Object.keys(result.structuredContent!).sort()).toEqual([...required].sort());
  });
});

describe("buildInstructions with a project doc", () => {
  test("inlines the doc behind Codex's project-doc marker", () => {
    writeFileSync(join(root, "AGENTS.md"), "Never force-push.");
    const text = buildInstructions(makeConfig());
    expect(text).toContain("--- project-doc ---");
    expect(text.indexOf("--- project-doc ---")).toBeLessThan(text.indexOf("Never force-push."));
    expect(text).toContain("take precedence over these notes");
  });

  test("omits the marker entirely when the project has no doc", () => {
    const text = buildInstructions(makeConfig());
    expect(text).not.toContain("--- project-doc ---");
    expect(text).toContain("Working directory:");
  });
});
