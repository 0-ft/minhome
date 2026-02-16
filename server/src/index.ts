import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { createMqttBridge } from "./mqtt.js";
import { ConfigStore } from "./config/config.js";
import { TokenStore } from "./config/tokens.js";
import { AutomationEngine } from "./automations.js";
import { createTools } from "./tools.js";
import { createMcpRoute } from "./mcp.js";
import { debugLog } from "./debug-log.js";
import { resolve } from "path";
import { existsSync } from "fs";

const PORT = parseInt(process.env.PORT ?? "3111", 10);
const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) throw new Error("DATA_DIR environment variable is required");

const configPath = resolve(DATA_DIR, "config.json");
const tokensPath = resolve(DATA_DIR, "tokens.json");
const automationsPath = resolve(DATA_DIR, "automations.json");
const debugLogPath = resolve(DATA_DIR, "debug.jsonl");

console.log(`[server] MQTT_URL=${MQTT_URL}`);
console.log(`[server] Config: ${configPath}`);
console.log(`[server] Automations: ${automationsPath}`);

// Load config first so we can read debugLogMaxSizeMB
const config = new ConfigStore(configPath);
const tokens = new TokenStore(tokensPath);

// Initialise file-backed debug log before anything else uses it
debugLog.init(debugLogPath, config.get().debugLogMaxSizeMB);

const bridge = createMqttBridge(MQTT_URL);
const automationEngine = new AutomationEngine(automationsPath, bridge, {
  onFire: (id, trigger) => {
    console.log(`[auto] ${id} fired by ${trigger}`);
    debugLog.add("automation_fired", `Automation ${id} fired by ${trigger}`, { id, trigger });
  },
  executeTool: async (name, params): Promise<unknown> => {
    const tools = createTools();
    const tool = tools[name];
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const parsed = tool.parameters.parse(params);
    return tool.execute(parsed, toolCtx);
  },
});

const { app, injectWebSocket, toolCtx } = createApp(bridge, config, automationEngine, tokens);

// Mount in-process MCP server at /mcp (for Cursor IDE remote MCP)
app.route("/", createMcpRoute({ bridge, config, automations: automationEngine }));

// Auto-populate entity configs when Z2M device list arrives
bridge.on("devices", (devices: unknown) => {
  if (Array.isArray(devices)) {
    config.autoPopulateEntities(devices);
  }
});

// Serve frontend: proxy to Vite dev server in dev, otherwise serve static build
const frontendDist = resolve(import.meta.dirname, "../../frontend/dist");
const viteDevUrl = process.env.VITE_DEV_URL;

function shouldBypassFrontend(path: string): boolean {
  return (
    path.startsWith("/api/") ||
    path.startsWith("/ws") ||
    path.startsWith("/audio/") ||
    path.startsWith("/display/") ||
    path === "/mcp"
  );
}

function isSpaNavigationRequest(request: Request): boolean {
  const reqUrl = new URL(request.url);
  return (
    request.method === "GET" &&
    !reqUrl.pathname.includes(".") &&
    (request.headers.get("accept")?.includes("text/html") ?? false)
  );
}

if (viteDevUrl) {
  console.log(`[server] Dev frontend proxy -> ${viteDevUrl}`);
  // Frontend handling is mounted last so API/WS/display routes keep precedence.
  app.all("*", async (c, next) => {
    if (shouldBypassFrontend(c.req.path)) {
      return next();
    }
    try {
      const reqUrl = new URL(c.req.url);
      const isSpaNavigation = isSpaNavigationRequest(c.req.raw);
      const proxyPath = isSpaNavigation ? "/index.html" : reqUrl.pathname + reqUrl.search;
      const target = new URL(proxyPath, viteDevUrl);
      const resp = await fetch(target.toString(), {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : c.req.raw.body,
      });
      return new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      });
    } catch {
      return next();
    }
  });
} else if (existsSync(frontendDist)) {
  console.log(`[server] Serving frontend from ${frontendDist}`);
  const serveFrontendStatic = serveStatic({ root: frontendDist });
  const serveFrontendIndex = serveStatic({ root: frontendDist, path: "index.html" });

  // Frontend handling is mounted last so API/WS/display routes keep precedence.
  app.use("*", async (c, next) => {
    if (shouldBypassFrontend(c.req.path)) return next();
    return serveFrontendStatic(c, next);
  });

  // SPA fallback: index for non-backend paths that were not static assets.
  app.get("*", async (c, next) => {
    if (shouldBypassFrontend(c.req.path)) return next();
    return serveFrontendIndex(c, next);
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

if (process.env.OPENAI_API_KEY) {
  console.log("[server] OpenAI Realtime voice enabled");
} else {
  console.log("[server] OPENAI_API_KEY not set — Realtime voice disabled");
}

console.log("[server] MCP endpoint available at /mcp");

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[server] Shutting down...");
  automationEngine.destroy();
  await bridge.destroy();
  process.exit(0);
});
