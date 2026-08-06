import { describe, test, expect } from "bun:test";
import { loadTools } from "../registry.js";

describe("loadTools", () => {
  test("loads all 11 tools", () => {
    const tools = loadTools();
    expect(tools.length).toBe(11);
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
});
