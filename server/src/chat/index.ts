import { Hono } from "hono";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import type { MqttBridge } from "../mqtt.js";
import type { ConfigStore } from "../config/config.js";
import type { AutomationEngine } from "../automations.js";
import { buildSystemPrompt } from "./context.js";
import { createTools, type ToolContext } from "../tools.js";
import { openai, modelId, buildAiTools } from "./ai.js";
import { debugLog } from "../debug-log.js";

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

    // Wrap tools to intercept tool calls and results
    const rawTools = buildAiTools(ctx);
    const instrumentedTools = Object.fromEntries(
      Object.entries(rawTools).map(([name, tool]) => [
        name,
        {
          ...tool,
          execute: async (params: unknown) => {
            debugLog.add("chat_tool_call", `Tool: ${name}`, { tool: name, params });
            const result = await (tool as any).execute(params);
            debugLog.add("chat_tool_result", `Tool result: ${name}`, { tool: name, result: tryParse(result) });
            return result;
          },
        },
      ]),
    );

    // Log the chat request
    const lastUserMsg = messages.filter(m => m.role === "user").at(-1);
    debugLog.add("chat_request", `Chat: ${truncate(extractText(lastUserMsg), 120)}`, {
      model: modelId,
      messageCount: messages.length,
      lastUserMessage: lastUserMsg,
    });

    const result = streamText({
      model: openai.chat(modelId),
      system,
      messages: modelMessages,
      tools: instrumentedTools,
      stopWhen: stepCountIs(10),
      onFinish: ({ text, usage, steps }) => {
        debugLog.add("chat_response", `Response: ${truncate(text, 120)}`, {
          model: modelId,
          text: text.slice(0, 2000),
          usage,
          stepCount: steps.length,
          toolCalls: steps.flatMap(s => s.toolCalls).map(tc => ({ name: tc.toolName, args: (tc as any).args })),
        });
      },
    });

    return result.toUIMessageStreamResponse();
  });

  return chat;
}

// ── Helpers ──────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (!s) return "(empty)";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function extractText(msg: UIMessage | undefined): string {
  if (!msg) return "(no message)";
  if (Array.isArray(msg.parts)) {
    const textPart = msg.parts.find((p) => p.type === "text");
    if (textPart && "text" in textPart) return (textPart as { type: "text"; text: string }).text;
  }
  return "(non-text)";
}

function tryParse(s: unknown): unknown {
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return s; }
}
