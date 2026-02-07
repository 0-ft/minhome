import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { createMqttBridge } from "./mqtt.js";
import { ConfigStore } from "./config.js";
import { AutomationEngine } from "./automations.js";
import { resolve, join } from "path";
import { existsSync } from "fs";

const PORT = parseInt(process.env.PORT ?? "3111", 10);
const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const DATA_DIR = process.env.DATA_DIR ?? resolve(import.meta.dirname, "../..");

const configPath = resolve(DATA_DIR, "config.json");
const automationsPath = resolve(DATA_DIR, "automations.json");

console.log(`[server] MQTT_URL=${MQTT_URL}`);
console.log(`[server] Config: ${configPath}`);
console.log(`[server] Automations: ${automationsPath}`);

const bridge = createMqttBridge(MQTT_URL);
const config = new ConfigStore(configPath);
const automationEngine = new AutomationEngine(automationsPath, bridge, {
  onFire: (id, trigger) => console.log(`[auto] ${id} fired by ${trigger}`),
});

const { app, injectWebSocket } = createApp(bridge, config, automationEngine);

// Serve frontend static files in production
const frontendDist = resolve(import.meta.dirname, "../../frontend/dist");
if (existsSync(frontendDist)) {
  console.log(`[server] Serving frontend from ${frontendDist}`);
  app.use("/*", serveStatic({ root: frontendDist }));
  // SPA fallback: serve index.html for non-API routes
  app.get("*", serveStatic({ root: frontendDist, path: "index.html" }));
}

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[server] Listening on http://localhost:${info.port}`);
});

injectWebSocket(server);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[server] Shutting down...");
  automationEngine.destroy();
  await bridge.destroy();
  process.exit(0);
});

