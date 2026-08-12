import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_BRIEF, buildInstructions } from "../instructions.js";
import { PROJECT_DOC_SEPARATOR } from "../project-doc.js";
import type { AppConfig } from "../types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-free-brief-"));
  mkdirSync(join(root, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(shell = "bash"): AppConfig {
  return {
    workDir: root,
    port: 3000,
    allowedCommands: ["git", "bun"],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8, defaultShell: shell },
  };
}

describe("AGENT_BRIEF", () => {
  test("carries the constraints Codex leans on hardest", () => {
    // These are the rules whose absence changes what the agent does to a repo,
    // not just how it phrases things — the reason the prompt was ported at all.
    expect(AGENT_BRIEF).toContain("git reset --hard");
    expect(AGENT_BRIEF).toContain("NEVER revert existing changes you did not make");
    expect(AGENT_BRIEF).toContain("Do not amend a commit unless explicitly asked");
    expect(AGENT_BRIEF).toContain("Read a file before editing it");
    expect(AGENT_BRIEF).toContain("Do not make single-step plans");
  });

  test("names the tools its advice is about, so the advice is actionable", () => {
    for (const tool of ["apply_patch", "write_file", "exec_command", "write_stdin", "update_plan", "grep"]) {
      expect(AGENT_BRIEF).toContain(tool);
    }
  });

  test("drops the CLI-only rendering rules", () => {
    // Codex's prompt tells the model it is writing plain text for a terminal.
    // An MCP client renders markdown, so importing those rules would make the
    // model format for a screen it is not writing to.
    expect(AGENT_BRIEF).not.toContain("CLI handles styling");
    expect(AGENT_BRIEF).not.toContain("no ANSI codes");
    expect(AGENT_BRIEF).not.toContain("#Lline");
  });
});

describe("buildInstructions", () => {
  test("orders the layers the way Codex does: brief, environment, project doc", () => {
    writeFileSync(join(root, "AGENTS.md"), "Never force-push.");
    const text = buildInstructions(makeConfig());
    const brief = text.indexOf("You are acting as a coding agent");
    const env = text.indexOf("## Environment");
    const doc = text.indexOf(PROJECT_DOC_SEPARATOR);
    expect(brief).toBeGreaterThanOrEqual(0);
    expect(brief).toBeLessThan(env);
    expect(env).toBeLessThan(doc);
  });

  test("includes the whole brief verbatim", () => {
    expect(buildInstructions(makeConfig())).toContain(AGENT_BRIEF);
  });

  test("describes the actual shell rather than a generic one", () => {
    expect(buildInstructions(makeConfig("bash"))).toContain("Shell for exec_command: bash (posix)");
    expect(buildInstructions(makeConfig("powershell"))).toContain("Write PowerShell, not POSIX sh");
  });

  test("still ends with the brief and environment when the project has no doc", () => {
    const text = buildInstructions(makeConfig());
    expect(text).not.toContain(PROJECT_DOC_SEPARATOR);
    expect(text).toContain("Working directory:");
  });
});
