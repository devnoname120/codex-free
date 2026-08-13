import { savePlan } from "../memory.js";
import type { PlanItem, PlanState, PlanStepStatus, ToolDefinition } from "../types.js";

const STATUSES: PlanStepStatus[] = ["pending", "in_progress", "completed"];

const MARKERS: Record<PlanStepStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
};

function parsePlan(raw: unknown): PlanItem[] {
  if (!Array.isArray(raw)) {
    throw new Error("plan must be an array of { step, status } objects");
  }

  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`plan[${index}] must be an object with "step" and "status"`);
    }
    const { step, status } = entry as Record<string, unknown>;
    if (typeof step !== "string" || step.trim() === "") {
      throw new Error(`plan[${index}].step must be a non-empty string`);
    }
    if (typeof status !== "string" || !STATUSES.includes(status as PlanStepStatus)) {
      throw new Error(`plan[${index}].status must be one of: ${STATUSES.join(", ")}`);
    }
    return { step, status: status as PlanStepStatus };
  });
}

/**
 * Codex shows the plan in its TUI. Here the tool result is the only channel back
 * to the caller, so the stored plan is rendered in full on every update.
 */
function renderPlan(plan: PlanState): string {
  const lines: string[] = [];
  if (plan.explanation) lines.push(plan.explanation, "");
  for (const item of plan.plan) {
    lines.push(`${MARKERS[item.status]} ${item.step}`);
  }
  const done = plan.plan.filter((i) => i.status === "completed").length;
  lines.push("", `${done}/${plan.plan.length} steps completed`);
  return lines.join("\n");
}

export default {
  name: "update_plan",
  description: `Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.
Use this to track multi-step work: post the full plan up front, then re-send the whole list with updated statuses as you go. The plan is echoed back on each update, and saved so that recall can hand it back in a later conversation.`,
  inputSchema: {
    type: "object",
    properties: {
      explanation: { type: "string", description: "Optional explanation for this plan update." },
      plan: {
        type: "array",
        description: "The list of steps",
        items: {
          type: "object",
          properties: {
            step: { type: "string", description: "Task step text." },
            status: { type: "string", enum: STATUSES, description: "Step status." },
          },
          required: ["step", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["plan"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "The stored plan rendered as a checklist" },
    },
  },
  handler: async (args, config, session) => {
    try {
      const plan = parsePlan(args.plan);

      const inProgress = plan.filter((item) => item.status === "in_progress");
      if (inProgress.length > 1) {
        return {
          content: [{
            type: "text",
            text: `At most one step can be in_progress at a time (got ${inProgress.length}: ${inProgress.map((i) => JSON.stringify(i.step)).join(", ")})`,
          }],
          isError: true,
        };
      }

      const explanation = typeof args.explanation === "string" ? args.explanation : undefined;
      session.plan = { explanation, plan };

      // Best effort: a plan the model can see is worth more than a plan that
      // failed to persist, so a read-only state directory must not fail the call.
      savePlan(config, session.plan);

      return { content: [{ type: "text", text: renderPlan(session.plan) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  },
} satisfies ToolDefinition;
