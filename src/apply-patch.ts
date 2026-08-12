/**
 * Port of Codex's `apply_patch` format (codex-rs/apply-patch), covering the
 * grammar in codex-rs/core/src/tools/handlers/apply_patch.lark:
 *
 *   *** Begin Patch
 *   *** Add File: <path>      followed by "+" lines
 *   *** Delete File: <path>
 *   *** Update File: <path>   optional "*** Move to: <path>", then @@ chunks
 *   *** End Patch
 *
 * Parsing and applying are deliberately separate passes: the whole patch is
 * validated and every hunk resolved against the current file contents before a
 * single byte is written, so a patch that fails halfway never leaves the
 * working tree half-edited.
 */

export interface UpdateChunk {
  /** A single line used to narrow down where the chunk applies (`@@ <text>`). */
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  /** Set by `*** End of File`: `oldLines` must sit at the end of the file. */
  isEndOfFile: boolean;
}

export type PatchAction =
  | { type: "add"; path: string; lines: string[] }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: UpdateChunk[] };

const BEGIN_PATCH = "*** Begin Patch";
const END_PATCH = "*** End Patch";
const ADD_FILE = "*** Add File: ";
const DELETE_FILE = "*** Delete File: ";
const UPDATE_FILE = "*** Update File: ";
const MOVE_TO = "*** Move to: ";
const END_OF_FILE = "*** End of File";

export class PatchParseError extends Error {}

function isHunkStart(line: string): boolean {
  return (
    line.startsWith(ADD_FILE) ||
    line.startsWith(DELETE_FILE) ||
    line.startsWith(UPDATE_FILE) ||
    line === END_PATCH
  );
}

export function parsePatch(patch: string): PatchAction[] {
  const normalized = patch.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  // Tolerate leading/trailing blank lines around the envelope; models routinely
  // add them when the patch is embedded in JSON.
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();

  if (lines.length === 0 || lines[0] !== BEGIN_PATCH) {
    throw new PatchParseError(`The first line of the patch must be '${BEGIN_PATCH}'`);
  }
  if (lines[lines.length - 1] !== END_PATCH) {
    throw new PatchParseError(`The last line of the patch must be '${END_PATCH}'`);
  }

  const actions: PatchAction[] = [];
  let i = 1;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line === END_PATCH) {
      i += 1;
      continue;
    }

    if (line.startsWith(ADD_FILE)) {
      const path = line.slice(ADD_FILE.length);
      i += 1;
      const added: string[] = [];
      while (i < lines.length && !isHunkStart(lines[i]!)) {
        const body = lines[i]!;
        if (!body.startsWith("+")) {
          throw new PatchParseError(
            `Unexpected line found in add hunk: '${body}'. Every line should start with '+'`,
          );
        }
        added.push(body.slice(1));
        i += 1;
      }
      actions.push({ type: "add", path, lines: added });
      continue;
    }

    if (line.startsWith(DELETE_FILE)) {
      actions.push({ type: "delete", path: line.slice(DELETE_FILE.length) });
      i += 1;
      continue;
    }

    if (line.startsWith(UPDATE_FILE)) {
      const path = line.slice(UPDATE_FILE.length);
      i += 1;

      let movePath: string | undefined;
      if (i < lines.length && lines[i]!.startsWith(MOVE_TO)) {
        movePath = lines[i]!.slice(MOVE_TO.length);
        i += 1;
      }

      const chunks: UpdateChunk[] = [];
      let chunk: UpdateChunk | null = null;

      while (i < lines.length && !isHunkStart(lines[i]!)) {
        const body = lines[i]!;

        if (body.startsWith("@@")) {
          const context = body.slice(2).trim();
          chunk = { changeContext: context === "" ? undefined : context, oldLines: [], newLines: [], isEndOfFile: false };
          chunks.push(chunk);
          i += 1;
          continue;
        }

        if (chunk === null) {
          throw new PatchParseError(
            `Expected update hunk to start with a @@ context marker, got: '${body}'`,
          );
        }

        if (body === END_OF_FILE) {
          chunk.isEndOfFile = true;
          i += 1;
          continue;
        }

        if (body.startsWith("+")) {
          chunk.newLines.push(body.slice(1));
        } else if (body.startsWith("-")) {
          chunk.oldLines.push(body.slice(1));
        } else if (body.startsWith(" ") || body === "") {
          // A bare empty line is a context line whose leading space was trimmed.
          const text = body === "" ? "" : body.slice(1);
          chunk.oldLines.push(text);
          chunk.newLines.push(text);
        } else {
          throw new PatchParseError(
            `Unexpected line found in update hunk: '${body}'. ` +
              `Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
          );
        }
        i += 1;
      }

      if (chunks.length === 0) {
        throw new PatchParseError(`Update hunk for '${path}' contains no @@ chunks`);
      }
      actions.push({ type: "update", path, movePath, chunks });
      continue;
    }

    throw new PatchParseError(
      `Unexpected line found in patch: '${line}'. ` +
        `Expected '${ADD_FILE.trim()}', '${DELETE_FILE.trim()}', '${UPDATE_FILE.trim()}' or '${END_PATCH}'`,
    );
  }

  if (actions.length === 0) {
    throw new PatchParseError("The patch contains no hunks");
  }
  return actions;
}

/**
 * Normalises typographic punctuation to ASCII so a patch authored with plain
 * quotes still matches source that contains curly ones — the same leniency
 * `git apply` has when locating context.
 */
function normaliseFuzzy(text: string): string {
  return text
    .trim()
    // U+2010..U+2015 and U+2212 (dashes), U+2018..U+201B and U+201C..U+201F
    // (curly quotes), then the assorted non-breaking and typographic spaces.
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘-‛]/g, "'")
    .replace(/[“-‟]/g, '"')
    .replace(/[  -   　]/g, " ");
}

/**
 * Finds `pattern` within `lines` at or after `start`, trying progressively
 * looser comparisons: exact, ignoring trailing whitespace, ignoring whitespace
 * on both sides, then with punctuation normalised. When `eof` is set the search
 * begins at the last position where the pattern could still fit, so patterns
 * meant for the end of a file land there.
 */
export function seekSequence(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
): number | null {
  if (pattern.length === 0) return start;
  if (pattern.length > lines.length) return null;

  const searchStart = eof ? lines.length - pattern.length : start;
  const last = lines.length - pattern.length;

  const passes: Array<(a: string, b: string) => boolean> = [
    (a, b) => a === b,
    (a, b) => a.trimEnd() === b.trimEnd(),
    (a, b) => a.trim() === b.trim(),
    (a, b) => normaliseFuzzy(a) === normaliseFuzzy(b),
  ];

  for (const matches of passes) {
    for (let i = Math.max(searchStart, 0); i <= last; i++) {
      let ok = true;
      for (let p = 0; p < pattern.length; p++) {
        if (!matches(lines[i + p]!, pattern[p]!)) {
          ok = false;
          break;
        }
      }
      if (ok) return i;
    }
  }
  return null;
}

type Replacement = { start: number; oldLen: number; newLines: string[] };

function computeReplacements(
  originalLines: string[],
  path: string,
  chunks: UpdateChunk[],
): Replacement[] {
  const replacements: Replacement[] = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const idx = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
      if (idx === null) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${path}`);
      }
      lineIndex = idx + 1;
    }

    if (chunk.oldLines.length === 0) {
      // Pure insertion: append at the end of the file.
      replacements.push({ start: originalLines.length, oldLen: 0, newLines: chunk.newLines });
      continue;
    }

    let pattern = chunk.oldLines;
    let newSlice = chunk.newLines;
    let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);

    if (found === null && pattern[pattern.length - 1] === "") {
      // The trailing empty string stands for the file's final newline, which is
      // not a real line. Retry without it.
      pattern = pattern.slice(0, -1);
      if (newSlice[newSlice.length - 1] === "") newSlice = newSlice.slice(0, -1);
      found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    }

    if (found === null) {
      throw new Error(`Failed to find expected lines in ${path}:\n${chunk.oldLines.join("\n")}`);
    }

    replacements.push({ start: found, oldLen: pattern.length, newLines: newSlice });
    lineIndex = found + pattern.length;
  }

  replacements.sort((a, b) => a.start - b.start);
  return replacements;
}

function applyReplacements(lines: string[], replacements: Replacement[]): string[] {
  const result = [...lines];
  // Descending order, so earlier splices do not shift later indices.
  for (let r = replacements.length - 1; r >= 0; r--) {
    const { start, oldLen, newLines } = replacements[r]!;
    result.splice(start, oldLen, ...newLines);
  }
  return result;
}

/** True when the file predominantly uses CRLF line endings. */
export function usesCrlf(contents: string): boolean {
  const crlf = (contents.match(/\r\n/g) ?? []).length;
  if (crlf === 0) return false;
  const lf = (contents.match(/\n/g) ?? []).length;
  return crlf * 2 >= lf;
}

/**
 * Returns the new contents of a file after applying `chunks`. Line endings are
 * matched to whatever the file already used, so patching a CRLF file on Windows
 * does not rewrite every line.
 */
export function applyUpdate(originalContents: string, chunks: UpdateChunk[], path: string): string {
  const crlf = usesCrlf(originalContents);
  const normalized = originalContents.replace(/\r\n/g, "\n");

  const originalLines = normalized.split("\n");
  // Drop the empty element produced by a trailing newline so line counts match
  // what `diff` would report.
  if (originalLines[originalLines.length - 1] === "") originalLines.pop();

  const replacements = computeReplacements(originalLines, path, chunks);
  const newLines = applyReplacements(originalLines, replacements);
  newLines.push("");

  const joined = newLines.join("\n");
  return crlf ? joined.replace(/\n/g, "\r\n") : joined;
}

/** Renders the body of an `*** Add File:` hunk into file contents. */
export function renderAddedFile(lines: string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
