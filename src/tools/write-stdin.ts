import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  EXEC_MAX_YIELD_MS,
  STDIN_POLL_DEFAULT_YIELD_MS,
  STDIN_POLL_MAX_YIELD_MS,
  STDIN_WRITE_DEFAULT_YIELD_MS,
  clamp,
  generateChunkId,
  truncateOutput,
  yieldOutput,
} from "../exec-sessions.js";
import type { ToolDefinition } from "../types.js";
import type { UnifiedExecOutput } from "../exec-sessions.js";
import { UNIFIED_EXEC_OUTPUT_SCHEMA, renderUnifiedExecOutput } from "./exec-command.js";

export default {
  name: "write_stdin",
  description: `Writes characters to an existing exec_command session and returns recent output. Use this to answer a prompt from an interactive command, feed input to a REPL, or simply poll a still-running process for more output.

Pass the session_id returned by exec_command. Leave chars empty to poll without writing. Include a trailing newline in chars when the process is waiting for a line of input. When the process exits, the response carries exit_code instead of session_id and the session is discarded.`,
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "number", description: "Identifier of the running exec session, as returned by exec_command." },
      chars: { type: "string", description: "Bytes to write to stdin. Defaults to empty, which polls without writing." },
      yield_time_ms: { type: "number", description: `Wait before yielding output. Non-empty writes default to ${STDIN_WRITE_DEFAULT_YIELD_MS} ms and cap at ${EXEC_MAX_YIELD_MS} ms; empty polls wait ${STDIN_POLL_DEFAULT_YIELD_MS}-${STDIN_POLL_MAX_YIELD_MS} ms by default.` },
      max_output_tokens: { type: "number", description: `Output token budget. Defaults to ${DEFAULT_MAX_OUTPUT_TOKENS} tokens; the middle of longer output is elided.` },
    },
    required: ["session_id"],
    additionalProperties: false,
  },
  outputSchema: UNIFIED_EXEC_OUTPUT_SCHEMA,
  handler: async (args, _config, session) => {
    const sessionId = args.session_id;
    if (typeof sessionId !== "number") {
      return { content: [{ type: "text", text: "session_id must be a number" }], isError: true };
    }

    const execSession = session.execSessions.get(sessionId);
    if (!execSession) {
      const live = [...session.execSessions.keys()];
      return {
        content: [{
          type: "text",
          text: `No such exec session: ${sessionId}. ` +
            (live.length > 0 ? `Live sessions: ${live.join(", ")}` : "There are no live sessions."),
        }],
        isError: true,
      };
    }

    const chars = typeof args.chars === "string" ? args.chars : "";
    const isPoll = chars === "";
    const yieldMs = isPoll
      ? clamp(
          typeof args.yield_time_ms === "number" ? args.yield_time_ms : STDIN_POLL_DEFAULT_YIELD_MS,
          STDIN_POLL_DEFAULT_YIELD_MS,
          STDIN_POLL_MAX_YIELD_MS,
        )
      : clamp(
          typeof args.yield_time_ms === "number" ? args.yield_time_ms : STDIN_WRITE_DEFAULT_YIELD_MS,
          1,
          EXEC_MAX_YIELD_MS,
        );
    const maxOutputTokens =
      typeof args.max_output_tokens === "number" && args.max_output_tokens > 0
        ? args.max_output_tokens
        : DEFAULT_MAX_OUTPUT_TOKENS;

    const started = Date.now();
    try {
      if (!isPoll) {
        if (execSession.exitCode !== null) {
          return {
            content: [{ type: "text", text: `Session ${sessionId} has already exited with code ${execSession.exitCode}; cannot write to stdin.` }],
            isError: true,
          };
        }
        const writer = execSession.proc.stdin;
        writer.write(chars);
        await writer.flush();
      }

      const { output, exited } = await yieldOutput(execSession, yieldMs);
      const { output: text, originalTokenCount } = truncateOutput(output, maxOutputTokens);

      const result: UnifiedExecOutput = {
        chunk_id: generateChunkId(),
        wall_time_seconds: (Date.now() - started) / 1000,
        output: text,
      };
      if (originalTokenCount !== undefined) result.original_token_count = originalTokenCount;

      if (exited) {
        result.exit_code = execSession.exitCode ?? undefined;
        session.execSessions.delete(sessionId);
      } else {
        result.session_id = sessionId;
      }

      return {
        content: [{ type: "text", text: renderUnifiedExecOutput(result) }],
        structuredContent: { ...result },
        isError: exited && execSession.exitCode !== 0 ? true : undefined,
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
