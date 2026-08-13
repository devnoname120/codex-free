import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_BRIEF, buildInstructions } from "../instructions.js";
import { remember, savePlan } from "../memory.js";
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
    // Pinned so the suite never reads or writes the running user's real state.
    memory: { dir: join(root, "state") },
    // Same reason: an empty user scope, so a developer who happens to have
    // skills in their home directory does not change what these tests see.
    skills: { dirs: [] },
  };
}

/** Installs a project-scope skill, which is what buildInstructions catalogues. */
function writeSkill(name: string, description: string): void {
  const dir = join(root, ".agents", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`);
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

  test("tells the model what to do about a context window it will lose", () => {
    expect(AGENT_BRIEF).toContain("Call recall when you are resuming work");
    expect(AGENT_BRIEF).toContain("Call remember when you learn something");
    expect(AGENT_BRIEF).toContain("a truncated result says so on its last line");
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

  test("says nothing about saved state when nothing was saved", () => {
    expect(buildInstructions(makeConfig())).not.toContain("## Saved state");
  });

  // The point of persisting anything: a conversation that starts after the
  // previous one was lost opens with the plan and notes already in front of it.
  test("hands back the saved plan and notes to a fresh session", () => {
    const config = makeConfig();
    savePlan(config, { plan: [{ step: "port the tools", status: "in_progress" }] });
    remember(config, "why-bun", "The runtime ships a test runner.", "2026-01-01T00:00:00.000Z");

    const text = buildInstructions(config);
    expect(text).toContain("## Saved state");
    expect(text).toContain("[~] port the tools");
    expect(text).toContain("- why-bun: The runtime ships a test runner.");
  });

  test("puts saved state before the project doc, which stays last", () => {
    const config = makeConfig();
    writeFileSync(join(root, "AGENTS.md"), "Never force-push.");
    remember(config, "k", "v", "2026-01-01T00:00:00.000Z");

    const text = buildInstructions(config);
    expect(text.indexOf("## Environment")).toBeLessThan(text.indexOf("## Saved state"));
    expect(text.indexOf("## Saved state")).toBeLessThan(text.indexOf(PROJECT_DOC_SEPARATOR));
  });

  test("omits saved state entirely when memory is disabled", () => {
    const config = makeConfig();
    remember(config, "k", "v", "2026-01-01T00:00:00.000Z");
    const disabled = { ...config, memory: { ...config.memory, enabled: false } };
    expect(buildInstructions(disabled)).not.toContain("## Saved state");
  });

  test("announces no skill library when the project and the user have none", () => {
    expect(buildInstructions(makeConfig())).not.toContain("## Skills");
  });

  // Codex puts the catalogue in the prompt so the model can pick a skill without
  // spending a tool call to discover that one exists.
  test("lists the installed skills, and how to open one", () => {
    writeSkill("deploy", "Ship a release");

    const text = buildInstructions(makeConfig());
    expect(text).toContain("## Skills");
    expect(text).toContain("- deploy (repo) — Ship a release");
    expect(text).toContain("skills_read");
  });

  test("puts the catalogue after the environment and before the project doc", () => {
    writeSkill("deploy", "Ship a release");
    writeFileSync(join(root, "AGENTS.md"), "Never force-push.");

    const text = buildInstructions(makeConfig());
    expect(text.indexOf("## Environment")).toBeLessThan(text.indexOf("## Skills"));
    expect(text.indexOf("## Skills")).toBeLessThan(text.indexOf(PROJECT_DOC_SEPARATOR));
  });

  test("omits the catalogue entirely when skills are disabled", () => {
    writeSkill("deploy", "Ship a release");
    const disabled = { ...makeConfig(), skills: { enabled: false } };
    expect(buildInstructions(disabled)).not.toContain("## Skills");
  });
});
