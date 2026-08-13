import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import applyPatch from "../apply-patch.js";
import execCommand, {
  EXEC_COMMAND_DESCRIPTION,
  UNIFIED_EXEC_OUTPUT_SCHEMA,
  describeExecCommand,
} from "../exec-command.js";
import writeStdin from "../write-stdin.js";
import viewImage from "../view-image.js";
import updatePlan from "../update-plan.js";
import clockCurrTime from "../clock-curr-time.js";
import clockSleep from "../clock-sleep.js";
import { createSessionState } from "../../types.js";
import { killExecSession } from "../../exec-sessions.js";
import type { AppConfig, ExecMode, SessionState, ToolDefinition } from "../../types.js";

// Exercised through `ToolDefinition`, the shape the server actually calls, so
// every tool takes the same (args, config, session) triple regardless of which
// parameters its own implementation happens to declare.
const applyPatchTool: ToolDefinition = applyPatch;
const execCommandTool: ToolDefinition = execCommand;
const writeStdinTool: ToolDefinition = writeStdin;
const viewImageTool: ToolDefinition = viewImage;
const updatePlanTool: ToolDefinition = updatePlan;
const clockCurrTimeTool: ToolDefinition = clockCurrTime;
const clockSleepTool: ToolDefinition = clockSleep;

function makeConfig(workDir: string, mode: ExecMode = "allowlist"): AppConfig {
  return {
    workDir,
    port: 3000,
    allowedCommands: ["node", "bun"],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode, extraAllowedCommands: ["echo"], maxSessions: 4 },
    // update_plan persists; pinned inside the temp work directory so the suite
    // never writes to the running user's real state directory.
    memory: { dir: join(workDir, ".state") },
  };
}

/** Text of the first content block, for tools that return text. */
function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]!.text ?? "";
}

/**
 * A long-running process that echoes stdin back to stdout. Spelled with `node`
 * rather than `cat` so the same command works on Windows and POSIX.
 */
const STDIN_ECHO = 'node -e "process.stdin.pipe(process.stdout)"';

let workDir: string;
let session: SessionState;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "codex-port-test-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  session = createSessionState();
});

// Windows keeps a directory locked while any process has it as its cwd, so
// every spawned process must be fully reaped before afterAll can remove workDir.
afterEach(async () => {
  const sessions = [...session.execSessions.values()];
  for (const execSession of sessions) killExecSession(execSession);
  await Promise.all(sessions.map((execSession) => execSession.proc.exited));
  session.execSessions.clear();
});

describe("apply_patch", () => {
  test("adds a new file", async () => {
    const result = await applyPatchTool.handler(
      { input: "*** Begin Patch\n*** Add File: added.txt\n+hello\n+world\n*** End Patch\n" },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("A added.txt");
    expect(await readFile(join(workDir, "added.txt"), "utf-8")).toBe("hello\nworld\n");
  });

  test("updates an existing file in place", async () => {
    await writeFile(join(workDir, "update.txt"), "one\ntwo\nthree\n");
    const result = await applyPatchTool.handler(
      { input: "*** Begin Patch\n*** Update File: update.txt\n@@\n-two\n+TWO\n*** End Patch\n" },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBeUndefined();
    expect(await readFile(join(workDir, "update.txt"), "utf-8")).toBe("one\nTWO\nthree\n");
  });

  test("moves a file with Move to", async () => {
    await writeFile(join(workDir, "src.txt"), "body\n");
    const result = await applyPatchTool.handler(
      { input: "*** Begin Patch\n*** Update File: src.txt\n*** Move to: moved.txt\n@@\n-body\n+moved body\n*** End Patch\n" },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("R src.txt -> moved.txt");
    expect(await readFile(join(workDir, "moved.txt"), "utf-8")).toBe("moved body\n");
    expect(await Bun.file(join(workDir, "src.txt")).exists()).toBe(false);
  });

  test("deletes a file", async () => {
    await writeFile(join(workDir, "doomed.txt"), "x\n");
    const result = await applyPatchTool.handler(
      { input: "*** Begin Patch\n*** Delete File: doomed.txt\n*** End Patch\n" },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBeUndefined();
    expect(await Bun.file(join(workDir, "doomed.txt")).exists()).toBe(false);
  });

  test("writes nothing when a later hunk fails to apply", async () => {
    await writeFile(join(workDir, "first.txt"), "keep\n");
    const result = await applyPatchTool.handler(
      {
        input:
          "*** Begin Patch\n*** Update File: first.txt\n@@\n-keep\n+changed\n" +
          "*** Update File: second.txt\n@@\n-nope\n+never\n*** End Patch\n",
      },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Patch does not apply");
    // The first hunk was valid, but nothing may be written when a later one fails.
    expect(await readFile(join(workDir, "first.txt"), "utf-8")).toBe("keep\n");
  });

  test("rejects a malformed patch", async () => {
    const result = await applyPatchTool.handler({ input: "just some text" }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Invalid patch");
  });

  test("rejects a path outside the work directory", async () => {
    const result = await applyPatchTool.handler(
      { input: "*** Begin Patch\n*** Add File: ../escape.txt\n+bad\n*** End Patch\n" },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Path must be within work directory");
  });
});

describe("exec_command", () => {
  test("runs a short command and returns its exit code", async () => {
    const result = await execCommandTool.handler({ cmd: "echo hello" }, makeConfig(workDir), session);
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(textOf(result));
    expect(payload.output).toContain("hello");
    expect(payload.exit_code).toBe(0);
    expect(payload.session_id).toBeUndefined();
    expect(typeof payload.wall_time_seconds).toBe("number");
    // The JSON text and the structured payload are two views of one result.
    expect(result.structuredContent).toEqual(payload);
  });

  test("structuredContent carries only keys the output schema declares", async () => {
    const result = await execCommandTool.handler({ cmd: "echo hi" }, makeConfig(workDir), session);
    const declared = Object.keys(UNIFIED_EXEC_OUTPUT_SCHEMA.properties);
    expect(Object.keys(result.structuredContent!).every((key) => declared.includes(key))).toBe(true);
    for (const key of UNIFIED_EXEC_OUTPUT_SCHEMA.required) {
      expect(result.structuredContent![key]).toBeDefined();
    }
  });

  test("describes the Windows shell rules only on Windows", () => {
    const mentionsWindowsRules = EXEC_COMMAND_DESCRIPTION.includes("Windows safety rules:");
    expect(mentionsWindowsRules).toBe(process.platform === "win32");
    if (mentionsWindowsRules) {
      expect(EXEC_COMMAND_DESCRIPTION).toContain("-LiteralPath");
      expect(EXEC_COMMAND_DESCRIPTION).toContain("-WindowStyle Hidden");
    }
  });

  test("names the configured shell and its syntax in the advertised description", () => {
    const posix = { ...makeConfig(workDir) };
    posix.exec = { ...posix.exec, defaultShell: "/bin/bash" };
    expect(describeExecCommand(posix)).toContain("/bin/bash (posix)");

    const windows = { ...makeConfig(workDir) };
    windows.exec = { ...windows.exec, defaultShell: "powershell.exe" };
    const text = describeExecCommand(windows);
    expect(text).toContain("powershell.exe (powershell)");
    expect(text).toContain("Get-Content");
  });

  test("honours the shell parameter rather than the host platform", async () => {
    // On Windows this used to run `bash -NoProfile -Command`, which bash reads
    // as a request to execute the file "-NoProfile".
    const shell = process.platform === "win32" ? process.env.SHELL : "/bin/sh";
    if (!shell) return;
    const result = await execCommandTool.handler(
      { cmd: "echo from-posix-shell", shell },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result)).output).toContain("from-posix-shell");
  }, 15000);

  test("returns a session_id when the command outlives yield_time_ms", async () => {
    const result = await execCommandTool.handler(
      { cmd: STDIN_ECHO, yield_time_ms: 250 },
      makeConfig(workDir),
      session,
    );
    const payload = JSON.parse(textOf(result));
    expect(typeof payload.session_id).toBe("number");
    expect(payload.exit_code).toBeUndefined();
    expect(session.execSessions.size).toBe(1);

    // The session stays addressable: write_stdin reaches the same process.
    const echoed = await writeStdinTool.handler(
      { session_id: payload.session_id, chars: "ping\n", yield_time_ms: 2000 },
      makeConfig(workDir),
      session,
    );
    expect(JSON.parse(textOf(echoed)).output).toContain("ping");
    expect(echoed.structuredContent).toEqual(JSON.parse(textOf(echoed)));
  }, 15000);

  test("reports a non-zero exit code as an error", async () => {
    const result = await execCommandTool.handler(
      { cmd: "node -e \"process.exit(3)\"" },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result)).exit_code).toBe(3);
  });

  test("blocks a command outside the allowlist", async () => {
    const result = await execCommandTool.handler({ cmd: "curl http://evil.com" }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Command not allowed");
  });

  test("rejects a workdir outside the work directory", async () => {
    const result = await execCommandTool.handler(
      { cmd: "echo hi", workdir: "../.." },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Path must be within work directory");
  });

  test("rejects tty: true instead of silently ignoring it", async () => {
    const result = await execCommandTool.handler({ cmd: "echo hi", tty: true }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("tty is not supported");
  });

  test("rejects an empty cmd", async () => {
    const result = await execCommandTool.handler({ cmd: "  " }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
  });

  test("enforces the session cap", async () => {
    const config = makeConfig(workDir);
    const ids: number[] = [];
    for (let i = 0; i < config.exec.maxSessions; i++) {
      const result = await execCommandTool.handler({ cmd: STDIN_ECHO, yield_time_ms: 250 }, config, session);
      ids.push(JSON.parse(textOf(result)).session_id);
    }
    const overflow = await execCommandTool.handler({ cmd: STDIN_ECHO, yield_time_ms: 250 }, config, session);
    expect(overflow.isError).toBe(true);
    expect(textOf(overflow)).toContain("Too many live exec sessions");

  }, 15000);
});

describe("write_stdin", () => {
  test("returns a clear error for an unknown session", async () => {
    const result = await writeStdinTool.handler({ session_id: 999 }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No such exec session: 999");
  });

  test("rejects a non-numeric session_id", async () => {
    const result = await writeStdinTool.handler({ session_id: "1" }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("session_id must be a number");
  });

  test("polls a live session without writing, then sees it exit", async () => {
    const started = await execCommandTool.handler(
      { cmd: STDIN_ECHO, yield_time_ms: 250 },
      makeConfig(workDir),
      session,
    );
    const sessionId = JSON.parse(textOf(started)).session_id as number;

    // An empty `chars` polls. Codex's floor for a poll is 5000 ms, so this call
    // deliberately blocks for that long before reporting the process is alive.
    const polled = await writeStdinTool.handler({ session_id: sessionId }, makeConfig(workDir), session);
    expect(JSON.parse(textOf(polled)).session_id).toBe(sessionId);

    // Closing stdin ends the pipe, so the process exits and the session is freed.
    session.execSessions.get(sessionId)!.proc.stdin.end();
    const finished = await writeStdinTool.handler({ session_id: sessionId }, makeConfig(workDir), session);
    expect(JSON.parse(textOf(finished)).exit_code).toBe(0);
    expect(session.execSessions.has(sessionId)).toBe(false);
  }, 30000);
});

describe("update_plan", () => {
  test("stores the plan on the session and renders it back", async () => {
    const result = await updatePlanTool.handler(
      {
        explanation: "Getting started",
        plan: [
          { step: "Read the code", status: "completed" },
          { step: "Write the fix", status: "in_progress" },
          { step: "Run tests", status: "pending" },
        ],
      },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain("Getting started");
    expect(text).toContain("[x] Read the code");
    expect(text).toContain("[~] Write the fix");
    expect(text).toContain("[ ] Run tests");
    expect(text).toContain("1/3 steps completed");
    expect(session.plan?.plan.length).toBe(3);
  });

  test("rejects more than one in_progress step", async () => {
    const result = await updatePlanTool.handler(
      {
        plan: [
          { step: "a", status: "in_progress" },
          { step: "b", status: "in_progress" },
        ],
      },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("At most one step can be in_progress");
  });

  test("rejects an unknown status", async () => {
    const result = await updatePlanTool.handler(
      { plan: [{ step: "a", status: "doing" }] },
      makeConfig(workDir),
      session,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("status must be one of");
  });

  test("rejects a plan that is not an array", async () => {
    const result = await updatePlanTool.handler({ plan: "nope" }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("plan must be an array");
  });
});

describe("view_image", () => {
  // Smallest valid 1x1 PNG.
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  test("returns an image content block", async () => {
    await Bun.write(join(workDir, "pixel.png"), Buffer.from(PNG_BASE64, "base64"));
    const result = await viewImageTool.handler({ path: "pixel.png" }, makeConfig(workDir), session);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.type).toBe("image");
    expect(result.content[0]!.mimeType).toBe("image/png");
    expect(result.content[0]!.data).toBe(PNG_BASE64);
  });

  test("rejects a file that is not an image", async () => {
    await writeFile(join(workDir, "notimage.png"), "plain text");
    const result = await viewImageTool.handler({ path: "notimage.png" }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Not a recognised image file");
  });

  test("reports a missing file", async () => {
    const result = await viewImageTool.handler({ path: "absent.png" }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("File not found");
  });

  test("rejects path traversal", async () => {
    const result = await viewImageTool.handler({ path: "../../secret.png" }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Path must be within work directory");
  });
});

describe("clock tools", () => {
  test("clock_curr_time returns a UTC timestamp", async () => {
    const result = await clockCurrTimeTool.handler({}, makeConfig(workDir), session);
    expect(textOf(result)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
    // Its output schema requires `current_time`, so it cannot fall back to the
    // generic `{ content }` the server derives for other tools.
    expect(result.structuredContent).toEqual({ current_time: textOf(result) });
  });

  test("clock_sleep waits and reports elapsed time", async () => {
    const started = Date.now();
    const result = await clockSleepTool.handler({ duration_ms: 60 }, makeConfig(workDir), session);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(textOf(result)).toContain("Sleep completed.");
    expect(textOf(result)).toContain("Wall time:");
  });

  test("clock_sleep rejects a duration outside the supported range", async () => {
    const tooLong = await clockSleepTool.handler({ duration_ms: 60 * 60 * 1000 }, makeConfig(workDir), session);
    expect(tooLong.isError).toBe(true);
    expect(textOf(tooLong)).toContain("duration_ms must be between");

    const tooShort = await clockSleepTool.handler({ duration_ms: 0 }, makeConfig(workDir), session);
    expect(tooShort.isError).toBe(true);
  });

  test("clock_sleep rejects a non-numeric duration", async () => {
    const result = await clockSleepTool.handler({ duration_ms: "60" }, makeConfig(workDir), session);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("duration_ms must be a number");
  });
});
