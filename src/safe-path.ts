import { resolve, normalize, sep } from "node:path";

/**
 * Resolves `inputPath` against `workDir` and guarantees the result stays
 * within `workDir`. This is the security boundary used by every tool that
 * touches the filesystem (read_file, write_file, glob, grep, list_directory,
 * tree, ...) to prevent path traversal outside of the configured work
 * directory.
 */
export function resolveSafePath(inputPath: string, workDir: string, allowEmpty = false): string {
  const normalizedWorkDir = normalize(resolve(workDir));

  if (!inputPath) {
    if (allowEmpty) {
      return normalizedWorkDir;
    }
    throw new Error("Path must not be empty");
  }

  const resolved = resolve(normalizedWorkDir, inputPath);
  const normalizedResolved = normalize(resolved);

  const isSamePath = normalizedResolved === normalizedWorkDir;
  const isWithinWorkDir = normalizedResolved.startsWith(normalizedWorkDir + sep);

  if (!isSamePath && !isWithinWorkDir) {
    throw new Error("Path must be within work directory");
  }

  return normalizedResolved;
}
