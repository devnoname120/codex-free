import { describe, test, expect } from "bun:test";
import { loadTools } from "../registry.js";

describe("loadTools", () => {
  test("loads all 21 tools", () => {
    const tools = loadTools();
    expect(tools.length).toBe(21);
  });

  test("all tools have unique names", () => {
    const tools = loadTools();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("all tools have required fields", () => {
    const tools = loadTools();
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(typeof tool.handler).toBe("function");
    }
  });

  test("includes expected tool names", () => {
    const tools = loadTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("run_command");
    expect(names).toContain("git_status");
    expect(names).toContain("git_push");
    expect(names).toContain("git_commit");
    expect(names).toContain("git_log");
    expect(names).toContain("glob");
    expect(names).toContain("grep");
    expect(names).toContain("list_directory");
    expect(names).toContain("tree");
  });

  test("includes the tools ported from Codex", () => {
    const tools = loadTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("apply_patch");
    expect(names).toContain("exec_command");
    expect(names).toContain("write_stdin");
    expect(names).toContain("view_image");
    expect(names).toContain("update_plan");
    expect(names).toContain("clock_curr_time");
    expect(names).toContain("clock_sleep");
  });

  test("includes the tools Codex has no equivalent of", () => {
    const names = loadTools().map((t) => t.name);
    expect(names).toContain("get_environment");
    expect(names).toContain("get_project_doc");
    expect(names).toContain("get_agent_brief");
  });

  test("all tool names are valid MCP tool names", () => {
    const tools = loadTools();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });
});
