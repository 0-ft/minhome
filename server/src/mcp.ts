#!/usr/bin/env tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { hc } from "hono/client";
import type { AppType } from "./app.js";

const BASE_URL = process.env.MINHOME_URL ?? "http://localhost:3111";
const api = hc<AppType>(BASE_URL);

const server = new McpServer({
  name: "minhome",
  version: "0.1.0",
});

// --- Tools ---

server.tool("list_devices", "List all Zigbee devices with their current state", {}, async () => {
  const res = await api.api.devices.$get();
  const devices = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(devices, null, 2) }] };
});

server.tool(
  "get_device",
  "Get detailed info and state for a single device",
  { id: z.string().describe("Device IEEE address, e.g. 0xa4c138d2b1cf1389") },
  async ({ id }) => {
    const res = await api.api.devices[":id"].$get({ param: { id } });
    const device = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(device, null, 2) }] };
  },
);

server.tool(
  "control_device",
  'Send a command to a device (e.g. turn on/off, set brightness, change color)',
  {
    id: z.string().describe("Device IEEE address"),
    payload: z.string().describe('JSON payload, e.g. {"state":"ON","brightness":200}'),
  },
  async ({ id, payload }) => {
    const parsed = JSON.parse(payload);
    const res = await api.api.devices[":id"].set.$post({ param: { id }, json: parsed });
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
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool("list_automations", "List all automation rules", {}, async () => {
  const res = await api.api.automations.$get();
  const automations = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(automations, null, 2) }] };
});

server.tool(
  "create_automation",
  "Create a new automation rule",
  { automation: z.string().describe("Full automation JSON object") },
  async ({ automation }) => {
    const parsed = JSON.parse(automation);
    const res = await api.api.automations.$post({ json: parsed });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

server.tool(
  "update_automation",
  "Update an existing automation rule",
  {
    id: z.string().describe("Automation ID"),
    patch: z.string().describe("JSON patch object with fields to update"),
  },
  async ({ id, patch }) => {
    const parsed = JSON.parse(patch);
    const res = await api.api.automations[":id"].$put({ param: { id }, json: parsed });
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

