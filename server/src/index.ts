import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { createMqttBridge } from "./mqtt.js";
import { ConfigStore } from "./config/config.js";
import { AutomationEngine } from "./automations.js";
import { createMcpRoute } from "./mcp.js";
import { resolve } from "path";
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

const voiceOutputDir = resolve(DATA_DIR, "voice-recordings");
const { app, injectWebSocket } = createApp(bridge, config, automationEngine, { voiceOutputDir });

// Mount in-process MCP server at /mcp (for Cursor IDE remote MCP)
app.route("/", createMcpRoute({ bridge, config, automations: automationEngine }));

// Auto-populate entity configs when Z2M device list arrives
bridge.on("devices", (devices: unknown) => {
  if (Array.isArray(devices)) {
    config.autoPopulateEntities(devices);
  }
});

// Serve frontend static files in production
const frontendDist = resolve(import.meta.dirname, "../../frontend/dist");
if (existsSync(frontendDist)) {
  console.log(`[server] Serving frontend from ${frontendDist}`);
  app.use("/*", serveStatic({ root: frontendDist }));
  // SPA fallback: serve index.html for non-API, non-WS, non-MCP routes
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/ws") || c.req.path === "/mcp") return next();
    return serveStatic({ root: frontendDist, path: "index.html" })(c, next);
  });
}

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[server] Listening on http://localhost:${info.port}`);
});

injectWebSocket(server);

if (process.env.AI_API_KEY) {
  console.log(`[server] AI chat enabled (model: ${process.env.AI_MODEL ?? "gpt-4o"})`);
} else {
  console.log("[server] AI_API_KEY not set — AI chat disabled");
}

console.log("[server] MCP endpoint available at /mcp");

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[server] Shutting down...");
  automationEngine.destroy();
  await bridge.destroy();
  process.exit(0);
});
