#!/usr/bin/env tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { hc } from "hono/client";
import type { AppType } from "./app.js";
import { AutomationSchema } from "./automations.js";

const BASE_URL = process.env.MINHOME_URL ?? "http://localhost:3111";
const api = hc<AppType>(BASE_URL);

const server = new McpServer({
  name: "minhome",
  version: "0.1.0",
});

// ── Helpers ──────────────────────────────────────────────

/** Check response status and throw with a descriptive message on failure. */
async function assertOk(res: Response, action: string): Promise<void> {
  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.json();
      detail = typeof body === "object" && body !== null && "error" in body
        ? String((body as Record<string, unknown>).error)
        : JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => res.statusText);
    }
    throw new Error(`${action} failed (${res.status}): ${detail}`);
  }
}

// --- Tools ---

server.tool("list_devices", "List all Zigbee devices with their current state", {}, async () => {
  const res = await api.api.devices.$get();
  await assertOk(res, "list_devices");
  const devices = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(devices, null, 2) }] };
});

server.tool(
  "get_device",
  "Get detailed info and state for a single device",
  { id: z.string().describe("Device IEEE address, e.g. 0xa4c138d2b1cf1389") },
  async ({ id }) => {
    const res = await api.api.devices[":id"].$get({ param: { id } });
    await assertOk(res, `get_device(${id})`);
    const device = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(device, null, 2) }] };
  },
);

server.tool(
  "control_device",
  'Send a command to a device (e.g. turn on/off, set brightness, change color)',
  {
    id: z.string().describe("Device IEEE address"),
    payload: z.record(z.string(), z.unknown()).describe('Command payload, e.g. {"state":"ON","brightness":200}'),
  },
  async ({ id, payload }) => {
    const res = await api.api.devices[":id"].set.$post({ param: { id }, json: payload });
    await assertOk(res, `control_device(${id})`);
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool(
  "rename_device",
  "Set a friendly display name for a device",
  {
    id: z.string().describe("Device IEEE address"),
    name: z.string().describe("New display name"),
  },
  async ({ id, name }) => {
    const res = await api.api.devices[":id"].config.$put({ param: { id }, json: { name } });
    await assertOk(res, `rename_device(${id})`);
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool(
  "rename_entity",
  "Set a friendly display name for a specific entity/endpoint within a device (e.g. one socket of a multi-socket smart plug)",
  {
    id: z.string().describe("Device IEEE address"),
    entity_id: z.string().describe("Entity/endpoint identifier, e.g. 'l1', 'l2', 'l3'"),
    name: z.string().describe("New display name for the entity"),
  },
  async ({ id, entity_id, name }) => {
    const res = await api.api.devices[":id"].config.$put({
      param: { id },
      json: { entities: { [entity_id]: name } },
    });
    await assertOk(res, `rename_entity(${id}/${entity_id})`);
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool("list_automations", "List all automation rules", {}, async () => {
  const res = await api.api.automations.$get();
  await assertOk(res, "list_automations");
  const automations = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(automations, null, 2) }] };
});

server.tool(
  "create_automation",
  "Create a new automation rule",
  AutomationSchema.shape,
  async (automation) => {
    const res = await api.api.automations.$post({ json: automation });
    await assertOk(res, "create_automation");
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

server.tool(
  "update_automation",
  "Update an existing automation rule. Provide the automation ID and any fields to change.",
  {
    id: z.string().describe("ID of the automation to update"),
    ...AutomationSchema.omit({ id: true }).partial().shape,
  },
  async ({ id, ...patch }) => {
    const res = await api.api.automations[":id"].$put({ param: { id }, json: patch });
    await assertOk(res, `update_automation(${id})`);
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

server.tool(
  "delete_automation",
  "Delete an automation rule",
  { id: z.string().describe("Automation ID") },
  async ({ id }) => {
    const res = await api.api.automations[":id"].$delete({ param: { id } });
    await assertOk(res, `delete_automation(${id})`);
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] Minhome MCP server running on stdio");
}

main().catch((err) => {
  console.error("[mcp] Fatal:", err);
  process.exit(1);
});

