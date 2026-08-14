import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { AppConfig, PlanState } from "./types.js";

/**
 * Working memory that survives a chat.
 *
 * ChatGPT Web has no durable memory of a task: when its window fills or the
 * user opens a new conversation, the plan and everything learned along the way
 * are gone, and the model cannot tell that they ever existed. AGENTS.md covers
 * what is true of the *project*; this covers what is true of the *task*.
 *
 * State lives under the user's home directory, keyed by work directory, so
 * nothing is written into the repository being worked on. Notes are a keyed
 * store rather than an append-only log on purpose: overwriting "current
 * approach" is what keeps memory small and current, whereas an append log
 * accumulates contradictory entries until it is worthless.
 */
export const DEFAULT_MEMORY_MAX_BYTES = 16_384;
export const MEMORY_FILENAME = "memory.json";

export interface MemoryNote {
  value: string;
  updated_at: string;
}

export interface Memory {
  workDir: string;
  plan: PlanState | null;
  notes: Record<string, MemoryNote>;
}

export function memoryEnabled(config: AppConfig): boolean {
  return config.memory?.enabled !== false;
}

export function memoryMaxBytes(config: AppConfig): number {
  return config.memory?.maxBytes ?? DEFAULT_MEMORY_MAX_BYTES;
}

/**
 * Per-project state directory, outside the work directory by default.
 *
 * The basename is only there to make the directory recognisable when a human
 * looks; the hash of the absolute path is what actually keys it, so two
 * checkouts of the same repo do not share a memory.
 */
export function memoryDir(config: AppConfig): string {
  if (config.memory?.dir) return resolve(config.memory.dir);
  const abs = resolve(config.workDir);
  const digest = createHash("sha256").update(abs).digest("hex").slice(0, 12);
  const slug = basename(abs).replace(/[^A-Za-z0-9._-]/g, "-") || "project";
  return join(homedir(), ".codex-free", "projects", `${slug}-${digest}`);
}

export function memoryPath(config: AppConfig): string {
  return join(memoryDir(config), MEMORY_FILENAME);
}

function emptyMemory(config: AppConfig): Memory {
  return { workDir: resolve(config.workDir), plan: null, notes: {} };
}

/**
 * Read what was stored, degrading to empty rather than throwing: a corrupt or
 * unreadable memory file must not take the whole session down with it.
 */
export function loadMemory(config: AppConfig): Memory {
  if (!memoryEnabled(config)) return emptyMemory(config);
  let raw: string;
  try {
    raw = readFileSync(memoryPath(config), "utf8");
  } catch {
    return emptyMemory(config);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Memory>;
    const notes: Record<string, MemoryNote> = {};
    for (const [key, note] of Object.entries(parsed.notes ?? {})) {
      if (note && typeof note.value === "string") {
        notes[key] = { value: note.value, updated_at: String(note.updated_at ?? "") };
      }
    }
    return {
      workDir: typeof parsed.workDir === "string" ? parsed.workDir : resolve(config.workDir),
      plan: parsed.plan ?? null,
      notes,
    };
  } catch {
    return emptyMemory(config);
  }
}

export function lockPath(config: AppConfig): string {
  return `${memoryPath(config)}.lock`;
}

// A held lock older than this is assumed to belong to a writer that crashed
// mid-write, and is stolen. A real write here is sub-millisecond, so any lock
// this old is certainly abandoned.
const LOCK_STALE_MS = 10_000;
// How long to wait for a live lock before giving up and writing anyway. Losing
// the race only costs last-writer-wins, which the atomic rename keeps valid, so
// a bounded wait is better than failing the note outright.
const LOCK_TIMEOUT_MS = 2_000;
const LOCK_RETRY_MS = 20;

let atomicCounter = 0;

/** Block the current (synchronous) call for `ms`, without a busy spin. */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // SharedArrayBuffer/Atomics may be unavailable; fall back to returning
    // immediately, which only means the lock is retried sooner.
  }
}

/**
 * Take the per-project write lock, so two processes pointed at the same work
 * directory cannot lose each other's notes to an interleaved read-modify-write.
 *
 * Returns the open descriptor to release, or `null` if the lock could not be
 * taken within the timeout — in which case the caller writes anyway, degrading
 * to last-writer-wins rather than dropping the note.
 */
function acquireLock(config: AppConfig): number | null {
  const lock = lockPath(config);
  try {
    mkdirSync(memoryDir(config), { recursive: true });
  } catch {
    return null;
  }
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      try {
        writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      } catch {
        // The holder record is only a debugging aid; the lock still holds.
      }
      return fd;
    } catch (err: any) {
      if (err?.code !== "EEXIST") return null;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lock);
          continue;
        }
      } catch {
        // The lock vanished between open and stat; retry immediately.
        continue;
      }
      if (Date.now() >= deadline) return null;
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

function releaseLock(config: AppConfig, fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // Already closed; the unlink below is what actually frees the lock.
  }
  try {
    unlinkSync(lockPath(config));
  } catch {
    // Stolen by another writer after we timed out, or never created.
  }
}

/**
 * Run a read-modify-write of the state file under the write lock.
 *
 * When memory is disabled nothing touches disk, so no lock is taken. If the
 * lock cannot be acquired the work still runs — the atomic write keeps the file
 * valid, and the cost is only that a concurrent writer's change may win.
 */
function withMemoryLock<T>(config: AppConfig, fn: () => T): T {
  if (!memoryEnabled(config)) return fn();
  const fd = acquireLock(config);
  try {
    return fn();
  } finally {
    if (fd !== null) releaseLock(config, fd);
  }
}

/**
 * Write memory back atomically. Returns false when persistence failed, never
 * throws.
 *
 * The write goes to a per-process temp file that is flushed and then renamed
 * over the target: rename is atomic on a single volume, so a reader or a
 * crashing writer never sees a half-written file. Callers that read-modify-write
 * should hold the lock via `withMemoryLock` around the whole load/save.
 */
export function saveMemory(config: AppConfig, memory: Memory): boolean {
  if (!memoryEnabled(config)) return false;
  const target = memoryPath(config);
  const tmp = `${target}.tmp.${process.pid}.${atomicCounter++}`;
  try {
    mkdirSync(memoryDir(config), { recursive: true });
    const fd = openSync(tmp, "w");
    try {
      writeFileSync(fd, `${JSON.stringify(memory, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
    return true;
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing to clean up, or it was already renamed into place.
    }
    return false;
  }
}

export function notesBytes(notes: Record<string, MemoryNote>): number {
  return Object.entries(notes).reduce(
    (total, [key, note]) => total + Buffer.byteLength(key + note.value, "utf8"),
    0,
  );
}

export interface RememberResult {
  ok: boolean;
  message: string;
  memory: Memory;
}

/**
 * Set, replace or drop one note.
 *
 * Passing an empty value removes the key — the model needs a way to retract
 * something it later found to be wrong, and a note that is merely stale is
 * worse than no note.
 *
 * Over budget is a rejected write rather than a silent eviction: the model
 * knows which of its own notes matter least, and this server does not.
 */
export function remember(
  config: AppConfig,
  key: string,
  value: string,
  now: string,
): RememberResult {
  return withMemoryLock(config, () => rememberLocked(config, key, value, now));
}

function rememberLocked(
  config: AppConfig,
  key: string,
  value: string,
  now: string,
): RememberResult {
  const memory = loadMemory(config);
  const trimmedKey = key.trim();

  if (value.trim() === "") {
    if (!(trimmedKey in memory.notes)) {
      return { ok: false, message: `No note named ${JSON.stringify(trimmedKey)} to remove.`, memory };
    }
    delete memory.notes[trimmedKey];
    const stored = saveMemory(config, memory);
    return {
      ok: true,
      message: stored
        ? `Removed note ${JSON.stringify(trimmedKey)}.`
        : `Removed note ${JSON.stringify(trimmedKey)}, but memory could not be written to disk.`,
      memory,
    };
  }

  const candidate = { ...memory.notes, [trimmedKey]: { value, updated_at: now } };
  const budget = memoryMaxBytes(config);
  const size = notesBytes(candidate);
  if (size > budget) {
    const existing = Object.keys(memory.notes).sort().join(", ") || "none";
    return {
      ok: false,
      message:
        `Note rejected: notes would total ${size} bytes, over the ${budget}-byte budget. ` +
        `Remove or shorten one first by calling remember with an empty value. Current keys: ${existing}.`,
      memory,
    };
  }

  memory.notes = candidate;
  const stored = saveMemory(config, memory);
  return {
    ok: true,
    message: stored
      ? `Remembered ${JSON.stringify(trimmedKey)} (${size}/${budget} bytes used).`
      : `Could not write memory to ${memoryPath(config)}; the note is not saved.`,
    memory,
  };
}

/** Persist the plan alongside the notes, leaving the notes untouched. */
export function savePlan(config: AppConfig, plan: PlanState | null): boolean {
  return withMemoryLock(config, () => {
    const memory = loadMemory(config);
    memory.plan = plan;
    return saveMemory(config, memory);
  });
}

const STATUS_MARKERS: Record<string, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
};

/**
 * Render memory for a model that may have lost the conversation it came from,
 * so it reads as a handover rather than a data dump.
 */
export function renderMemory(memory: Memory): string | null {
  const sections: string[] = [];

  if (memory.plan && memory.plan.plan.length > 0) {
    const lines = memory.plan.plan.map((item) => `${STATUS_MARKERS[item.status] ?? "[ ]"} ${item.step}`);
    const done = memory.plan.plan.filter((i) => i.status === "completed").length;
    sections.push(
      [
        "Plan in progress:",
        ...(memory.plan.explanation ? [memory.plan.explanation] : []),
        ...lines,
        `${done}/${memory.plan.plan.length} steps completed`,
      ].join("\n"),
    );
  }

  const keys = Object.keys(memory.notes).sort();
  if (keys.length > 0) {
    sections.push(
      ["Notes:", ...keys.map((key) => `- ${key}: ${memory.notes[key]!.value}`)].join("\n"),
    );
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}
