import type { ToolDefinition } from "../types.js";

/** Formats a Date as Codex does: `YYYY-MM-DD HH:MM:SS UTC`. */
function formatUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

export default {
  name: "clock_curr_time",
  description: "Return the current time in UTC. Use this to timestamp work, measure how long something took, or reason about deadlines — the conversation itself carries no reliable clock.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      current_time: {
        type: "string",
        description: "Current UTC time formatted as YYYY-MM-DD HH:MM:SS UTC.",
      },
    },
    required: ["current_time"],
    additionalProperties: false,
  },
  handler: async () => {
    return { content: [{ type: "text", text: formatUtc(new Date()) }] };
  },
} satisfies ToolDefinition;
