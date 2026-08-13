import { describe, test, expect } from "bun:test";
import { withStructuredContent } from "../server.js";
import { loadTools } from "../registry.js";
import type { ToolDefinition, ToolResult } from "../types.js";

function makeTool(outputSchema?: Record<string, unknown>): ToolDefinition {
  return {
    name: "fake",
    description: "",
    inputSchema: { type: "object" },
    ...(outputSchema ? { outputSchema } : {}),
    handler: async () => ({ content: [] }),
  };
}

const CONTENT_SCHEMA = {
  type: "object",
  properties: { content: { type: "string" } },
};

describe("withStructuredContent", () => {
  test("derives { content } from the text blocks", () => {
    const result: ToolResult = { content: [{ type: "text", text: "hello" }] };
    expect(withStructuredContent(makeTool(CONTENT_SCHEMA), result).structuredContent).toEqual({
      content: "hello",
    });
  });

  test("joins multiple text blocks and skips non-text ones", () => {
    const result: ToolResult = {
      content: [
        { type: "text", text: "one" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "text", text: "two" },
      ],
    };
    expect(withStructuredContent(makeTool(CONTENT_SCHEMA), result).structuredContent).toEqual({
      content: "one\ntwo",
    });
  });

  test("leaves a tool's own structuredContent alone", () => {
    const result: ToolResult = {
      content: [{ type: "text", text: "{}" }],
      structuredContent: { current_time: "2026-01-01 00:00:00 UTC" },
    };
    expect(withStructuredContent(makeTool(CONTENT_SCHEMA), result).structuredContent).toEqual({
      current_time: "2026-01-01 00:00:00 UTC",
    });
  });

  test("adds nothing when the tool declares no outputSchema", () => {
    const result: ToolResult = { content: [{ type: "text", text: "hello" }] };
    expect(withStructuredContent(makeTool(), result).structuredContent).toBeUndefined();
  });

  test("adds nothing to an error result", () => {
    // An error message would not satisfy the schema, and the MCP spec exempts
    // isError results from output validation.
    const result: ToolResult = { content: [{ type: "text", text: "boom" }], isError: true };
    expect(withStructuredContent(makeTool(CONTENT_SCHEMA), result).structuredContent).toBeUndefined();
  });

  test("does not mutate the result it was given", () => {
    const result: ToolResult = { content: [{ type: "text", text: "hello" }] };
    withStructuredContent(makeTool(CONTENT_SCHEMA), result);
    expect(result.structuredContent).toBeUndefined();
  });
});

describe("registry output schemas", () => {
  test("the generic default satisfies every schema that only requires content", () => {
    // A tool whose schema requires keys other than `content` cannot rely on the
    // default and has to build its own structuredContent; this pins the list so
    // a new one is not added without a handler that fills it in.
    const needsOwnStructuredContent = loadTools()
      .filter((tool) => {
        const required = (tool.outputSchema?.required as string[] | undefined) ?? [];
        return required.some((key) => key !== "content");
      })
      .map((tool) => tool.name)
      .sort();

    expect(needsOwnStructuredContent).toEqual([
      "clock_curr_time",
      "exec_command",
      "get_environment",
      "get_project_doc",
      "skills_list",
      "write_stdin",
    ]);
  });
});
