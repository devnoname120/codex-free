import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { projectDirs } from "./project-doc.js";
import type { AppConfig } from "./types.js";

/**
 * Skill discovery, ported from `codex-rs/ext/skills` and `codex-rs/skills`.
 *
 * A skill is a directory holding a `SKILL.md` whose YAML frontmatter names it
 * and says when to use it. The body is instructions the agent follows for that
 * task, and the directory may carry references, scripts and assets alongside.
 * Codex loads the catalogue at session start, puts the names and descriptions
 * in the prompt, and reads a body only once a skill is actually chosen — the
 * progressive disclosure that keeps a large library affordable.
 *
 * The port keeps the file format and the discovery span and drops the rest of
 * upstream's machinery: it has no execution environments, so there are no
 * executor or orchestrator packages, no `skill://` locators and no root
 * aliasing, and at this scale the BM25 shadow selector has nothing to select
 * from. What remains is the host filesystem, which is the only source an MCP
 * bridge can reach anyway.
 */

export const SKILL_FILENAME = "SKILL.md";

/**
 * Directory names searched inside each project directory and under the home
 * directory. Both are Codex's: `.agents/skills` is the current location and
 * `.codex/skills` the one its own repository still uses.
 */
export const SKILL_DIR_NAMES = [join(".agents", "skills"), join(".codex", "skills")];

/** Codex's `MAX_NAME_LEN`, counted in bytes as the Rust does. */
export const MAX_SKILL_NAME_BYTES = 64;

/** Files listed after a SKILL.md body so the model can reach the rest of the package. */
export const MAX_SKILL_PACKAGE_FILES = 50;

export type SkillScope = "repo" | "user";

export interface SkillRoot {
  path: string;
  scope: SkillScope;
}

export interface Skill {
  name: string;
  description: string;
  /** Optional `metadata.short-description`, for clients with less room. */
  shortDescription?: string;
  /** Directory holding SKILL.md. Resources resolve against it, never against work-dir. */
  dir: string;
  /** Absolute path of the SKILL.md itself. */
  path: string;
  scope: SkillScope;
}

/** A skill directory that was found but could not be offered, and why. */
export interface SkillWarning {
  path: string;
  message: string;
}

export interface SkillCatalog {
  skills: Skill[];
  warnings: SkillWarning[];
  /** Roots that were searched, in precedence order, whether or not they exist. */
  roots: SkillRoot[];
}

export function skillsEnabled(config: AppConfig): boolean {
  return config.skills?.enabled ?? true;
}

/**
 * Roots to search, highest precedence first.
 *
 * Repo skills come before user skills, so a project that ships a skill decides
 * how that name behaves inside it; a personal skill of the same name is shadowed
 * rather than silently merged. Within the repo the walk runs outermost first,
 * matching how AGENTS.md is layered.
 */
export function skillRoots(config: AppConfig): SkillRoot[] {
  const roots: SkillRoot[] = [];

  for (const dir of projectDirs(config)) {
    for (const name of SKILL_DIR_NAMES) roots.push({ path: join(dir, name), scope: "repo" });
  }

  const configured = config.skills?.dirs;
  if (configured) {
    // Configured directories replace the home-directory defaults rather than
    // adding to them, so a caller can say exactly what the user scope is — which
    // is also how the test suite avoids reading the running user's own skills.
    for (const dir of configured) {
      roots.push({ path: isAbsolute(dir) ? dir : resolve(config.workDir, dir), scope: "user" });
    }
  } else {
    const home = homedir();
    for (const name of SKILL_DIR_NAMES) roots.push({ path: join(home, name), scope: "user" });
  }

  const seen = new Set<string>();
  return roots.filter((root) => {
    if (seen.has(root.path)) return false;
    seen.add(root.path);
    return true;
  });
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  shortDescription?: string;
}

/**
 * The YAML block between the leading `---` and the next one, or null when the
 * file does not open with one.
 */
export function extractFrontmatter(contents: string): string | null {
  const text = contents.startsWith("﻿") ? contents.slice(1) : contents;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") return lines.slice(1, i).join("\n");
  }
  return null;
}

/** Codex collapses runs of whitespace so a wrapped YAML scalar stays one line. */
function singleLine(raw: unknown): string {
  return typeof raw === "string" ? raw.split(/\s+/).filter(Boolean).join(" ") : "";
}

/**
 * Parses and validates a SKILL.md frontmatter block, throwing with Codex's own
 * wording when it is unusable.
 *
 * `name` falls back to the directory name, which is how most skills are written;
 * `description` does not, because it is the only thing the model sees before
 * deciding whether to read the skill at all.
 */
export function parseSkillFrontmatter(contents: string, defaultName: string): SkillFrontmatter {
  const block = extractFrontmatter(contents);
  if (block === null) throw new Error("missing YAML frontmatter delimited by ---");

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(block);
  } catch (err: any) {
    throw new Error(`invalid YAML: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid YAML: frontmatter is not a mapping");
  }

  const fields = parsed as Record<string, unknown>;
  const metadata =
    typeof fields.metadata === "object" && fields.metadata !== null
      ? (fields.metadata as Record<string, unknown>)
      : {};

  const name = singleLine(fields.name) || defaultName;
  const description = singleLine(fields.description);
  const shortDescription = singleLine(metadata["short-description"]);

  if (Buffer.byteLength(name, "utf8") > MAX_SKILL_NAME_BYTES) {
    throw new Error(`invalid name: longer than ${MAX_SKILL_NAME_BYTES} bytes`);
  }
  if (description === "") throw new Error("missing field `description`");

  return { name, description, ...(shortDescription ? { shortDescription } : {}) };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every skill reachable from the configured roots, sorted by name.
 *
 * A directory without a SKILL.md is not a skill and is passed over in silence;
 * one that has a SKILL.md it cannot use — bad frontmatter, or a name already
 * taken by a higher-precedence root — is reported as a warning, because the
 * author meant it to be there and would otherwise never learn why it is not.
 */
export function discoverSkills(config: AppConfig): SkillCatalog {
  if (!skillsEnabled(config)) return { skills: [], warnings: [], roots: [] };

  const roots = skillRoots(config);
  const skills: Skill[] = [];
  const warnings: SkillWarning[] = [];
  const byName = new Map<string, Skill>();

  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root.path);
    } catch {
      continue;
    }

    for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
      const dir = join(root.path, entry);
      if (!isDirectory(dir)) continue;

      const path = join(dir, SKILL_FILENAME);
      let contents: string;
      try {
        contents = readFileSync(path, "utf8");
      } catch {
        continue;
      }

      let parsed: SkillFrontmatter;
      try {
        parsed = parseSkillFrontmatter(contents, entry);
      } catch (err: any) {
        warnings.push({ path, message: err.message });
        continue;
      }

      const shadowed = byName.get(parsed.name.toLowerCase());
      if (shadowed) {
        warnings.push({ path, message: `shadowed by the ${shadowed.scope} skill at ${shadowed.path}` });
        continue;
      }

      const skill: Skill = { ...parsed, dir, path, scope: root.scope };
      byName.set(parsed.name.toLowerCase(), skill);
      skills.push(skill);
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, warnings, roots };
}

/** Lookup by name, exact first and case-insensitively after, as Codex resolves mentions. */
export function findSkill(catalog: SkillCatalog, name: string): Skill | null {
  const wanted = name.trim();
  return (
    catalog.skills.find((skill) => skill.name === wanted) ??
    catalog.skills.find((skill) => skill.name.toLowerCase() === wanted.toLowerCase()) ??
    null
  );
}

/**
 * Absolute path of a file inside a skill package.
 *
 * Skills live outside the work directory, so `resolveSafePath` does not apply and
 * containment is checked against the skill's own directory instead. That check is
 * the whole point of routing package files through this tool: without it, a
 * resource argument would be an arbitrary read of the user's home directory.
 */
export function resolveSkillResource(skill: Skill, resource: string): string {
  const relative = resource.replace(/\\/g, "/").replace(/^\.\//, "");
  if (relative === "" || isAbsolute(resource) || /^[a-zA-Z]:/.test(resource)) {
    throw new Error(`Resource must be a path inside the skill: ${resource}`);
  }
  if (relative.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Resource must be a path inside the skill: ${resource}`);
  }

  const full = resolve(skill.dir, relative);
  if (full !== skill.dir && !full.startsWith(skill.dir + sep)) {
    throw new Error(`Resource must be a path inside the skill: ${resource}`);
  }
  return full;
}

/**
 * Package files other than SKILL.md, as paths to pass back as `resource`.
 *
 * Listed with the body so progressive disclosure has something to disclose: the
 * model cannot glob a directory outside work-dir, so without this it would have
 * to guess the paths a SKILL.md mentions in prose.
 */
export function skillPackageFiles(skill: Skill, max = MAX_SKILL_PACKAGE_FILES): string[] {
  const found: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    if (found.length >= max) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
      if (found.length >= max) return;
      const child = join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      if (isDirectory(child)) {
        walk(child, relative);
      } else if (relative !== SKILL_FILENAME) {
        found.push(relative);
      }
    }
  };

  walk(skill.dir, "");
  return found;
}

/**
 * The catalogue as the model should see it: what each skill is for, and the
 * name to pass to skills_read. Null when there is nothing to offer, so callers
 * can leave the whole section out rather than announce an empty library.
 */
export function renderSkillCatalog(catalog: SkillCatalog): string | null {
  if (catalog.skills.length === 0) return null;
  return catalog.skills
    .map((skill) => `- ${skill.name} (${skill.scope}) — ${skill.description}`)
    .join("\n");
}
