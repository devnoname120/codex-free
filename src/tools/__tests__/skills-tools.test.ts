import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import skillsListTool from "../skills-list.js";
import skillsRead from "../skills-read.js";
import { SKILL_FILENAME } from "../../skills.js";
import { createSessionState } from "../../types.js";
import type { AppConfig, SkillsConfig, ToolDefinition } from "../../types.js";

// Re-declared so the handler's return type widens to ToolResult; the literal
// skills_list returns never sets isError, which the disabled case asserts about.
const skillsList: ToolDefinition = skillsListTool;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-free-skill-tools-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(skills?: SkillsConfig): AppConfig {
  return {
    workDir: root,
    port: 3000,
    allowedCommands: [],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
    // An empty user scope, so the suite never reads the running user's skills.
    skills: { dirs: [], ...skills },
  };
}

const skillsDir = () => join(root, ".agents", "skills");

function writeSkill(name: string, body: string): string {
  const dir = join(skillsDir(), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SKILL_FILENAME), body);
  return dir;
}

const text = (result: { content: { text?: string }[] }) => result.content[0]!.text!;

describe("skills_list", () => {
  test("gives every skill a name, a reason and a path", async () => {
    writeSkill("deploy", "---\nname: deploy\ndescription: Ship a release\n---\n\nbody\n");
    const result = await skillsList.handler({}, makeConfig(), createSessionState());

    expect(text(result)).toContain("1 skill available");
    expect(text(result)).toContain("- deploy (repo) — Ship a release");
    expect(text(result)).toContain(join(skillsDir(), "deploy", SKILL_FILENAME));
    expect(result.structuredContent!.skills).toEqual([
      {
        name: "deploy",
        description: "Ship a release",
        scope: "repo",
        path: join(skillsDir(), "deploy", SKILL_FILENAME),
      },
    ]);
  });

  // "No skills found" on its own reads like a bug; the roots say where to put one.
  test("names the directories it searched when there are none", async () => {
    const result = await skillsList.handler({}, makeConfig(), createSessionState());
    expect(text(result)).toContain("No skills found");
    expect(text(result)).toContain(skillsDir());
    expect(result.structuredContent!.skills).toEqual([]);
  });

  test("reports a skill it could not offer", async () => {
    writeSkill("broken", "---\nname: broken\n---\n");
    const result = await skillsList.handler({}, makeConfig(), createSessionState());

    expect(text(result)).toContain("Not offered:");
    expect(text(result)).toContain("description");
  });

  test("says so plainly when skills are switched off", async () => {
    writeSkill("deploy", "---\nname: deploy\ndescription: Ship a release\n---\n");
    const result = await skillsList.handler({}, makeConfig({ enabled: false }), createSessionState());

    expect(text(result)).toContain("disabled");
    expect(result.isError).toBeUndefined();
  });
});

describe("skills_read", () => {
  test("returns the body, and points at the rest of the package", async () => {
    const dir = writeSkill("deploy", "---\nname: deploy\ndescription: Ship a release\n---\n\nStep one.\n");
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "release.sh"), "echo hi\n");

    const body = text(await skillsRead.handler({ name: "deploy" }, makeConfig()));
    expect(body).toContain("Step one.");
    expect(body).toContain("scripts/release.sh");
  });

  test("reads a file inside the package by relative path", async () => {
    const dir = writeSkill("deploy", "---\nname: deploy\ndescription: Ship a release\n---\n");
    mkdirSync(join(dir, "references"));
    writeFileSync(join(dir, "references", "api.md"), "the reference\n");

    const body = text(
      await skillsRead.handler({ name: "deploy", resource: "references/api.md" }, makeConfig()),
    );
    expect(body).toContain("the reference");
  });

  // read_file is confined to work-dir; skills usually are not, which is why the
  // resource path is checked against the skill's own directory instead.
  test("refuses a resource outside the skill", async () => {
    writeSkill("deploy", "---\nname: deploy\ndescription: Ship a release\n---\n");
    writeFileSync(join(root, "secret.txt"), "no");

    const result = await skillsRead.handler(
      { name: "deploy", resource: "../../../secret.txt" },
      makeConfig(),
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("inside the skill");
  });

  test("names what is available when the skill is not", async () => {
    writeSkill("deploy", "---\nname: deploy\ndescription: Ship a release\n---\n");
    const result = await skillsRead.handler({ name: "nope" }, makeConfig());

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Available: deploy.");
  });

  test("reports a resource the skill does not have", async () => {
    writeSkill("deploy", "---\nname: deploy\ndescription: Ship a release\n---\n");
    const result = await skillsRead.handler(
      { name: "deploy", resource: "references/api.md" },
      makeConfig(),
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("no file at references/api.md");
  });

  test("windows a long body and names the offset to continue from", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line${i + 1}`).join("\n");
    writeSkill("long", `---\nname: long\ndescription: A long one\n---\n\n${lines}\n`);

    const config: AppConfig = { ...makeConfig(), output: { maxFileLines: 10 } };
    const first = text(await skillsRead.handler({ name: "long" }, config));
    expect(first).toContain("call again with offset=10");

    const second = text(await skillsRead.handler({ name: "long", offset: 10 }, config));
    expect(second).toContain("line6");
  });

  test("errors when skills are switched off", async () => {
    writeSkill("deploy", "---\nname: deploy\ndescription: Ship a release\n---\n");
    const result = await skillsRead.handler({ name: "deploy" }, makeConfig({ enabled: false }));

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("disabled");
  });
});
