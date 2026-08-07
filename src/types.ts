export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  handler: (args: Record<string, unknown>, config: AppConfig) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface AppConfig {
  workDir: string;
  apiKey?: string;
  port: number;
  allowedCommands: string[];
  tree: { defaultDepth: number; ignore: string[] };
  command: { defaultTimeout: number; maxTimeout: number };
}

export interface CliArgs {
  workDir: string;
  port?: number;
  apiKey?: string;
  configPath?: string;
}
