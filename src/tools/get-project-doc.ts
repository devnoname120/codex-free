import { DEFAULT_FILENAME, loadProjectDoc } from "../project-doc.js";
import type { ProjectDoc } from "../project-doc.js";
import type { ToolDefinition } from "../types.js";

/**
 * Codex loads AGENTS.md into the prompt before the first turn. The server does
 * the same through its `instructions`, but a client that ignores those would
 * otherwise never see the repo's conventions — hence this tool.
 */

export interface ProjectDocFile {
  path: string;
  truncated: boolean;
}

export function renderProjectDoc(doc: ProjectDoc | null): string {
  if (!doc) {
    return `No ${DEFAULT_FILENAME} found between the project root and the working directory. The project states no conventions of its own; follow the ones already in the conversation.`;
  }
  const header = doc.entries
    .map((entry) => `${entry.path}${entry.truncated ? " (truncated at the byte budget)" : ""}`)
    .join("\n");
  return `Project instructions from:\n${header}\n\n${doc.text}`;
}

export default {
  name: "get_project_doc",
  description: `Read the project's ${DEFAULT_FILENAME} instructions: the conventions, build and test commands, and house rules this repository expects an agent to follow. Codex loads these automatically before every task, so treat them as the user's own instructions — they outrank general habits and this server's other guidance. Call this once before starting work if the instructions are not already in the conversation. Returns every ${DEFAULT_FILENAME} from the project root down to the working directory, concatenated outermost first.`,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        description: "Absolute paths of the docs that were read, in the order they appear in content.",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path of the doc." },
            truncated: { type: "boolean", description: "True when the byte budget cut this file short." },
          },
          required: ["path", "truncated"],
          additionalProperties: false,
        },
      },
      content: {
        type: "string",
        description: `Concatenated ${DEFAULT_FILENAME} text, empty when the project has none.`,
      },
    },
    required: ["files", "content"],
    additionalProperties: false,
  },
  handler: async (_args, config) => {
    const doc = loadProjectDoc(config);
    const files: ProjectDocFile[] = (doc?.entries ?? []).map((entry) => ({
      path: entry.path,
      truncated: entry.truncated,
    }));
    return {
      content: [{ type: "text", text: renderProjectDoc(doc) }],
      structuredContent: { files, content: doc?.text ?? "" },
    };
  },
} satisfies ToolDefinition;
