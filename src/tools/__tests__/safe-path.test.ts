import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveSafePath } from "../../safe-path.js";

// Note: paths are built with `resolve()`/`tmpdir()` rather than hardcoded
// Unix-style strings so the suite works on both POSIX and Windows, where
// `path.resolve()` prepends a drive letter and uses `\` as the separator.
describe("resolveSafePath", () => {
  const workDir = resolve(tmpdir(), "codex-free-test-workdir");

  test("resolves relative path within workDir", () => {
    expect(resolveSafePath("src/index.ts", workDir)).toBe(resolve(workDir, "src/index.ts"));
  });

  test("resolves nested relative path", () => {
    expect(resolveSafePath("./src/../README.md", workDir)).toBe(resolve(workDir, "README.md"));
  });

  test("rejects path traversal with ../", () => {
    expect(() => resolveSafePath("../../etc/passwd", workDir)).toThrow("Path must be within work directory");
  });

  test("rejects absolute path outside workDir", () => {
    const outsidePath = resolve(tmpdir(), "codex-free-outside-dir", "etc", "passwd");
    expect(() => resolveSafePath(outsidePath, workDir)).toThrow("Path must be within work directory");
  });

  test("allows absolute path inside workDir", () => {
    const insidePath = resolve(workDir, "src/index.ts");
    expect(resolveSafePath(insidePath, workDir)).toBe(insidePath);
  });

  test("rejects empty path", () => {
    expect(() => resolveSafePath("", workDir)).toThrow("Path must not be empty");
  });

  test("defaults empty to workDir root when allowEmpty is true", () => {
    expect(resolveSafePath("", workDir, true)).toBe(workDir);
  });
});
