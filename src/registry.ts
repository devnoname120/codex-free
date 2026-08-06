import type { ToolDefinition } from "./types.js";
import readFile from "./tools/read-file.js";
import writeFile from "./tools/write-file.js";
import runCommand from "./tools/run-command.js";
import gitStatus from "./tools/git-status.js";
import gitPush from "./tools/git-push.js";
import gitCommit from "./tools/git-commit.js";
import gitLog from "./tools/git-log.js";
import glob from "./tools/glob.js";
import grep from "./tools/grep.js";
import listDirectory from "./tools/list-directory.js";
import tree from "./tools/tree.js";

const ALL_TOOLS: ToolDefinition[] = [
  readFile,
  writeFile,
  runCommand,
  gitStatus,
  gitPush,
  gitCommit,
  gitLog,
  glob,
  grep,
  listDirectory,
  tree,
];

export function loadTools(): ToolDefinition[] {
  const seen = new Set<string>();
  for (const tool of ALL_TOOLS) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    seen.add(tool.name);
  }
  return ALL_TOOLS;
}
