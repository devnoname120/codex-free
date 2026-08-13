import { memoryEnabled, remember } from "../memory.js";
import type { ToolDefinition } from "../types.js";

/**
 * Codex has no equivalent: its context is large enough, and its session state
 * lives in the CLI process. Here the client is a chat window that will lose
 * this conversation, so what matters has to be written down somewhere else.
 */
export default {
  name: "remember",
  description:
    "Save one durable note about this project or task, under a short key. Notes outlive the conversation and are handed back at the start of the next one, so use this for anything that would be expensive to rediscover: a decision and its reason, a non-obvious constraint, where something unexpected lives, what you already tried that did not work. Writing to a key that exists replaces it — prefer updating a key over adding near-duplicates. Passing an empty value removes the key, which is how you retract a note you have found to be wrong. Do not use this for things the repository already records; put lasting project conventions in AGENTS.md instead.",
  inputSchema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Short stable identifier, e.g. \"auth-approach\" or \"why-not-esm\". Reusing a key overwrites that note.",
      },
      value: {
        type: "string",
        description: "The note itself, in a sentence or two. Empty removes the key.",
      },
    },
    required: ["key", "value"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "What was stored, or why it was rejected." },
    },
  },
  handler: async (args, config) => {
    const key = typeof args.key === "string" ? args.key : "";
    const value = typeof args.value === "string" ? args.value : "";

    if (key.trim() === "") {
      return { content: [{ type: "text", text: "key must be a non-empty string" }], isError: true };
    }
    if (!memoryEnabled(config)) {
      return {
        content: [{
          type: "text",
          text: "Persistent memory is disabled on this server (memory.enabled is false), so this note was not saved. Keep it in the conversation instead.",
        }],
        isError: true,
      };
    }

    const result = remember(config, key, value, new Date().toISOString());
    if (!result.ok) {
      return { content: [{ type: "text", text: result.message }], isError: true };
    }
    return { content: [{ type: "text", text: result.message }] };
  },
} satisfies ToolDefinition;
