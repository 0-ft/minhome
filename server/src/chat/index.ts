import { Hono } from "hono";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage, validateUIMessages, createIdGenerator } from "ai";
import { buildSystemPrompt } from "./context.js";
import { createTools, type ToolContext } from "../tools.js";
import { createAutomationTools } from "../automation-tools.js";
import { openai, modelId, buildAiTools } from "./ai.js";
import { debugLog } from "../debug-log.js";

// ── Chat route ────────────────────────────────────────────

export function createChatRoute(ctx: ToolContext) {
  const chat = new Hono();
  const { bridge, config, chats, todos, automations, voiceDevices } = ctx;

  chat.get("/api/chat/info", (c) => {
    return c.json({
      model: modelId,
      available: !!process.env.AI_API_KEY,
    });
  });

  chat.get("/api/chat/debug", (c) => {
    const system = buildSystemPrompt(bridge, config, todos, automations, voiceDevices);
    const tools = buildAiTools(ctx);

    return c.json({
      systemPromptChars: system.length,
      toolCount: Object.keys(tools).length,
      tools: tools,
      systemPrompt: system,
    });
  });

  chat.get("/api/chats", (c) => {
    return c.json(chats.list());
  });

  chat.get("/api/chats/:id", (c) => {
    const id = c.req.param("id");
    const chatEntry = chats.get(id);
    if (!chatEntry) return c.json({ error: "Chat not found" }, 404);
    return c.json(chatEntry);
  });

  chat.post("/api/chats", async (c) => {
    const body = await c.req.json<{
      id?: string;
      title?: string;
      source?: "text" | "voice";
      messages?: UIMessage[];
    }>().catch(() => undefined);

    const created = chats.create({
      id: body?.id,
      title: body?.title,
      source: body?.source ?? "text",
      messages: body?.messages ?? [],
    });
    return c.json(created, 201);
  });

  chat.patch("/api/chats/:id", async (c) => {
    const id = c.req.param("id");
    const existing = chats.get(id);
    if (!existing) return c.json({ error: "Chat not found" }, 404);
    const body = await c.req.json<{ title?: string }>().catch(() => undefined);
    const updated = chats.setTitle(id, body?.title);
    return c.json(updated);
  });

  chat.delete("/api/chats/:id", (c) => {
    const id = c.req.param("id");
    const removed = chats.delete(id);
    if (!removed) return c.json({ error: "Chat not found" }, 404);
    return c.json({ ok: true });
  });

  chat.post("/api/chat", async (c) => {
    if (!process.env.AI_API_KEY) {
      return c.json({ error: "AI chat not configured (AI_API_KEY not set)" }, 503);
    }

    const body = await c.req.json<{ id?: string; messages: UIMessage[] }>();
    const requestedChatId = body.id;
    const title = extractFirstUserText(body.messages);
    const resolvedChat = requestedChatId
      ? chats.ensure({ id: requestedChatId, source: "text", title })
      : chats.create({ source: "text", title });
    const chatId = resolvedChat.id;
    const messages = body.messages;
    const rawTools = buildAiTools(ctx);
    const validatedMessages = await validateUIMessages({
      messages,
      tools: rawTools as any,
    });

    const system = buildSystemPrompt(bridge, config, todos, automations, voiceDevices);
    const modelMessages = await convertToModelMessages(validatedMessages);

    // // Wrap tools to intercept tool calls and results
    // const instrumentedTools = Object.fromEntries(
    //   Object.entries(rawTools).map(([name, tool]) => [
    //     name,
    //     {
    //       ...tool,
    //       execute: async (params: unknown) => {
    //         debugLog.add("chat_tool_call", `Tool: ${name}`, { tool: name, params });
    //         const result = await (tool as any).execute(params);
    //         debugLog.add("chat_tool_result", `Tool result: ${name}`, { tool: name, result: tryParse(result) });
    //         return result;
    //       },
    //     },
    //   ]),
    // );

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
      tools: rawTools,
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

    result.consumeStream();

    return result.toUIMessageStreamResponse({
      originalMessages: validatedMessages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      headers: {
        "x-chat-id": chatId,
      },
      onFinish: ({ messages: finishedMessages }) => {
        chats.upsertHistory({
          id: chatId,
          source: "text",
          title,
          messages: finishedMessages,
        });
      },
    });
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

function extractFirstUserText(messages: UIMessage[]): string | undefined {
  const firstUser = messages.find((msg) => msg.role === "user");
  if (!firstUser) return undefined;
  const text = extractText(firstUser).trim();
  return text && text !== "(non-text)" ? truncate(text, 80) : undefined;
}

function tryParse(s: unknown): unknown {
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return s; }
}
