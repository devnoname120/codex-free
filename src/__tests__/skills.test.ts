import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_SKILL_NAME_BYTES,
  SKILL_FILENAME,
  discoverSkills,
  findSkill,
  parseSkillFrontmatter,
  renderSkillCatalog,
  resolveSkillResource,
  skillPackageFiles,
  skillRoots,
} from "../skills.js";
import type { AppConfig, SkillsConfig } from "../types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codex-free-skills-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(skills?: SkillsConfig, workDir = root): AppConfig {
  return {
    workDir,
    port: 3000,
    allowedCommands: [],
    tree: { defaultDepth: 3, ignore: [] },
    command: { defaultTimeout: 30000, maxTimeout: 120000 },
    exec: { mode: "allowlist", extraAllowedCommands: [], maxSessions: 8 },
    // An empty user scope by default, so the suite never reads the skills of
    // whoever happens to be running it.
    skills: { dirs: [], ...skills },
  };
}

/** Writes a skill package and returns the directory it lives in. */
function writeSkill(
  rootDir: string,
  name: string,
  body = `---\nname: ${name}\ndescription: Does ${name} things\n---\n\nDo the thing.\n`,
): string {
  const dir = join(rootDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SKILL_FILENAME), body);
  return dir;
}

const repoRoot = (dir = root) => join(dir, ".agents", "skills");

describe("skillRoots", () => {
  test("searches both Codex directory names in the project", () => {
    const paths = skillRoots(makeConfig()).map((entry) => entry.path);
    expect(paths).toContain(join(root, ".agents", "skills"));
    expect(paths).toContain(join(root, ".codex", "skills"));
  });

  test("repo roots come before user roots, so a project decides its own names", () => {
    const roots = skillRoots(makeConfig({ dirs: [join(root, "personal")] }));
    const firstUser = roots.findIndex((entry) => entry.scope === "user");
    const lastRepo = roots.map((entry) => entry.scope).lastIndexOf("repo");
    expect(lastRepo).toBeLessThan(firstUser);
  });

  test("walks from the project root down to the work directory", () => {
    // The marker makes root the project root, so a skill directory one level up
    // from the work directory is still in scope.
    mkdirSync(join(root, ".git"));
    const workDir = join(root, "packages", "app");
    mkdirSync(workDir, { recursive: true });

    const paths = skillRoots(makeConfig({}, workDir)).map((entry) => entry.path);
    expect(paths).toContain(repoRoot(root));
    expect(paths).toContain(repoRoot(workDir));
    expect(paths.indexOf(repoRoot(root))).toBeLessThan(paths.indexOf(repoRoot(workDir)));
  });

  test("defaults the user scope to the home directory, not the repo", () => {
    const config = makeConfig();
    delete config.skills!.dirs;

    const userRoots = skillRoots(config).filter((entry) => entry.scope === "user");
    expect(userRoots.length).toBeGreaterThan(0);
    for (const entry of userRoots) {
      expect(entry.path.startsWith(homedir())).toBe(true);
      expect(entry.path.startsWith(root)).toBe(false);
    }
  });

  test("configured directories replace the home defaults and resolve relative to work-dir", () => {
    const roots = skillRoots(makeConfig({ dirs: ["shared-skills"] }));
    const userRoots = roots.filter((entry) => entry.scope === "user");
    expect(userRoots).toEqual([{ path: join(root, "shared-skills"), scope: "user" }]);
  });

  test("lists each path once", () => {
    const paths = skillRoots(makeConfig({ dirs: [repoRoot()] })).map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("parseSkillFrontmatter", () => {
  test("reads name, description and the short description", () => {
    const parsed = parseSkillFrontmatter(
      "---\nname: review\ndescription: Review a pull request\nmetadata:\n  short-description: Review\n---\n\nbody",
      "fallback",
    );
    expect(parsed).toEqual({
      name: "review",
      description: "Review a pull request",
      shortDescription: "Review",
    });
  });

  test("falls back to the directory name, but never to a missing description", () => {
    expect(parseSkillFrontmatter("---\ndescription: Something\n---\n", "on-disk").name).toBe("on-disk");
    expect(() => parseSkillFrontmatter("---\nname: x\n---\n", "on-disk")).toThrow(
      "missing field `description`",
    );
  });

  test("collapses a wrapped scalar onto one line", () => {
    const parsed = parseSkillFrontmatter(
      "---\nname: wrapped\ndescription: >\n  one\n  two\n---\n",
      "fallback",
    );
    expect(parsed.description).toBe("one two");
  });

  test("rejects a file that does not open with a frontmatter block", () => {
    expect(() => parseSkillFrontmatter("# Just a heading\n", "x")).toThrow(
      "missing YAML frontmatter",
    );
  });

  test("rejects invalid YAML", () => {
    expect(() => parseSkillFrontmatter("---\nname: [unclosed\n---\n", "x")).toThrow("invalid YAML");
  });

  test("rejects a name longer than Codex allows", () => {
    const long = "n".repeat(MAX_SKILL_NAME_BYTES + 1);
    expect(() => parseSkillFrontmatter(`---\nname: ${long}\ndescription: d\n---\n`, "x")).toThrow(
      "invalid name",
    );
  });
});

describe("discoverSkills", () => {
  test("finds project skills, sorted by name", () => {
    writeSkill(repoRoot(), "beta");
    writeSkill(repoRoot(), "alpha");

    const catalog = discoverSkills(makeConfig());
    expect(catalog.skills.map((skill) => skill.name)).toEqual(["alpha", "beta"]);
    expect(catalog.skills[0]!.scope).toBe("repo");
    expect(catalog.skills[0]!.path).toBe(join(repoRoot(), "alpha", SKILL_FILENAME));
  });

  test("a directory without a SKILL.md is not a skill and is passed over quietly", () => {
    mkdirSync(join(repoRoot(), "not-a-skill"), { recursive: true });
    writeFileSync(join(repoRoot(), "loose.md"), "stray");

    const catalog = discoverSkills(makeConfig());
    expect(catalog.skills).toEqual([]);
    expect(catalog.warnings).toEqual([]);
  });

  test("a repo skill shadows a user skill of the same name, and says so", () => {
    const userDir = join(root, "personal");
    writeSkill(repoRoot(), "deploy", "---\nname: deploy\ndescription: The project's own\n---\n");
    writeSkill(userDir, "deploy", "---\nname: deploy\ndescription: A personal one\n---\n");

    const catalog = discoverSkills(makeConfig({ dirs: [userDir] }));
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0]!.description).toBe("The project's own");
    expect(catalog.warnings).toHaveLength(1);
    expect(catalog.warnings[0]!.path).toBe(join(userDir, "deploy", SKILL_FILENAME));
    expect(catalog.warnings[0]!.message).toContain("shadowed by the repo skill");
  });

  // A skill nobody can see is worse than one that fails loudly: the author meant
  // it to be there and would otherwise never find out why it is not.
  test("unusable frontmatter is reported rather than dropped", () => {
    writeSkill(repoRoot(), "broken", "---\nname: broken\n---\n\nno description\n");
    writeSkill(repoRoot(), "fine");

    const catalog = discoverSkills(makeConfig());
    expect(catalog.skills.map((skill) => skill.name)).toEqual(["fine"]);
    expect(catalog.warnings[0]!.message).toContain("description");
  });

  test("searches nothing when skills are disabled", () => {
    writeSkill(repoRoot(), "alpha");
    const catalog = discoverSkills(makeConfig({ enabled: false }));
    expect(catalog).toEqual({ skills: [], warnings: [], roots: [] });
  });
});

describe("findSkill", () => {
  test("matches exactly, then case-insensitively, then not at all", () => {
    writeSkill(repoRoot(), "Code-Review");
    const catalog = discoverSkills(makeConfig());

    expect(findSkill(catalog, "Code-Review")?.name).toBe("Code-Review");
    expect(findSkill(catalog, "code-review")?.name).toBe("Code-Review");
    expect(findSkill(catalog, "missing")).toBeNull();
  });
});

describe("resolveSkillResource", () => {
  test("resolves against the skill's own directory", () => {
    const dir = writeSkill(repoRoot(), "alpha");
    const skill = discoverSkills(makeConfig()).skills[0]!;
    expect(resolveSkillResource(skill, "references/api.md")).toBe(join(dir, "references", "api.md"));
    expect(resolveSkillResource(skill, "./scripts/run.py")).toBe(join(dir, "scripts", "run.py"));
  });

  // Skills sit outside work-dir, so this containment check is the only thing
  // standing between a `resource` argument and the rest of the home directory.
  test("refuses to escape the skill", () => {
    writeSkill(repoRoot(), "alpha");
    const skill = discoverSkills(makeConfig()).skills[0]!;
    for (const escape of ["../beta/SKILL.md", "a/../../b", "/etc/passwd", ""]) {
      expect(() => resolveSkillResource(skill, escape)).toThrow("inside the skill");
    }
  });
});

describe("skillPackageFiles", () => {
  test("lists everything but SKILL.md, as paths to pass back as resource", () => {
    const dir = writeSkill(repoRoot(), "alpha");
    mkdirSync(join(dir, "references"), { recursive: true });
    writeFileSync(join(dir, "references", "api.md"), "");
    writeFileSync(join(dir, "run.py"), "");

    const skill = discoverSkills(makeConfig()).skills[0]!;
    expect(skillPackageFiles(skill)).toEqual(["references/api.md", "run.py"]);
  });

  test("stops at the cap", () => {
    const dir = writeSkill(repoRoot(), "alpha");
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, `f${i}.txt`), "");

    const skill = discoverSkills(makeConfig()).skills[0]!;
    expect(skillPackageFiles(skill, 3)).toHaveLength(3);
  });
});

describe("renderSkillCatalog", () => {
  test("says nothing when there is nothing installed", () => {
    expect(renderSkillCatalog(discoverSkills(makeConfig()))).toBeNull();
  });

  test("gives the model a name and a reason per skill", () => {
    writeSkill(repoRoot(), "alpha");
    expect(renderSkillCatalog(discoverSkills(makeConfig()))).toBe(
      "- alpha (repo) — Does alpha things",
    );
  });
});
