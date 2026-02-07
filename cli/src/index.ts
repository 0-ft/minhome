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

// --- devices ---

program
  .command("devices")
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
      console.log(`${online} ${d.name} (${d.id})`);
      if (d.vendor || d.model) console.log(`    ${d.vendor ?? ""} ${d.model ?? ""}`);
    }
  });

program
  .command("status <device>")
  .description("Show device state")
  .action(async (device: string) => {
    const res = await api.api.devices[":id"].$get({ param: { id: device } });
    if (!res.ok) {
      console.error("Device not found");
      process.exit(1);
    }
    const d = await res.json();
    console.log(`${d.name} (${d.id})`);
    console.log(`  Type  : ${d.type}`);
    console.log(`  Model : ${d.vendor ?? "?"} ${d.model ?? "?"}`);
    console.log(`  State :`);
    for (const [k, v] of Object.entries(d.state)) {
      console.log(`    ${k}: ${JSON.stringify(v)}`);
    }
  });

program
  .command("set <device> <payload>")
  .description('Send command to device, e.g. set 0x1234 \'{"state":"ON"}\'')
  .action(async (device: string, payloadStr: string) => {
    const payload = JSON.parse(payloadStr);
    const res = await api.api.devices[":id"].set.$post({
      param: { id: device },
      json: payload,
    });
    const body = await res.json();
    console.log(res.ok ? "OK" : `Error: ${JSON.stringify(body)}`);
  });

program
  .command("rename <device> <name>")
  .description("Set a friendly name for a device")
  .action(async (device: string, name: string) => {
    const res = await api.api.devices[":id"].config.$put({
      param: { id: device },
      json: { name },
    });
    console.log(res.ok ? `Renamed to '${name}'` : "Error");
  });

// --- automations ---

program
  .command("automations")
  .description("List automations")
  .action(async () => {
    const res = await api.api.automations.$get();
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) {
      console.log("No automations configured.");
      return;
    }
    for (const a of list) {
      const status = a.enabled ? "✓" : "✗";
      console.log(`[${status}] ${a.name} (${a.id})`);
      console.log(`    Triggers: ${a.triggers.map((t: { type: string }) => t.type).join(", ")}`);
    }
  });

program.parse();

