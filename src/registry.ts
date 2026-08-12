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
import applyPatch from "./tools/apply-patch.js";
import execCommand from "./tools/exec-command.js";
import writeStdin from "./tools/write-stdin.js";
import viewImage from "./tools/view-image.js";
import updatePlan from "./tools/update-plan.js";
import clockCurrTime from "./tools/clock-curr-time.js";
import clockSleep from "./tools/clock-sleep.js";
import getEnvironment from "./tools/get-environment.js";
import getProjectDoc from "./tools/get-project-doc.js";
import getAgentBrief from "./tools/get-agent-brief.js";

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
  // Ported from Codex (codex-rs/core/src/tools). Names use underscores because
  // MCP tool names must match ^[a-zA-Z0-9_-]{1,64}$, so Codex's `clock.curr_time`
  // becomes `clock_curr_time`.
  applyPatch,
  execCommand,
  writeStdin,
  viewImage,
  updatePlan,
  clockCurrTime,
  clockSleep,
  // None of these three is a Codex tool, because Codex does not need one: it
  // sends the OS and shell in an <environment_context> message, loads AGENTS.md
  // straight into the prompt, and puts its agent brief in the system prompt. An
  // MCP server has none of those channels, so each fact is offered as a tool
  // call as well as in the server's instructions. get_agent_brief returns all
  // three at once, for a client that only makes one onboarding call.
  getEnvironment,
  getProjectDoc,
  getAgentBrief,
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
