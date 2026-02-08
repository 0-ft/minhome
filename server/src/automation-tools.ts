import { z } from "zod";
import { AutomationSchema } from "./automations.js";
import type { ToolDef } from "./tools.js";

/** Automation-management tools (separated to break circular dependency with automations.ts) */
export function createAutomationTools(): Record<string, ToolDef> {
  return {
    list_automations: {
      description: "List all automation rules",
      parameters: z.object({}),
      execute: async (_params, { automations }) => {
        return automations.getAll();
      },
    },

    create_automation: {
      description: "Create a new automation rule",
      parameters: AutomationSchema,
      execute: async (automation, { automations }) => {
        return automations.create(automation);
      },
    },

    update_automation: {
      description: "Update an existing automation rule. Provide the automation ID and any fields to change.",
      parameters: z.object({
        id: z.string().describe("ID of the automation to update"),
        ...AutomationSchema.omit({ id: true }).partial().shape,
      }),
      execute: async ({ id, ...patch }, { automations }) => {
        return automations.update(id, patch);
      },
    },

    delete_automation: {
      description: "Delete an automation rule",
      parameters: z.object({
        id: z.string().describe("Automation ID"),
      }),
      execute: async ({ id }, { automations }) => {
        automations.remove(id);
        return { ok: true };
      },
    },
  };
}
