import { Hono } from "hono";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { MqttBridge } from "../mqtt.js";
import type { ConfigStore } from "../config/config.js";
import type { AutomationEngine } from "../automations.js";
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

export function createChatRoute(bridge: MqttBridge, config: ConfigStore, automations: AutomationEngine) {
  const chat = new Hono();

  chat.get("/api/chat/info", (c) => {
    return c.json({
      model: modelId,
      available: !!mcpClient && !!process.env.AI_API_KEY,
    });
  });

  chat.get("/api/chat/debug", async (c) => {
    const system = buildSystemPrompt(bridge, config, automations);
    const rawTools = mcpClient ? await mcpClient.tools() : {};

    // Extract tool definitions with their JSON schemas (stored in inputSchema)
    const toolDefs = Object.fromEntries(
      Object.entries(rawTools).map(([name, tool]) => {
        const t = tool as Record<string, unknown>;
        return [name, {
          description: t.description,
          inputSchema: t.inputSchema,
        }];
      }),
    );

    const toolsJson = JSON.stringify(toolDefs, null, 2);

    return c.json({
      systemPromptChars: system.length,
      toolDefinitionsChars: toolsJson.length,
      totalChars: system.length + toolsJson.length,
      toolCount: Object.keys(toolDefs).length,
      toolSizes: Object.fromEntries(
        Object.entries(toolDefs).map(([name, def]) => [name, JSON.stringify(def).length]),
      ),
      systemPrompt: system,
      toolDefinitions: toolDefs,
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

    const rawTools = await mcpClient.tools();
    const system = buildSystemPrompt(bridge, config, automations);
    const modelMessages = await convertToModelMessages(messages);

    // Wrap tool execute functions to surface MCP `isError` as thrown errors.
    // The @ai-sdk/mcp adapter returns MCP results (including isError: true)
    // without throwing, so the AI SDK treats them as successes. Wrapping
    // ensures the AI SDK creates proper tool-error parts for the frontend.
    const tools = Object.fromEntries(
      Object.entries(rawTools).map(([name, tool]) => {
        if (!tool.execute) return [name, tool];
        const origExecute = tool.execute.bind(tool);
        return [name, {
          ...tool,
          execute: async (...args: Parameters<typeof origExecute>) => {
            const result = await origExecute(...args);
            if (result && typeof result === "object" && "isError" in result && (result as Record<string, unknown>).isError) {
              // Extract error text from MCP content array
              const content = (result as Record<string, unknown>).content;
              let errorMsg = "Tool execution failed";
              if (Array.isArray(content)) {
                const texts = content
                  .filter((p: unknown) => p && typeof p === "object" && (p as Record<string, unknown>).type === "text")
                  .map((p: unknown) => (p as Record<string, string>).text);
                if (texts.length > 0) errorMsg = texts.join("\n");
              }
              throw new Error(errorMsg);
            }
            return result;
          },
        }];
      }),
    );

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

