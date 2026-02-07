#!/usr/bin/env tsx
import { Command } from "commander";
import { hc } from "hono/client";
import type { AppType } from "@minhome/server/app";

const BASE_URL = process.env.MINHOME_URL ?? "http://localhost:3111";
const api = hc<AppType>(BASE_URL);

const program = new Command()
  .name("minhome")
  .description("Minhome smart room CLI")
  .version("0.1.0");

// ── device ──────────────────────────────────────────────

const device = program
  .command("device")
  .description("Manage Zigbee devices");

device
  .command("list")
  .description("List all devices")
  .action(async () => {
    const res = await api.api.devices.$get();
    const devices = await res.json();
    if (!Array.isArray(devices) || devices.length === 0) {
      console.log("No devices found.");
      return;
    }
    for (const d of devices) {
      const online = d.state && Object.keys(d.state).length > 0 ? "●" : "○";
      console.log(`${online}  ${d.name}  (${d.id})`);
      if (d.vendor || d.model) console.log(`   ${d.vendor ?? ""} ${d.model ?? ""}`);
      const ents = d.entities ?? {};
      if (Object.keys(ents).length > 0) {
        for (const [eid, label] of Object.entries(ents)) {
          console.log(`   └─ ${eid} → ${label}`);
        }
      }
    }
  });

device
  .command("get <id>")
  .description("Show device details and state")
  .action(async (id: string) => {
    const res = await api.api.devices[":id"].$get({ param: { id } });
    if (!res.ok) { console.error("Device not found"); process.exit(1); }
    const d = await res.json();
    console.log(`${d.name}  (${d.id})`);
    console.log(`  Type  : ${d.type}`);
    console.log(`  Model : ${d.vendor ?? "?"} ${d.model ?? "?"}`);
    console.log(`  State :`);
    for (const [k, v] of Object.entries(d.state)) {
      console.log(`    ${k}: ${JSON.stringify(v)}`);
    }
    const ents = d.entities ?? {};
    if (Object.keys(ents).length > 0) {
      console.log(`  Entities:`);
      for (const [eid, label] of Object.entries(ents)) {
        console.log(`    ${eid} → ${label}`);
      }
    }
  });

device
  .command("rename <id> <name>")
  .description("Set a friendly name for a device")
  .action(async (id: string, name: string) => {
    const res = await api.api.devices[":id"].config.$put({ param: { id }, json: { name } });
    console.log(res.ok ? `Renamed → '${name}'` : "Error");
  });

device
  .command("set <id> <payload>")
  .description('Send command, e.g. device set 0x1234 \'{"state":"ON"}\'')
  .action(async (id: string, payloadStr: string) => {
    const payload = JSON.parse(payloadStr);
    const res = await api.api.devices[":id"].set.$post({ param: { id }, json: payload });
    const body = await res.json();
    console.log(res.ok ? "OK" : `Error: ${JSON.stringify(body)}`);
  });

// ── entity ──────────────────────────────────────────────

const entity = program
  .command("entity")
  .description("Manage entities (endpoints within a device)");

entity
  .command("list <device_id>")
  .description("List entities of a device")
  .action(async (deviceId: string) => {
    const res = await api.api.devices[":id"].$get({ param: { id: deviceId } });
    if (!res.ok) { console.error("Device not found"); process.exit(1); }
    const d = await res.json();
    console.log(`Entities for ${d.name}  (${d.id}):`);

    // Gather endpoint names from exposes
    const exposes = (d.exposes ?? []) as { type: string; endpoint?: string; features?: unknown[] }[];
    const endpoints = exposes
      .filter(e => e.endpoint)
      .map(e => e.endpoint as string);

    if (endpoints.length === 0) {
      console.log("  (no multi-endpoint entities)");
      return;
    }

    const ents = d.entities ?? {};
    for (const ep of endpoints) {
      const label = ents[ep];
      console.log(`  ${ep}${label ? ` → ${label}` : ""}`);
    }
  });

entity
  .command("rename <device_id> <entity_id> <name>")
  .description("Set a friendly name for an entity endpoint")
  .action(async (deviceId: string, entityId: string, name: string) => {
    const res = await api.api.devices[":id"].config.$put({
      param: { id: deviceId },
      json: { entities: { [entityId]: name } },
    });
    console.log(res.ok ? `Entity '${entityId}' renamed → '${name}'` : "Error");
  });

// ── automation ──────────────────────────────────────────

const automation = program
  .command("automation")
  .description("Manage automations");

automation
  .command("list")
  .description("List all automations")
  .action(async () => {
    const res = await api.api.automations.$get();
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) {
      console.log("No automations configured.");
      return;
    }
    for (const a of list) {
      const status = a.enabled ? "✓" : "✗";
      console.log(`[${status}] ${a.name}  (${a.id})`);
      console.log(`    Triggers: ${a.triggers.map((t: { type: string }) => t.type).join(", ")}`);
      console.log(`    Actions : ${a.actions.map((t: { type: string }) => t.type).join(", ")}`);
    }
  });

automation
  .command("get <id>")
  .description("Show automation details")
  .action(async (id: string) => {
    const res = await api.api.automations[":id"].$get({ param: { id } });
    if (!res.ok) { console.error("Automation not found"); process.exit(1); }
    const a = await res.json();
    console.log(JSON.stringify(a, null, 2));
  });

automation
  .command("create <json>")
  .description("Create an automation from JSON")
  .action(async (json: string) => {
    const parsed = JSON.parse(json);
    const res = await api.api.automations.$post({ json: parsed });
    const body = await res.json();
    if (res.ok) {
      console.log(`Created: ${"id" in body ? body.id : ""}`);
    } else {
      console.error("Error:", JSON.stringify(body));
    }
  });

automation
  .command("update <id> <json>")
  .description("Update an automation")
  .action(async (id: string, json: string) => {
    const parsed = JSON.parse(json);
    const res = await api.api.automations[":id"].$put({ param: { id }, json: parsed });
    console.log(res.ok ? "Updated" : "Error");
  });

automation
  .command("delete <id>")
  .description("Delete an automation")
  .action(async (id: string) => {
    const res = await api.api.automations[":id"].$delete({ param: { id } });
    console.log(res.ok ? "Deleted" : "Error");
  });

// ── parse ───────────────────────────────────────────────

program.parse();
