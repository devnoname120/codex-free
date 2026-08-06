import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkAuth } from "./auth.js";
import { loadTools } from "./registry.js";
import type { AppConfig, ToolDefinition } from "./types.js";

function createMcpServer(config: AppConfig, tools: ToolDefinition[]): Server {
  const server = new Server(
    { name: "codex-free", version: "0.2.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

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
        console.log(
          `[${ts}] ${request.method} ${url.pathname}`,
        );

        if (request.method === "POST") {
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          const mcpServer = createMcpServer(config, tools);
          await mcpServer.connect(transport);

          const response = await transport.handleRequest(request);
          console.log(`[${ts}] -> ${response.status}`);
          return addCorsHeaders(response);
        }

        if (request.method === "GET") {
          return new Response("SSE not supported in stateless mode", {
            status: 405,
            headers: corsHeaders,
          });
        }

        if (request.method === "DELETE") {
          return new Response(null, { status: 200, headers: corsHeaders });
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
