/**
 * Voice pipeline — processes captured voice audio through the AI model.
 *
 * Two-step approach:
 *   1. Send audio to the voice model (AI_VOICE_MODEL) for transcription
 *   2. Send transcribed text to the main model (AI_MODEL) with tools
 */

import { generateText, stepCountIs } from "ai";
import { openai, modelId, voiceModelId, buildAiTools } from "./chat/ai.js";
import { buildSystemPrompt } from "./chat/context.js";
import { createWavHeader, type VoiceSession } from "./voice.js";
import type { ToolContext } from "./tools.js";

/**
 * Process a completed voice session through the AI pipeline.
 * Returns the AI's text response (for future TTS use).
 */
export async function processVoiceCommand(
  session: VoiceSession,
  ctx: ToolContext,
): Promise<string> {
  if (!process.env.AI_API_KEY) {
    console.warn("[voice-pipeline] AI_API_KEY not set — skipping voice command processing");
    return "";
  }

  const durationSecs = session.totalBytes / (16000 * 2);
  console.log(
    `[voice-pipeline] Processing voice command (~${durationSecs.toFixed(1)}s audio)`,
  );

  // Build WAV buffer in memory from session chunks
  const pcmData = Buffer.concat(session.chunks);
  const wavHeader = createWavHeader(pcmData.length);
  const wavBuffer = Buffer.concat([wavHeader, pcmData]);

  // Step 1: Transcribe audio using the voice model
  console.log(`[voice-pipeline] Transcribing with ${voiceModelId}...`);
  const transcription = await generateText({
    model: openai.chat(voiceModelId),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "file",
            mediaType: "audio/wav",
            data: wavBuffer,
          },
          {
            type: "text",
            text: "Transcribe this voice command exactly. Output only the transcription, nothing else.",
          },
        ],
      },
    ],
  });

  const transcript = transcription.text.trim();
  if (!transcript) {
    console.log("[voice-pipeline] Empty transcription — no command detected");
    return "";
  }
  console.log(`[voice-pipeline] Transcript: "${transcript}"`);

  // Step 2: Process transcribed command with the main model + tools
  console.log(`[voice-pipeline] Processing with ${modelId}...`);
  const system = buildSystemPrompt(ctx.bridge, ctx.config, ctx.automations);
  const tools = buildAiTools(ctx);

  const result = await generateText({
    model: openai.chat(modelId),
    system,
    messages: [
      {
        role: "user",
        content: transcript,
      },
    ],
    tools,
    stopWhen: stepCountIs(10),
  });

  // Log tool calls and results from all steps
  for (const [i, step] of result.steps.entries()) {
    for (const toolCall of step.toolCalls) {
      console.log(`[voice-pipeline] Step ${i + 1} tool call: ${toolCall.toolName}`, toolCall.args);
    }
    for (const toolResult of step.toolResults) {
      console.log(`[voice-pipeline] Step ${i + 1} tool result [${toolResult.toolName}]:`, toolResult.result);
    }
    if (step.text) {
      console.log(`[voice-pipeline] Step ${i + 1} text: ${step.text}`);
    }
  }

  const responseText = result.text;
  console.log(`[voice-pipeline] Response: ${responseText || "(no text — tool calls only)"}`);
  console.log(`[voice-pipeline] Total steps: ${result.steps.length}, finish: ${result.finishReason}`);

  return responseText;
}
