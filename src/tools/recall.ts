import { loadMemory, memoryEnabled, renderMemory } from "../memory.js";
import type { ToolDefinition } from "../types.js";

export const NOTHING_REMEMBERED =
  "Nothing remembered for this project yet. This is a fresh start, not a lost history.";

export default {
  name: "recall",
  description:
    "Return the plan and the notes saved for this project by earlier turns or earlier conversations. Call this when you have lost the thread — a new chat, a task you are resuming, or any point where you are about to ask the user to repeat something they may already have told you. It is cheap and returns nothing when nothing was stored.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "The stored plan and notes, or a line saying there are none." },
    },
  },
  handler: async (_args, config) => {
    if (!memoryEnabled(config)) {
      return {
        content: [{
          type: "text",
          text: "Persistent memory is disabled on this server (memory.enabled is false). Nothing is stored between conversations.",
        }],
      };
    }
    const rendered = renderMemory(loadMemory(config));
    return { content: [{ type: "text", text: rendered ?? NOTHING_REMEMBERED }] };
  },
} satisfies ToolDefinition;
