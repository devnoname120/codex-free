import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import type { AppConfig } from "./types.js";

/**
 * One ignore policy for every tool that walks the tree.
 *
 * glob, grep, tree and list_directory each used to carry their own hardcoded
 * (and divergent) skip list, and none of them read the repository's own
 * .gitignore — so `glob **\/*.ts` walked straight into node_modules and handed
 * back thousands of dependency hits, and a file the repo deliberately ignores
 * was returned like any other. This module is the single place that decides
 * what a search should never surface: a default set, the project's .gitignore,
 * git's local excludes, and whatever the config adds.
 *
 * Only the work directory's own .gitignore is read (plus .git/info/exclude);
 * per-subdirectory .gitignore files are not walked. That covers the common case
 * — one root .gitignore listing build output, caches and lockfiles — without the
 * bookkeeping of tracking which subtree each nested pattern belongs to.
 */

/**
 * Directories and files never worth returning to the model: dependency trees,
 * VCS internals, build output, caches. The union of what glob, grep and tree
 * each skipped before, minus the divergence.
 *
 * Bare names (no trailing slash) so each matches both the directory and its
 * contents under gitignore semantics.
 */
export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
];

/**
 * Directories pruned from every walk no matter what the config says, so a
 * search never pays to descend a dependency tree or a VCS store — even with
 * default patterns turned off or a .gitignore that forgot them.
 */
export const ALWAYS_PRUNE = new Set(["node_modules", ".git"]);

export function useGitignore(config: AppConfig): boolean {
  return config.ignore?.useGitignore !== false;
}

export function useDefaultPatterns(config: AppConfig): boolean {
  return config.ignore?.useDefaultPatterns !== false;
}

/**
 * Build the matcher for a work directory. Cheap enough to call per tool
 * invocation, so a .gitignore edited mid-session takes effect on the next call.
 */
export function buildIgnore(config: AppConfig): Ignore {
  const ig = ignore();

  if (useDefaultPatterns(config)) {
    ig.add(DEFAULT_IGNORE);
  }

  if (useGitignore(config)) {
    for (const rel of [".gitignore", join(".git", "info", "exclude")]) {
      try {
        ig.add(readFileSync(join(config.workDir, rel), "utf8"));
      } catch {
        // No such file; nothing to add.
      }
    }
  }

  // config.tree.ignore predates this module and was tree-only; honour it for
  // every tool now so existing configs keep working and stay consistent.
  if (Array.isArray(config.tree?.ignore)) ig.add(config.tree.ignore);
  if (Array.isArray(config.ignore?.customPatterns)) ig.add(config.ignore!.customPatterns);

  return ig;
}

/**
 * The work-dir-relative POSIX path the matcher expects, or null when `absPath`
 * is the work directory itself or lies outside it. `ignore` throws on absolute
 * paths and on "", so both must be filtered out before `.ignores` is called.
 */
export function toRelPosix(absPath: string, workDir: string): string | null {
  const rel = relative(workDir, absPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** True when an absolute path should be hidden from a search. */
export function isIgnored(ig: Ignore, absPath: string, workDir: string): boolean {
  const rel = toRelPosix(absPath, workDir);
  if (rel === null) return false;
  return ig.ignores(rel);
}

/** True when a directory should not be descended into during a walk. */
export function shouldPrune(ig: Ignore, name: string, absPath: string, workDir: string): boolean {
  return ALWAYS_PRUNE.has(name) || isIgnored(ig, absPath, workDir);
}

/**
 * Glob patterns for fast-glob's own `ignore`, so it never traverses the heavy
 * default directories in the first place. This is a performance floor only:
 * correctness (including .gitignore) is enforced by filtering matches through
 * `isIgnored` afterwards, because fast-glob does not read .gitignore.
 */
export function fastGlobIgnore(config: AppConfig): string[] {
  if (!useDefaultPatterns(config)) {
    return ["**/node_modules/**", "**/.git/**"];
  }
  return DEFAULT_IGNORE.flatMap((name) => [`**/${name}`, `**/${name}/**`]);
}
