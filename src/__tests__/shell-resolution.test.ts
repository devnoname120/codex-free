import { describe, test, expect, afterEach } from "bun:test";
import { defaultShellBin, resolveShell, shellTypeOf, wrapForShell } from "../exec-sessions.js";

const originalShell = process.env.SHELL;

afterEach(() => {
  if (originalShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = originalShell;
});

describe("shellTypeOf", () => {
  test("recognises POSIX shells", () => {
    for (const bin of ["sh", "bash", "zsh", "/bin/sh", "/usr/bin/env bash".split(" ")[1]!]) {
      expect(shellTypeOf(bin)).toBe("posix");
    }
  });

  test("recognises PowerShell under either name and either separator", () => {
    for (const bin of [
      "powershell",
      "powershell.exe",
      "pwsh",
      "PWSH.EXE",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "/usr/local/bin/pwsh",
    ]) {
      expect(shellTypeOf(bin)).toBe("powershell");
    }
  });

  test("recognises cmd", () => {
    expect(shellTypeOf("cmd")).toBe("cmd");
    expect(shellTypeOf("C:\\Windows\\System32\\cmd.exe")).toBe("cmd");
  });

  test("splits Windows paths even when running on POSIX", () => {
    // Git Bash reports $SHELL as a Windows path, so both separators have to be
    // handled regardless of which host the code runs on.
    expect(shellTypeOf("C:\\Program Files\\Git\\bin\\bash.exe")).toBe("posix");
  });

  test("treats an unknown shell as POSIX", () => {
    expect(shellTypeOf("fish")).toBe("posix");
  });
});

describe("resolveShell", () => {
  test("derives the flag from the shell, not the host platform", () => {
    // The bug this replaced: on Windows every shell got -NoProfile -Command,
    // so `shell: "bash"` produced `bash -NoProfile -Command <cmd>`.
    expect(resolveShell("bash")).toEqual(["bash", "-c"]);
    expect(resolveShell("/bin/sh")).toEqual(["/bin/sh", "-c"]);
    expect(resolveShell("powershell.exe")).toEqual(["powershell.exe", "-NoProfile", "-Command"]);
    expect(resolveShell("pwsh")).toEqual(["pwsh", "-NoProfile", "-Command"]);
    expect(resolveShell("cmd.exe")).toEqual(["cmd.exe", "/c"]);
  });

  test("honours $SHELL when no shell is named", () => {
    process.env.SHELL = "C:\\Program Files\\Git\\bin\\bash.exe";
    expect(resolveShell()).toEqual(["C:\\Program Files\\Git\\bin\\bash.exe", "-c"]);
  });

  test("falls back to the platform shell when $SHELL is unset", () => {
    delete process.env.SHELL;
    const expected = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    expect(defaultShellBin()).toBe(expected);
    expect(resolveShell()[0]).toBe(expected);
  });
});

describe("wrapForShell", () => {
  test("re-raises $LASTEXITCODE for PowerShell", () => {
    // `powershell -Command` collapses every non-zero child exit code to 1.
    const wrapped = wrapForShell("node -e \"process.exit(3)\"", "powershell.exe");
    expect(wrapped).toContain("exit $LASTEXITCODE");
    expect(wrapped).toContain("node -e \"process.exit(3)\"");
  });

  test("leaves other shells untouched", () => {
    expect(wrapForShell("exit 3", "bash")).toBe("exit 3");
    expect(wrapForShell("exit 3", "cmd.exe")).toBe("exit 3");
  });
});
