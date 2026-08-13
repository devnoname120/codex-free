import {
  SKILL_FILENAME,
  discoverSkills,
  skillsEnabled,
} from "../skills.js";
import type { SkillCatalog, SkillScope } from "../skills.js";
import type { ToolDefinition } from "../types.js";

/**
 * Codex's `skills.list`. It puts the same catalogue in the prompt at session
 * start; this server does too (see `buildInstructions`), and offers the tool for
 * a client that ignores instructions or for a conversation that outlives the
 * catalogue it started with.
 */

export interface SkillSummary {
  name: string;
  description: string;
  scope: SkillScope;
  path: string;
}

export function renderSkillList(catalog: SkillCatalog, enabled: boolean): string {
  if (!enabled) {
    return "Skills are disabled by the server configuration. Nothing was searched.";
  }

  const lines: string[] = [];

  if (catalog.skills.length === 0) {
    lines.push(
      `No skills found. A skill is a directory holding a ${SKILL_FILENAME} whose frontmatter carries a name and a description.`,
      "",
      "Searched:",
      ...catalog.roots.map((root) => `- ${root.path} (${root.scope})`),
    );
  } else {
    const count = catalog.skills.length;
    lines.push(
      `${count} skill${count === 1 ? "" : "s"} available. Read one with skills_read before acting on it — the description says when a skill applies, the body says what to do.`,
      "",
    );
    for (const skill of catalog.skills) {
      lines.push(`- ${skill.name} (${skill.scope}) — ${skill.description}`);
      lines.push(`  ${skill.path}`);
    }
  }

  if (catalog.warnings.length > 0) {
    lines.push("", "Not offered:");
    for (const warning of catalog.warnings) lines.push(`- ${warning.path}: ${warning.message}`);
  }

  return lines.join("\n");
}

export default {
  name: "skills_list",
  description: `List the skills available for this project. A skill is a set of instructions stored in a ${SKILL_FILENAME}, covering a task the user or the repository has already worked out how to do well. Skills are found under .agents/skills and .codex/skills, in the project and in the user's home directory. Each entry gives a name and a description of when it applies; call skills_read with the name to get the instructions themselves. If the user names a skill, or the task clearly matches one of these descriptions, use it.`,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      skills: {
        type: "array",
        description: "The available skills, sorted by name.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name to pass to skills_read." },
            description: { type: "string", description: "When this skill applies." },
            scope: { type: "string", description: "`repo` for a skill shipped with the project, `user` for a personal one." },
            path: { type: "string", description: `Absolute path of the ${SKILL_FILENAME}.` },
          },
          required: ["name", "description", "scope", "path"],
          additionalProperties: false,
        },
      },
      content: { type: "string", description: "The same catalogue as readable text." },
    },
    required: ["skills", "content"],
    additionalProperties: false,
  },
  handler: async (_args, config) => {
    const enabled = skillsEnabled(config);
    const catalog = discoverSkills(config);
    const skills: SkillSummary[] = catalog.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      scope: skill.scope,
      path: skill.path,
    }));
    const text = renderSkillList(catalog, enabled);
    return {
      content: [{ type: "text", text }],
      structuredContent: { skills, content: text },
    };
  },
} satisfies ToolDefinition;
