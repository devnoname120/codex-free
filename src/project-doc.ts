import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig, ProjectDocConfig } from "./types.js";

/**
 * AGENTS.md discovery, ported from codex-rs/core/src/agents_md.rs.
 *
 * This is the one piece of Codex's behaviour that is not a tool. Before the
 * first turn Codex collects the AGENTS.md files along the path from the project
 * root to the working directory and injects them as user instructions, which is
 * how a Codex agent picks up a repo's conventions without being told them. An
 * MCP server has no way to send a message, so the text is surfaced through the
 * server's `instructions` and the `get_project_doc` tool instead.
 */

/** Codex's `project_doc_max_bytes` default. Zero disables loading entirely. */
export const PROJECT_DOC_MAX_BYTES = 32_768;

/** Codex's `project_root_markers` default. An empty list disables the walk up. */
export const DEFAULT_ROOT_MARKERS = [".git"];

/** Codex's preferred local override, tried ahead of AGENTS.md in each directory. */
export const OVERRIDE_FILENAME = "AGENTS.override.md";

export const DEFAULT_FILENAME = "AGENTS.md";

/** Tells the model where workspace-scoped instructions begin, as Codex does. */
export const PROJECT_DOC_SEPARATOR = "--- project-doc ---";

export function candidateFilenames(settings: ProjectDocConfig = {}): string[] {
  const names = [OVERRIDE_FILENAME, DEFAULT_FILENAME];
  for (const name of settings.fallbackFilenames ?? []) {
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Nearest ancestor of `startDir` (inclusive) holding one of `markers`, or null
 * when none does. The walk stops there so an AGENTS.md sitting above the repo —
 * in a home directory, say — never leaks into the prompt.
 */
export function findProjectRoot(startDir: string, markers: string[]): string | null {
  if (markers.length === 0) return null;
  let cursor = startDir;
  for (;;) {
    if (markers.some((marker) => existsSync(join(cursor, marker)))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

/**
 * Project docs from the project root down to the work directory, in that order,
 * at most one per directory. Ordering is Codex's: the outermost file comes
 * first, so a nested AGENTS.md is read last and qualifies what came before it.
 */
export function projectDocPaths(config: AppConfig): string[] {
  const settings = config.projectDoc ?? {};
  const root = findProjectRoot(config.workDir, settings.rootMarkers ?? DEFAULT_ROOT_MARKERS);

  const dirs: string[] = [];
  let cursor = config.workDir;
  for (;;) {
    dirs.push(cursor);
    if (root === null || cursor === root) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  dirs.reverse();

  const names = candidateFilenames(settings);
  const found: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        if (statSync(candidate).isFile()) {
          found.push(candidate);
          break;
        }
      } catch {
        // Missing or unreadable: try the next candidate filename.
      }
    }
  }
  return found;
}

export interface ProjectDocEntry {
  path: string;
  contents: string;
  /** True when the byte budget cut this file short. */
  truncated: boolean;
}

export interface ProjectDoc {
  entries: ProjectDocEntry[];
  /** The entries concatenated, which is what the model is meant to read. */
  text: string;
}

/**
 * Reads every project doc under a shared byte budget, returning null when there
 * is nothing to say. The budget is spent in discovery order and counted in
 * bytes rather than characters, so a doc that overruns it is cut mid-file the
 * way Codex cuts it; whitespace-only files are skipped without spending any.
 */
export function loadProjectDoc(config: AppConfig): ProjectDoc | null {
  const maxBytes = config.projectDoc?.maxBytes ?? PROJECT_DOC_MAX_BYTES;
  if (maxBytes <= 0) return null;

  let remaining = maxBytes;
  const entries: ProjectDocEntry[] = [];

  for (const path of projectDocPaths(config)) {
    if (remaining === 0) break;

    let data: Buffer;
    try {
      data = readFileSync(path);
    } catch {
      continue;
    }

    const truncated = data.length > remaining;
    if (truncated) data = data.subarray(0, remaining);

    const contents = data.toString("utf8");
    if (contents.trim() === "") continue;

    entries.push({ path, contents, truncated });
    remaining -= data.length;
  }

  if (entries.length === 0) return null;
  return { entries, text: entries.map((entry) => entry.contents).join("\n\n") };
}
