import { parseArgs } from "util";
import { resolve, isAbsolute } from "path";
import type { AppConfig, CliArgs } from "./types.js";

const DEFAULTS: Omit<AppConfig, "workDir"> = {
  port: 3000,
  allowedCommands: ["bun", "npm", "npx", "node", "git", "python", "pip", "cargo", "make"],
  tree: { defaultDepth: 3, ignore: ["node_modules", ".git", "dist", ".next", "__pycache__"] },
  command: { defaultTimeout: 30000, maxTimeout: 120000 },
  exec: {
    mode: "allowlist",
    // Read-only utilities that make shell pipelines usable under allowlist mode
    // without widening what `run_command` will execute.
    extraAllowedCommands: [
      "ls", "cat", "grep", "find", "head", "tail", "wc", "echo", "pwd",
      "which", "rg", "sed", "awk", "sort", "uniq", "diff", "true", "false",
    ],
    maxSessions: 8,
  },
};

export function parseCli(): CliArgs {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "work-dir": { type: "string" },
      port: { type: "string" },
      "api-key": { type: "string" },
      config: { type: "string" },
    },
    strict: true,
  });

  const workDirRaw = values["work-dir"];
  if (!workDirRaw) {
    console.error("Error: --work-dir is required");
    process.exit(1);
  }

  return {
    workDir: isAbsolute(workDirRaw) ? workDirRaw : resolve(process.cwd(), workDirRaw),
    port: values.port ? Number(values.port) : undefined,
    apiKey: values["api-key"],
    configPath: values.config,
  };
}

export async function loadConfig(cli: CliArgs): Promise<AppConfig> {
  const configPath = cli.configPath ?? resolve(import.meta.dir, "..", "codex.config.json");

  let fileConfig: Partial<AppConfig> = {};
  const configFile = Bun.file(configPath);
  if (await configFile.exists()) {
    fileConfig = await configFile.json();
  }

  // Validate work-dir exists
  const { statSync } = await import("fs");
  try {
    const s = statSync(cli.workDir);
    if (!s.isDirectory()) {
      console.error(`Error: work-dir is not a directory: ${cli.workDir}`);
      process.exit(1);
    }
  } catch {
    console.error(`Error: work-dir does not exist: ${cli.workDir}`);
    process.exit(1);
  }

  return {
    workDir: cli.workDir,
    apiKey: cli.apiKey ?? fileConfig.apiKey,
    port: cli.port ?? fileConfig.port ?? DEFAULTS.port,
    allowedCommands: fileConfig.allowedCommands ?? DEFAULTS.allowedCommands,
    tree: { ...DEFAULTS.tree, ...fileConfig.tree },
    command: { ...DEFAULTS.command, ...fileConfig.command },
    exec: { ...DEFAULTS.exec, ...fileConfig.exec },
  };
}
