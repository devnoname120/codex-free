import { readFileSync } from "node:fs";
import { fileBudget, windowFileLines } from "../output-budget.js";
import {
  SKILL_FILENAME,
  discoverSkills,
  findSkill,
  resolveSkillResource,
  skillPackageFiles,
  skillsEnabled,
} from "../skills.js";
import type { ToolDefinition } from "../types.js";

/**
 * Codex's `skills.read`. Reads a skill's own instructions, and the reference
 * files, scripts and assets that sit beside them.
 *
 * read_file cannot do this job: skills usually live under the user's home
 * directory, outside the work directory read_file is confined to. Routing
 * package files through a named skill keeps that confinement meaningful — the
 * only paths this opens up are the ones inside a skill the project or the user
 * deliberately installed.
 */
export default {
  name: "skills_read",
  description: `Read a skill's instructions. Pass the name from skills_list and this returns its ${SKILL_FILENAME}, which is the skill's body: follow it for the rest of the task. Read it completely before acting on it, and do not delegate reading or summarising it. When the body points at another file in the package — references, scripts, assets — call this again with the same name and that file's path as 'resource'; paths in a skill are relative to the skill's own directory, not to work-dir. Long files come back a window at a time; when the result says so, call again with the offset it names.`,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name, as listed by skills_list." },
      resource: {
        type: "string",
        description: `File to read inside the skill's directory, relative to it (e.g. 'references/api.md'). Defaults to ${SKILL_FILENAME}.`,
      },
      offset: { type: "number", description: "Start reading from this line (0-based). Default: 0" },
      limit: { type: "number", description: "Maximum number of lines to return. Capped by the server's own line and byte budget." },
    },
    required: ["name"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "The file's text, with a trailing note when it was cut short." },
    },
  },
  handler: async (args, config) => {
    if (!skillsEnabled(config)) {
      return {
        content: [{ type: "text", text: "Skills are disabled by the server configuration." }],
        isError: true,
      };
    }

    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (name === "") {
      return { content: [{ type: "text", text: "A skill name is required." }], isError: true };
    }

    const catalog = discoverSkills(config);
    const skill = findSkill(catalog, name);
    if (!skill) {
      const known = catalog.skills.map((entry) => entry.name).join(", ");
      const suffix = known === "" ? "No skills are installed." : `Available: ${known}.`;
      return {
        content: [{ type: "text", text: `No skill named ${name}. ${suffix}` }],
        isError: true,
      };
    }

    const resource = typeof args.resource === "string" && args.resource.trim() !== ""
      ? args.resource.trim()
      : SKILL_FILENAME;

    let path: string;
    try {
      path = resolveSkillResource(skill, resource);
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }

    let contents: string;
    try {
      contents = readFileSync(path, "utf8");
    } catch {
      return {
        content: [{ type: "text", text: `${skill.name} has no file at ${resource}.` }],
        isError: true,
      };
    }

    const window = windowFileLines(
      contents.split("\n"),
      typeof args.offset === "number" ? args.offset : 0,
      typeof args.limit === "number" ? args.limit : undefined,
      fileBudget(config),
    );

    const parts = [`${skill.name} — ${path}`, "", window.lines.join("\n")];
    if (window.notice) parts.push("", window.notice);

    // Only alongside the body: once the model is reading a resource it already
    // knows the package layout, and repeating the list every call is noise.
    if (resource === SKILL_FILENAME && !window.notice) {
      const files = skillPackageFiles(skill);
      if (files.length > 0) {
        parts.push(
          "",
          `Other files in this skill, readable with resource=<path>: ${files.join(", ")}`,
        );
      }
    }

    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
} satisfies ToolDefinition;
