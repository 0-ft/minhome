import { Hono } from "hono";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { MqttBridge } from "./mqtt.js";
import type { ConfigStore } from "./config.js";
import { resolve } from "path";

// ── MCP client singleton ──────────────────────────────────

let mcpClient: MCPClient | null = null;

export async function initMCPClient(): Promise<void> {
  const mcpScript = resolve(import.meta.dirname, "mcp.ts");
  mcpClient = await createMCPClient({
    transport: new StdioMCPTransport({
      command: "tsx",
      args: [mcpScript],
      env: {
        ...process.env as Record<string, string>,
        MINHOME_URL: `http://localhost:${process.env.PORT ?? "3111"}`,
      },
    }),
    name: "minhome-chat",
  });
  console.log("[chat] MCP client connected");
}

export async function destroyMCPClient(): Promise<void> {
  await mcpClient?.close();
  mcpClient = null;
  console.log("[chat] MCP client closed");
}

// ── Model configuration ───────────────────────────────────

const openai = createOpenAI({
  apiKey: process.env.AI_API_KEY ?? "",
  baseURL: process.env.AI_BASE_URL, // undefined = default OpenAI
});

const modelId = process.env.AI_MODEL ?? "gpt-4o";

// ── System prompt builder ─────────────────────────────────

function buildSystemPrompt(bridge: MqttBridge, config: ConfigStore): string {
  const devices = [...bridge.devices.values()]
    .filter((d) => d.type !== "Coordinator")
    .map((d) => {
      const custom = config.getDevice(d.ieee_address);
      const state = bridge.states.get(d.ieee_address);
      return {
        id: d.ieee_address,
        name: custom?.name ?? d.friendly_name,
        entities: custom?.entities ?? {},
        type: d.type,
        vendor: d.definition?.vendor ?? null,
        model: d.definition?.model ?? null,
        description: d.definition?.description ?? null,
        state: state ?? {},
      };
    });

  return `You are a smart home assistant for minhome, a Zigbee-based room control system.
You can view and control smart home devices using the tools available to you.

Current devices and their state:
${JSON.stringify(devices, null, 2)}

Guidelines:
- Be concise and helpful.
- When asked to control devices, use the appropriate tool calls.
- Refer to devices by their friendly name, not their IEEE address.
- If a device has named entities (e.g. individual sockets on a multi-plug), refer to them by their entity name.
- After performing an action, briefly confirm what you did.
- If you're unsure about a device or action, ask for clarification.`;
}

// ── Chat route ────────────────────────────────────────────

export function createChatRoute(bridge: MqttBridge, config: ConfigStore) {
  const chat = new Hono();

  chat.post("/api/chat", async (c) => {
    if (!mcpClient) {
      return c.json({ error: "AI chat not available (MCP client not initialized)" }, 503);
    }

    if (!process.env.AI_API_KEY) {
      return c.json({ error: "AI chat not configured (AI_API_KEY not set)" }, 503);
    }

    const body = await c.req.json<{ messages: UIMessage[] }>();
    const { messages } = body;

    const tools = await mcpClient.tools();
    const system = buildSystemPrompt(bridge, config);
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: openai(modelId),
      system,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(10),
    });

    return result.toUIMessageStreamResponse();
  });

  return chat;
}

