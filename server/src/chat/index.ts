import { Hono } from "hono";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import type { MqttBridge } from "../mqtt.js";
import type { ConfigStore } from "../config/config.js";
import type { AutomationEngine } from "../automations.js";
import { buildSystemPrompt } from "./context.js";
import { createTools, type ToolContext } from "../tools.js";
import { openai, modelId, buildAiTools } from "./ai.js";

// ── Chat route ────────────────────────────────────────────

export function createChatRoute(bridge: MqttBridge, config: ConfigStore, automations: AutomationEngine) {
  const chat = new Hono();
  const ctx: ToolContext = { bridge, config, automations };

  chat.get("/api/chat/info", (c) => {
    return c.json({
      model: modelId,
      available: !!process.env.AI_API_KEY,
    });
  });

  chat.get("/api/chat/debug", (c) => {
    const system = buildSystemPrompt(bridge, config, automations);
    const defs = createTools();

    const toolDefs = Object.fromEntries(
      Object.entries(defs).map(([name, def]) => [name, { description: def.description }]),
    );

    return c.json({
      systemPromptChars: system.length,
      toolCount: Object.keys(toolDefs).length,
      tools: toolDefs,
      systemPrompt: system,
    });
  });

  chat.post("/api/chat", async (c) => {
    if (!process.env.AI_API_KEY) {
      return c.json({ error: "AI chat not configured (AI_API_KEY not set)" }, 503);
    }

    const body = await c.req.json<{ messages: UIMessage[] }>();
    const { messages } = body;

    const system = buildSystemPrompt(bridge, config, automations);
    const modelMessages = await convertToModelMessages(messages);
    const tools = buildAiTools(ctx);

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
