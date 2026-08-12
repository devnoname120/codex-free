import { describe, test, expect } from "bun:test";
import getEnvironment, { describeEnvironment, osName, renderEnvironment } from "../get-environment.js";
import { buildInstructions } from "../../instructions.js";
import { createSessionState } from "../../types.js";
import type { AppConfig, ToolDefinition } from "../../types.js";

const tool: ToolDefinition = getEnvironment;

function makeConfig(defaultShell?: string): AppConfig {
  return {
    workDir: "/tmp/project",
    port: 3000,
    allowedCommands: ["node", "git"],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: ["ls"], maxSessions: 8, defaultShell },
  };
}

describe("osName", () => {
  test("maps platform identifiers to names people use", () => {
    expect(osName("win32")).toBe("Windows");
    expect(osName("darwin")).toBe("macOS");
    expect(osName("linux")).toBe("Linux");
  });

  test("passes an unknown platform through", () => {
    expect(osName("freebsd")).toBe("freebsd");
  });
});

describe("describeEnvironment", () => {
  test("reports the shell exec_command would actually launch", () => {
    const info = describeEnvironment(makeConfig("pwsh"));
    expect(info.shell).toEqual({ bin: "pwsh", type: "powershell", argv_prefix: ["-NoProfile", "-Command"] });
  });

  test("reports the work directory and the effective allowlist", () => {
    const info = describeEnvironment(makeConfig());
    expect(info.cwd).toBe("/tmp/project");
    expect(info.exec.allowed_commands).toEqual(["git", "ls", "node"]);
    expect(info.run_command_allowed).toEqual(["git", "node"]);
  });

  test("describes the host it is running on", () => {
    const info = describeEnvironment(makeConfig());
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
    expect(info.path_separator).toBe(process.platform === "win32" ? "\\" : "/");
  });
});

describe("renderEnvironment", () => {
  test("gives PowerShell-specific advice for PowerShell", () => {
    const text = renderEnvironment(describeEnvironment(makeConfig("powershell.exe")));
    expect(text).toContain("Get-ChildItem");
    expect(text).not.toContain("POSIX shell syntax");
  });

  test("gives cmd-specific advice for cmd", () => {
    expect(renderEnvironment(describeEnvironment(makeConfig("cmd.exe")))).toContain("%VAR%");
  });

  test("gives POSIX advice for a POSIX shell", () => {
    const text = renderEnvironment(describeEnvironment(makeConfig("/bin/bash")));
    expect(text).toContain("POSIX sh syntax");
    expect(text).not.toContain("Get-ChildItem");
  });

  test("spells out the allowlist under allowlist mode", () => {
    expect(renderEnvironment(describeEnvironment(makeConfig()))).toContain("allowing: git, ls, node");
  });

  test("says so under unrestricted mode instead of listing commands", () => {
    const config = makeConfig();
    config.exec.mode = "unrestricted";
    const text = renderEnvironment(describeEnvironment(config));
    expect(text).toContain("any command runs");
    expect(text).not.toContain("allowing:");
  });
});

describe("get_environment tool", () => {
  test("returns both prose and structured content", async () => {
    const config = makeConfig("bash");
    const result = await tool.handler({}, config, createSessionState());
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Working directory: /tmp/project");
    expect(result.structuredContent).toEqual({ ...describeEnvironment(config) });
  });

  test("structuredContent carries exactly the keys its schema requires", async () => {
    const result = await tool.handler({}, makeConfig(), createSessionState());
    const required = tool.outputSchema!.required as string[];
    expect(Object.keys(result.structuredContent!).sort()).toEqual([...required].sort());
  });
});

describe("buildInstructions", () => {
  test("carries the environment and the working notes", () => {
    const text = buildInstructions(makeConfig("bash"));
    expect(text).toContain("Working directory: /tmp/project");
    expect(text).toContain("Shell for exec_command: bash (posix)");
    expect(text).toContain("apply_patch");
  });
});
