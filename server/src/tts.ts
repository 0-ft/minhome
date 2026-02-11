/**
 * TTS utility — generates speech audio from text using the OpenAI TTS API.
 * Used for server-initiated announcements (not part of Realtime sessions).
 */

import OpenAI from "openai";
import type { ConfigStore } from "./config/config.js";

/**
 * Generate TTS audio as a ReadableStream of WAV data.
 *
 * Requests WAV directly from OpenAI's TTS API (24kHz 16-bit mono).
 * The Voice PE device's media player decodes and resamples natively.
 */
export async function generateTTS(
  text: string,
  config: ConfigStore,
  opts?: { voice?: string; instructions?: string },
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const voice = opts?.voice ?? config.getVoice();
  const model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";

  console.log(`[tts] Generating speech: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}" (voice=${voice}, model=${model})`);

  const client = new OpenAI({ apiKey });

  const response = await client.audio.speech.create({
    model,
    voice,
    input: text,
    response_format: "wav",
    ...(opts?.instructions ? { instructions: opts.instructions } : {}),
  });

  const rawBody = response.body;
  if (!rawBody) {
    throw new Error("TTS response has no body");
  }

  // Pass through the WAV stream directly — no resampling needed
  return rawBody as unknown as ReadableStream<Uint8Array>;
}
