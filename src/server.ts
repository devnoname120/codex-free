import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkAuth } from "./auth.js";
import { loadTools } from "./registry.js";
import type { AppConfig, ToolDefinition } from "./types.js";

/**
 * Create a low-level MCP Server with tool handlers wired to our registry.
 *
 * We use the low-level `Server` class (not `McpServer`) because our tools
 * expose plain JSON Schema objects, whereas the high-level API expects Zod
 * schemas.
 */
function createMcpServer(config: AppConfig, tools: ToolDefinition[]): Server {
  const server = new Server(
    { name: "codex-free", version: "0.1.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

  // tools/list — return the tool catalogue
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
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
      const result = await tool.handler(args ?? {}, config);
      return { ...result } as const;
    } catch (err: any) {
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

  // Session store: session-id -> { transport, server }
  const sessions = new Map<
    string,
    { transport: WebStandardStreamableHTTPServerTransport; server: Server }
  >();

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Accept, mcp-session-id, mcp-protocol-version, Last-Event-ID",
    "Access-Control-Expose-Headers": "mcp-session-id",
  };

  /** Clone response with additional CORS headers. */
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
      // --- CORS preflight ---
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // --- Auth ---
      const authResult = checkAuth(config.apiKey, request);
      if (authResult) return authResult;

      const url = new URL(request.url);

      // --- Health check ---
      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify({ status: "ok", tools: tools.length }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }

      // --- MCP endpoint ---
      if (url.pathname === "/mcp") {
        const sessionId = request.headers.get("mcp-session-id");

        // ── POST ──────────────────────────────────────────────────
        if (request.method === "POST") {
          if (sessionId && sessions.has(sessionId)) {
            // Existing session
            const session = sessions.get(sessionId)!;
            const response = await session.transport.handleRequest(request);
            return addCorsHeaders(response);
          }

          // New session – create transport + server and connect them
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, { transport, server: mcpServer });
            },
          });
          const mcpServer = createMcpServer(config, tools);
          await mcpServer.connect(transport);

          transport.onclose = () => {
            if (transport.sessionId) {
              sessions.delete(transport.sessionId);
            }
          };

          const response = await transport.handleRequest(request);
          return addCorsHeaders(response);
        }

        // ── GET (SSE stream for server-initiated messages) ────────
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

        // ── DELETE (terminate session) ────────────────────────────
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

      // --- Fallback ---
      return new Response("Not found", { status: 404, headers: corsHeaders });
    },
  });

  // Startup banner
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
