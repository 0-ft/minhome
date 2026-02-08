/**
 * Shared AI model configuration and tool builder.
 * Used by both the text chat route and the voice pipeline.
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { Tool } from "ai";
import { createTools, type ToolContext } from "../tools.js";

// ── Model configuration ───────────────────────────────────

export const openai = createOpenAI({
  apiKey: process.env.AI_API_KEY ?? "",
  baseURL: process.env.AI_BASE_URL, // undefined = default OpenAI
});

export const modelId = process.env.AI_MODEL ?? "gpt-4o";
export const voiceModelId = process.env.AI_VOICE_MODEL ?? modelId;

// ── Tool builder ──────────────────────────────────────────

/** Build AI SDK tools from shared definitions (direct in-process execution). */
export function buildAiTools(ctx: ToolContext): Record<string, Tool> {
  const defs = createTools();
  return Object.fromEntries(
    Object.entries(defs).map(([name, def]) => [
      name,
      {
        description: def.description,
        inputSchema: def.parameters,
        execute: async (params: any) => JSON.stringify(await def.execute(params, ctx)),
      } satisfies Tool,
    ]),
  );
}
