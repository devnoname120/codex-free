import type { ToolDefinition } from "../types.js";

/**
 * Codex allows up to 12 hours here. This bridge caps at 5 minutes: the MCP
 * transport is an HTTP request through a tunnel, and anything longer dies to an
 * idle timeout rather than returning. Over-long requests are rejected instead of
 * silently shortened so the caller is never told it slept longer than it did.
 */
const MAX_SLEEP_DURATION_MS = 5 * 60 * 1000;

export default {
  name: "clock_sleep",
  description: `Pause execution for a specified duration, then return the elapsed wall-clock time. Use this to wait between polls of a long-running exec_command session or an external job. Must be between 1 and ${MAX_SLEEP_DURATION_MS} ms.`,
  inputSchema: {
    type: "object",
    properties: {
      duration_ms: {
        type: "number",
        description: `How long to sleep in milliseconds. Must be between 1 and ${MAX_SLEEP_DURATION_MS}.`,
      },
    },
    required: ["duration_ms"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Elapsed wall-clock time and a completion message" },
    },
  },
  handler: async (args) => {
    const durationMs = args.duration_ms;

    if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
      return {
        content: [{ type: "text", text: "duration_ms must be a number" }],
        isError: true,
      };
    }
    if (durationMs < 1 || durationMs > MAX_SLEEP_DURATION_MS) {
      return {
        content: [{ type: "text", text: `duration_ms must be between 1 and ${MAX_SLEEP_DURATION_MS}` }],
        isError: true,
      };
    }

    const started = Date.now();
    await Bun.sleep(durationMs);
    const wallTimeSeconds = (Date.now() - started) / 1000;

    return {
      content: [{ type: "text", text: `Wall time: ${wallTimeSeconds.toFixed(4)} seconds\nSleep completed.` }],
    };
  },
} satisfies ToolDefinition;
