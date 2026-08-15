import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";
import { resolveSafePath } from "../safe-path.js";
import { buildIgnore, isIgnored, shouldPrune } from "../ignore.js";
import type { AppConfig, ToolDefinition } from "../types.js";

export default {
  name: "grep",
  description: "Search file contents across the project using a regex pattern. Returns matching lines with file paths and line numbers (e.g. 'src/app.ts:42:const server = ...'). Recursively searches all text files, skipping binary files and common directories (node_modules, .git, dist). Use this to find function definitions, usages, error messages, or any text across the codebase.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "Subdirectory to search in. Default: work-dir root" },
      include: { type: "string", description: "Only search files matching this glob (e.g. *.ts)" },
      context: { type: "number", description: "Number of context lines before and after each match" },
      ignoreCase: { type: "boolean", description: "Case-insensitive search. Default: false" },
      maxResults: { type: "number", description: "Max number of matching lines to return. Default: 500" },
      filesOnly: { type: "boolean", description: "Only return file paths that contain matches, not the matching lines" },
    },
    required: ["pattern"],
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Grep results as 'file:line:match' lines with optional context, or file paths if filesOnly is true" },
    },
  },
  handler: async (args, config) => {
    const searchPath = args.path
      ? resolveSafePath(args.path as string, config.workDir)
      : config.workDir;

    const contextLines = typeof args.context === "number" ? args.context : 0;
    const includePattern = args.include as string | undefined;
    const ignoreCase = args.ignoreCase === true;
    const maxResults = typeof args.maxResults === "number" ? args.maxResults : 500;
    const filesOnly = args.filesOnly === true;

    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern as string, ignoreCase ? "i" : undefined);
    } catch {
      return { content: [{ type: "text", text: `Invalid regex: ${args.pattern}` }], isError: true };
    }

    try {
      const files = await collectFiles(searchPath, includePattern, config);
      const results: string[] = [];
      let matchCount = 0;
      let truncated = false;

      for (const filePath of files) {
        if (truncated) break;

        let content: string;
        try {
          content = await readFile(filePath, "utf-8");
        } catch {
          continue;
        }

        const lines = content.split("\n");
        const relPath = relative(config.workDir, filePath).replaceAll("\\", "/");

        if (filesOnly) {
          for (const line of lines) {
            if (regex.test(line)) {
              results.push(relPath);
              matchCount++;
              if (matchCount >= maxResults) { truncated = true; }
              break;
            }
          }
          continue;
        }

        const matchIndices = new Set<number>();

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matchCount++;
            if (matchCount > maxResults) { truncated = true; break; }
            for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) {
              matchIndices.add(j);
            }
          }
        }

        if (matchIndices.size === 0) continue;

        const sorted = [...matchIndices].sort((a, b) => a - b);
        let prevIdx = -2;
        for (const idx of sorted) {
          if (contextLines > 0 && idx - prevIdx > 1 && prevIdx >= 0) {
            results.push("--");
          }
          const marker = regex.test(lines[idx]) ? ":" : "-";
          results.push(`${relPath}:${idx + 1}${marker}${lines[idx]}`);
          prevIdx = idx;
        }
      }

      if (results.length === 0) {
        return { content: [{ type: "text", text: "No matches found." }] };
      }

      let output = results.join("\n");
      if (truncated) {
        output += `\n\n(truncated at ${maxResults} matches)`;
      }

      return { content: [{ type: "text", text: output }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz", ".br", ".7z",
  ".exe", ".dll", ".so", ".dylib",
  ".pdf", ".doc", ".docx",
  ".mp3", ".mp4", ".avi", ".mov",
  ".wasm", ".o", ".a", ".lib",
]);

async function collectFiles(dir: string, includeGlob: string | undefined, config: AppConfig): Promise<string[]> {
  const files: string[] = [];
  const extMatch = includeGlob?.startsWith("*.") ? includeGlob.slice(1) : undefined;
  const ig = buildIgnore(config);

  async function walk(current: string) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldPrune(ig, entry.name, abs, config.workDir)) {
          await walk(abs);
        }
      } else {
        const name = entry.name;
        const ext = name.lastIndexOf(".") >= 0 ? name.slice(name.lastIndexOf(".")) : "";
        if (BINARY_EXTENSIONS.has(ext)) continue;
        if (extMatch && ext !== extMatch) continue;
        if (isIgnored(ig, abs, config.workDir)) continue;
        files.push(abs);
      }
    }
  }

  await walk(dir);
  return files;
}
