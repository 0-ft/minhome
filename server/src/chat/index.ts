import { Hono } from "hono";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { MqttBridge } from "../mqtt.js";
import type { ConfigStore } from "../config.js";
import { buildSystemPrompt } from "./context.js";
import { resolve } from "path";

// ── MCP client singleton ──────────────────────────────────

let mcpClient: MCPClient | null = null;

export async function initMCPClient(): Promise<void> {
  const mcpScript = resolve(import.meta.dirname, "../mcp.ts");
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

// ── Chat route ────────────────────────────────────────────

export function createChatRoute(bridge: MqttBridge, config: ConfigStore) {
  const chat = new Hono();

  chat.get("/api/chat/info", (c) => {
    return c.json({
      model: modelId,
      available: !!mcpClient && !!process.env.AI_API_KEY,
    });
  });

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
      model: openai.chat(modelId),
      system,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(10),
    });

    return result.toUIMessageStreamResponse();
  });

  return chat;
}

