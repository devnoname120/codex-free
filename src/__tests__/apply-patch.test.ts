import { describe, test, expect } from "bun:test";
import { applyUpdate, parsePatch, renderAddedFile, seekSequence, usesCrlf, PatchParseError } from "../apply-patch.js";

describe("parsePatch", () => {
  test("parses an add hunk", () => {
    const actions = parsePatch("*** Begin Patch\n*** Add File: a.txt\n+one\n+two\n*** End Patch\n");
    expect(actions).toEqual([{ type: "add", path: "a.txt", lines: ["one", "two"] }]);
  });

  test("parses a delete hunk", () => {
    const actions = parsePatch("*** Begin Patch\n*** Delete File: gone.txt\n*** End Patch\n");
    expect(actions).toEqual([{ type: "delete", path: "gone.txt" }]);
  });

  test("parses an update hunk with context, move and eof marker", () => {
    const actions = parsePatch(
      "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@ function main\n ctx\n-old\n+new\n*** End of File\n*** End Patch\n",
    );
    expect(actions).toEqual([
      {
        type: "update",
        path: "src/old.ts",
        movePath: "src/new.ts",
        chunks: [
          {
            changeContext: "function main",
            oldLines: ["ctx", "old"],
            newLines: ["ctx", "new"],
            isEndOfFile: true,
          },
        ],
      },
    ]);
  });

  test("splits chunks at each @@ marker", () => {
    const actions = parsePatch(
      "*** Begin Patch\n*** Update File: f.txt\n@@\n-a\n+b\n@@\n-c\n+d\n*** End Patch\n",
    );
    expect(actions[0]).toMatchObject({ type: "update" });
    const update = actions[0] as Extract<typeof actions[number], { type: "update" }>;
    expect(update.chunks.length).toBe(2);
    expect(update.chunks[1]).toMatchObject({ oldLines: ["c"], newLines: ["d"] });
  });

  test("treats a bare empty line as an empty context line", () => {
    const actions = parsePatch("*** Begin Patch\n*** Update File: f.txt\n@@\n before\n\n after\n*** End Patch\n");
    const update = actions[0] as Extract<typeof actions[number], { type: "update" }>;
    expect(update.chunks[0]!.oldLines).toEqual(["before", "", "after"]);
  });

  test("accepts CRLF patch text", () => {
    const actions = parsePatch("*** Begin Patch\r\n*** Add File: a.txt\r\n+hi\r\n*** End Patch\r\n");
    expect(actions).toEqual([{ type: "add", path: "a.txt", lines: ["hi"] }]);
  });

  test("rejects a patch without the begin marker", () => {
    expect(() => parsePatch("*** Add File: a.txt\n+hi\n*** End Patch\n")).toThrow(PatchParseError);
  });

  test("rejects a patch without the end marker", () => {
    expect(() => parsePatch("*** Begin Patch\n*** Add File: a.txt\n+hi\n")).toThrow(PatchParseError);
  });

  test("rejects an update hunk that does not start with @@", () => {
    expect(() => parsePatch("*** Begin Patch\n*** Update File: f.txt\n-old\n*** End Patch\n")).toThrow(
      /@@ context marker/,
    );
  });

  test("rejects an unknown line prefix inside an update hunk", () => {
    expect(() => parsePatch("*** Begin Patch\n*** Update File: f.txt\n@@\n?nope\n*** End Patch\n")).toThrow(
      /Unexpected line found in update hunk/,
    );
  });
});

describe("seekSequence", () => {
  const lines = ["alpha", "beta", "gamma"];

  test("finds an exact match", () => {
    expect(seekSequence(lines, ["beta", "gamma"], 0, false)).toBe(1);
  });

  test("falls back to ignoring trailing whitespace", () => {
    expect(seekSequence(["foo   ", "bar\t"], ["foo", "bar"], 0, false)).toBe(0);
  });

  test("falls back to ignoring leading whitespace", () => {
    expect(seekSequence(["    foo   "], ["foo"], 0, false)).toBe(0);
  });

  test("normalises curly quotes and dashes", () => {
    expect(seekSequence(["say “hello” — now"], ['say "hello" - now'], 0, false)).toBe(0);
  });

  test("returns null when the pattern is longer than the input", () => {
    expect(seekSequence(["only"], ["too", "many"], 0, false)).toBeNull();
  });

  test("returns start for an empty pattern", () => {
    expect(seekSequence(lines, [], 2, false)).toBe(2);
  });

  test("searches from the end when eof is set", () => {
    expect(seekSequence(["x", "x", "x"], ["x"], 0, true)).toBe(2);
  });
});

describe("applyUpdate", () => {
  test("replaces a line", () => {
    const chunks = parsePatch("*** Begin Patch\n*** Update File: f\n@@\n-b\n+B\n*** End Patch\n");
    const update = chunks[0] as Extract<typeof chunks[number], { type: "update" }>;
    expect(applyUpdate("a\nb\nc\n", update.chunks, "f")).toBe("a\nB\nc\n");
  });

  test("uses context lines to locate the change", () => {
    const parsed = parsePatch("*** Begin Patch\n*** Update File: f\n@@\n a\n-b\n+B\n*** End Patch\n");
    const update = parsed[0] as Extract<typeof parsed[number], { type: "update" }>;
    expect(applyUpdate("z\nb\na\nb\nc\n", update.chunks, "f")).toBe("z\nb\na\nB\nc\n");
  });

  test("appends when the chunk has no old lines", () => {
    const parsed = parsePatch("*** Begin Patch\n*** Update File: f\n@@\n+d\n*** End Patch\n");
    const update = parsed[0] as Extract<typeof parsed[number], { type: "update" }>;
    expect(applyUpdate("a\nb\n", update.chunks, "f")).toBe("a\nb\nd\n");
  });

  test("preserves CRLF line endings", () => {
    const parsed = parsePatch("*** Begin Patch\n*** Update File: f\n@@\n-b\n+B\n*** End Patch\n");
    const update = parsed[0] as Extract<typeof parsed[number], { type: "update" }>;
    expect(applyUpdate("a\r\nb\r\nc\r\n", update.chunks, "f")).toBe("a\r\nB\r\nc\r\n");
  });

  test("throws when the old lines are not present", () => {
    const parsed = parsePatch("*** Begin Patch\n*** Update File: f\n@@\n-missing\n+new\n*** End Patch\n");
    const update = parsed[0] as Extract<typeof parsed[number], { type: "update" }>;
    expect(() => applyUpdate("a\nb\n", update.chunks, "f")).toThrow(/Failed to find expected lines/);
  });

  test("throws when the change context is not present", () => {
    const parsed = parsePatch("*** Begin Patch\n*** Update File: f\n@@ nowhere\n-a\n+A\n*** End Patch\n");
    const update = parsed[0] as Extract<typeof parsed[number], { type: "update" }>;
    expect(() => applyUpdate("a\nb\n", update.chunks, "f")).toThrow(/Failed to find context/);
  });
});

describe("helpers", () => {
  test("usesCrlf detects the dominant line ending", () => {
    expect(usesCrlf("a\r\nb\r\n")).toBe(true);
    expect(usesCrlf("a\nb\n")).toBe(false);
    expect(usesCrlf("")).toBe(false);
  });

  test("renderAddedFile terminates with a newline", () => {
    expect(renderAddedFile(["a", "b"])).toBe("a\nb\n");
    expect(renderAddedFile([])).toBe("");
  });
});
