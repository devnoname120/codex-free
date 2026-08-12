import { buildInstructions } from "../instructions.js";
import type { ToolDefinition } from "../types.js";

/**
 * The whole `instructions` string, as a tool call.
 *
 * The MCP `initialize` response already carries this, but nothing obliges a
 * client to show it to its model, and the ones that don't leave the model with
 * a tool list and no idea how it is meant to work. One call to this fetches the
 * identical text — brief, environment and AGENTS.md — so a single opening
 * instruction is enough to onboard a chat.
 */
export default {
  name: "get_agent_brief",
  description:
    "Read this first, at the start of a task. Returns the full operating brief for this workspace in one call: how a coding agent is expected to behave here, the machine's OS and shell, the working directory and command policy, and the project's own AGENTS.md rules. It is the same text this server sends in its MCP instructions, so skip it if you have already been given those. Follow what it says for the rest of the conversation.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The operating brief: behaviour, environment, and project instructions.",
      },
    },
    required: ["content"],
    additionalProperties: false,
  },
  handler: async (_args, config) => ({
    content: [{ type: "text", text: buildInstructions(config) }],
  }),
} satisfies ToolDefinition;
