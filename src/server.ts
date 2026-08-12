import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkAuth } from "./auth.js";
import { loadTools } from "./registry.js";
import type { AppConfig, ToolDefinition, ToolResult } from "./types.js";
import { createSessionState } from "./types.js";
import { disposeExecSessions } from "./exec-sessions.js";
import { describeEnvironment, renderEnvironment } from "./tools/get-environment.js";
import { PROJECT_DOC_SEPARATOR, loadProjectDoc } from "./project-doc.js";

/**
 * Fills in the `structuredContent` the MCP spec expects from any tool that
 * advertises an `outputSchema`.
 *
 * Most tools here use the repo's `{ content: string }` schema, for which the
 * text they already return *is* the structured form — so the default is applied
 * once here instead of in every handler. Tools with a different schema shape
 * (the unified-exec pair, `clock_curr_time`) build their own and pass through.
 * Errors are left alone: an error message would not satisfy the schema, and the
 * spec exempts `isError` results from it.
 */
export function withStructuredContent(
  tool: ToolDefinition,
  result: ToolResult,
): ToolResult {
  if (!tool.outputSchema || result.structuredContent || result.isError) {
    return result;
  }
  const text = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return { ...result, structuredContent: { content: text } };
}

/**
 * The brief a client sees at initialize time.
 *
 * Codex gives its agent the same facts through an `<environment_context>`
 * message, a system prompt and the project's AGENTS.md; an MCP server has none
 * of those channels, so this is where they go. Not every client surfaces
 * `instructions`, which is why `get_environment` and `get_project_doc` exist
 * as well.
 */
export function buildInstructions(config: AppConfig): string {
  const env = describeEnvironment(config);
  const doc = loadProjectDoc(config);
  const lines = [
    "This server bridges a local project directory. Every path is relative to the working directory below, and nothing outside it can be read or written.",
    "",
    renderEnvironment(env),
    "",
    "Working notes:",
    "- Prefer apply_patch over write_file for edits to existing files: it patches in place with surrounding context instead of rewriting the whole file.",
    "- Prefer the structured tools (glob, grep, list_directory, tree, read_file) over shelling out. They behave identically on every OS, while shell commands do not.",
    "- exec_command returns a session_id instead of a result when a command outlives its yield window; drive it from there with write_stdin.",
    "- update_plan keeps a checklist across a task and is worth using for anything multi-step.",
  ];

  // Codex marks the same transition with this separator: everything past it is
  // the project's own instructions, which outrank the notes above. get_project_doc
  // returns the identical text for clients that never read `instructions`.
  if (doc) {
    lines.push(
      "- The project's own instructions follow the marker below and take precedence over these notes.",
      "",
      PROJECT_DOC_SEPARATOR,
      "",
      doc.text,
    );
  }

  return lines.join("\n");
}

function createMcpServer(
  config: AppConfig,
  tools: ToolDefinition[],
  session: ReturnType<typeof createSessionState>,
): Server {
  const server = new Server(
    { name: "codex-free", version: "0.5.0" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: buildInstructions(config),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.describe ? t.describe(config) : t.description,
      inputSchema: t.inputSchema,
      ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      } as const;
    }
    try {
      const result = await tool.handler(args ?? {}, config, session);
      console.log(`  tool: ${name} -> ok`);
      return { ...withStructuredContent(tool, result) } as const;
    } catch (err: any) {
      console.log(`  tool: ${name} -> error: ${err.message}`);
      return {
        content: [{ type: "text" as const, text: err.message ?? String(err) }],
        isError: true,
      } as const;
    }
  });

  return server;
}

// ─── HTTP server ───────────────────────────────────────────────────────

export async function startHttpServer(config: AppConfig): Promise<void> {
  const tools = loadTools();

  const sessions = new Map<
    string,
    {
      transport: WebStandardStreamableHTTPServerTransport;
      server: Server;
      state: ReturnType<typeof createSessionState>;
    }
  >();

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Accept, mcp-session-id, mcp-protocol-version, Last-Event-ID",
    "Access-Control-Expose-Headers": "mcp-session-id",
  };

  function addCorsHeaders(response: Response): Response {
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  Bun.serve({
    port: config.port,
    hostname: "0.0.0.0",
    fetch: async (request: Request) => {
      const url = new URL(request.url);
      const ts = new Date().toISOString().slice(11, 19);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const authResult = checkAuth(config.apiKey, request);
      if (authResult) return authResult;

      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify({ status: "ok", tools: tools.length }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }

      if (url.pathname === "/mcp") {
        const sessionId = request.headers.get("mcp-session-id");
        console.log(`[${ts}] ${request.method} /mcp session=${sessionId ?? "none"}`);

        if (request.method === "POST") {
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            const response = await session.transport.handleRequest(request);
            console.log(`[${ts}] -> ${response.status} (existing)`);
            return addCorsHeaders(response);
          }

          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id) => {
              console.log(`[${ts}] Session created: ${id}`);
              sessions.set(id, { transport, server: mcpServer, state });
            },
            enableJsonResponse: true,
          });
          const state = createSessionState();
          const mcpServer = createMcpServer(config, tools, state);
          await mcpServer.connect(transport);

          transport.onclose = () => {
            if (transport.sessionId) {
              console.log(`[${ts}] Session closed: ${transport.sessionId}`);
              sessions.delete(transport.sessionId);
            }
            // Kill any exec_command processes still resident for this session
            // so a disconnecting client cannot leave orphaned shells behind.
            disposeExecSessions(state);
          };

          const response = await transport.handleRequest(request);
          console.log(`[${ts}] -> ${response.status} (new)`);
          return addCorsHeaders(response);
        }

        if (request.method === "GET") {
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            const response = await session.transport.handleRequest(request);
            return addCorsHeaders(response);
          }
          return new Response("Session not found", {
            status: 404,
            headers: corsHeaders,
          });
        }

        if (request.method === "DELETE") {
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            const response = await session.transport.handleRequest(request);
            sessions.delete(sessionId);
            return addCorsHeaders(response);
          }
          return new Response("Session not found", {
            status: 404,
            headers: corsHeaders,
          });
        }
      }

      return new Response("Not found", { status: 404, headers: corsHeaders });
    },
  });

  console.log(`\nCodex Free MCP Bridge running on http://localhost:${config.port}`);
  console.log(`Work directory: ${config.workDir}`);
  console.log(
    `Tools loaded (${tools.length}): ${tools.map((t) => t.name).join(", ")}`,
  );
  if (config.apiKey) {
    console.log(`Auth: enabled (bearer token)`);
  } else {
    console.log(`Auth: disabled (no --api-key)`);
  }
  console.log(`\nAdd to ChatGPT > Plugins > New Plugin:`);
  console.log(`  Server URL: https://<your-tunnel>/mcp\n`);
}
