import type { AppConfig } from "./types.js";

/**
 * Ceilings on what a single tool call may return.
 *
 * `exec_command` already had one, ported from Codex; the tools written before
 * it did not, and an uncapped `read_file` or `glob` is the fastest way to spend
 * a context window. These are defaults rather than the model's business: a
 * caller that forgets to paginate should still get a bounded answer.
 *
 * Every cut is announced in the tool's own text, with the argument that
 * continues from where it stopped. Silent truncation reads as "that was the
 * whole file", which is worse than no cap at all.
 */
export const DEFAULT_MAX_FILE_LINES = 1_000;
export const DEFAULT_MAX_FILE_BYTES = 131_072;
export const DEFAULT_MAX_ENTRIES = 500;
export const DEFAULT_MAX_TREE_NODES = 1_000;

export interface FileBudget {
  maxLines: number;
  maxBytes: number;
}

export function fileBudget(config: AppConfig): FileBudget {
  return {
    maxLines: config.output?.maxFileLines ?? DEFAULT_MAX_FILE_LINES,
    maxBytes: config.output?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  };
}

export function entryBudget(config: AppConfig): number {
  return config.output?.maxEntries ?? DEFAULT_MAX_ENTRIES;
}

export function treeNodeBudget(config: AppConfig): number {
  return config.output?.maxTreeNodes ?? DEFAULT_MAX_TREE_NODES;
}

export interface FileWindow {
  /** The lines actually returned. */
  lines: string[];
  /** 0-based index of the first returned line. */
  start: number;
  /** Total lines in the file, before any windowing. */
  total: number;
  /** Human-readable note about what was cut, or null when nothing was. */
  notice: string | null;
}

/**
 * Slice a file to a window that fits both budgets.
 *
 * The byte cap is not redundant with the line cap: a minified bundle is often
 * one line several megabytes long, which a line cap alone would return in full.
 */
export function windowFileLines(
  lines: string[],
  offset: number,
  requestedLimit: number | undefined,
  budget: FileBudget,
): FileWindow {
  const total = lines.length;
  const start = Math.max(0, Math.min(Math.trunc(offset) || 0, total));
  const limit = Math.max(
    0,
    Math.min(requestedLimit ?? budget.maxLines, budget.maxLines),
  );

  const kept: string[] = [];
  let bytes = 0;
  let cutOnBytes = false;

  for (const line of lines.slice(start, start + limit)) {
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + size > budget.maxBytes) {
      if (kept.length === 0) {
        // A single line larger than the whole budget: return a prefix of it so
        // the caller sees something rather than an empty window.
        kept.push(
          Buffer.from(line, "utf8").subarray(0, budget.maxBytes).toString("utf8"),
        );
      }
      cutOnBytes = true;
      break;
    }
    kept.push(line);
    bytes += size;
  }

  const end = start + kept.length;
  if (start === 0 && end === total && !cutOnBytes) {
    return { lines: kept, start, total, notice: null };
  }

  const reason = cutOnBytes ? ", cut at the byte budget" : "";
  const more = end < total ? ` — call again with offset=${end} for the rest` : "";
  return {
    lines: kept,
    start,
    total,
    notice: `(showing lines ${start + 1}-${end} of ${total}${reason}${more})`,
  };
}

/** Cut a list to `max`, reporting how many entries were dropped. */
export function limitList<T>(items: T[], max: number): { items: T[]; dropped: number } {
  if (max <= 0 || items.length <= max) return { items, dropped: 0 };
  return { items: items.slice(0, max), dropped: items.length - max };
}
