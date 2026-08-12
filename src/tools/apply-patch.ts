import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { applyUpdate, parsePatch, renderAddedFile, PatchParseError } from "../apply-patch.js";
import type { PatchAction } from "../apply-patch.js";
import { resolveSafePath } from "../safe-path.js";
import type { ToolDefinition } from "../types.js";

const GRAMMAR = `*** Begin Patch
[ one or more hunks ]
*** End Patch

Hunks:
*** Add File: <path>
+<line>            (every line of the new file, each prefixed with '+')

*** Delete File: <path>

*** Update File: <path>
*** Move to: <new path>   (optional — renames the file)
@@ <optional context line, e.g. a function or class signature>
 <unchanged line>
-<removed line>
+<added line>
*** End of File           (optional — anchors the chunk to the file's end)`;

/** Every write the patch will perform, resolved before anything touches disk. */
interface PlannedWrite {
  action: PatchAction;
  absPath: string;
  destPath?: string;
  contents?: string;
}

async function planAction(action: PatchAction, workDir: string): Promise<PlannedWrite> {
  const absPath = resolveSafePath(action.path, workDir);
  const file = Bun.file(absPath);

  switch (action.type) {
    case "add": {
      if (await file.exists()) {
        throw new Error(`Add File: '${action.path}' already exists`);
      }
      return { action, absPath, contents: renderAddedFile(action.lines) };
    }
    case "delete": {
      if (!(await file.exists())) {
        throw new Error(`Delete File: '${action.path}' does not exist`);
      }
      return { action, absPath };
    }
    case "update": {
      if (!(await file.exists())) {
        throw new Error(`Update File: '${action.path}' does not exist`);
      }
      const original = await file.text();
      const contents = applyUpdate(original, action.chunks, action.path);
      const destPath = action.movePath ? resolveSafePath(action.movePath, workDir) : undefined;
      return { action, absPath, destPath, contents };
    }
  }
}

export default {
  name: "apply_patch",
  description: `Edit files with a patch. This is the preferred way to make code changes: it edits in place with surrounding context instead of rewriting whole files, so it is far cheaper than write_file and will not silently clobber concurrent edits.

The patch is passed as the "input" string in this exact format:

${GRAMMAR}

Paths are relative to the project root (work-dir). Context lines must match the file; if they don't, the patch is rejected and nothing is written. Multiple hunks across multiple files are applied atomically — either all succeed or none do.`,
  inputSchema: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "The full patch text, starting with '*** Begin Patch' and ending with '*** End Patch'",
      },
    },
    required: ["input"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "Summary of the files added, updated, deleted or moved" },
    },
  },
  handler: async (args, config) => {
    const input = args.input;
    if (typeof input !== "string") {
      return { content: [{ type: "text", text: "input must be a string containing the patch text" }], isError: true };
    }

    let planned: PlannedWrite[];
    try {
      const actions = parsePatch(input);
      // Resolve every hunk first. A patch that fails on its third file must not
      // have written the first two.
      planned = [];
      for (const action of actions) {
        planned.push(await planAction(action, config.workDir));
      }
    } catch (err: any) {
      const prefix = err instanceof PatchParseError ? "Invalid patch" : "Patch does not apply";
      return { content: [{ type: "text", text: `${prefix}: ${err.message}` }], isError: true };
    }

    const summary: string[] = [];
    try {
      for (const write of planned) {
        const { action, absPath, destPath, contents } = write;
        switch (action.type) {
          case "add":
            await mkdir(dirname(absPath), { recursive: true });
            await Bun.write(absPath, contents!);
            summary.push(`A ${action.path}`);
            break;
          case "delete":
            await rm(absPath);
            summary.push(`D ${action.path}`);
            break;
          case "update":
            if (destPath && destPath !== absPath) {
              await mkdir(dirname(destPath), { recursive: true });
              await Bun.write(destPath, contents!);
              await rm(absPath);
              summary.push(`R ${action.path} -> ${action.movePath}`);
            } else {
              await Bun.write(absPath, contents!);
              summary.push(`M ${action.path}`);
            }
            break;
        }
      }
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Patch partially applied then failed: ${err.message}\nApplied so far:\n${summary.join("\n")}` }],
        isError: true,
      };
    }

    return { content: [{ type: "text", text: `Patch applied:\n${summary.join("\n")}` }] };
  },
} satisfies ToolDefinition;
