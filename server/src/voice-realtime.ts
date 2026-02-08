/**
 * OpenAI Realtime session manager — manages a single voice command session
 * using the OpenAI Realtime WebSocket API for speech-to-speech interaction.
 *
 * Responsibilities:
 *   - Opens an OpenAI Realtime WS per voice command
 *   - Feeds incoming 24kHz PCM audio to OpenAI (base64-encoded)
 *   - Receives audio output, resamples 24kHz→48kHz, streams as WAV via ReadableStream
 *   - Handles tool calls using existing tool infrastructure
 *   - Emits control events (speechStopped, ttsStart, voiceDone) for the bridge
 */

import { OpenAIRealtimeWebSocket } from "openai/realtime/websocket";
import { z } from "zod";
import { createTools, type ToolContext } from "./tools.js";
import { createAutomationTools } from "./automation-tools.js";
import { buildSystemPrompt } from "./chat/context.js";
import { debugLog } from "./debug-log.js";

// ── Audio constants ──────────────────────────────────────────

const OPENAI_SAMPLE_RATE = 24000;
const OUTPUT_SAMPLE_RATE = 48000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

// ── WAV header for streaming ─────────────────────────────────

function createStreamingWavHeader(): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const enc = new TextEncoder();

  // RIFF header
  const riff = enc.encode("RIFF");
  new Uint8Array(header, 0, 4).set(riff);
  view.setUint32(4, 0x7fffffff, true); // large file size for streaming
  const wave = enc.encode("WAVE");
  new Uint8Array(header, 8, 4).set(wave);

  // fmt sub-chunk
  const fmt = enc.encode("fmt ");
  new Uint8Array(header, 12, 4).set(fmt);
  view.setUint32(16, 16, true); // sub-chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, OUTPUT_SAMPLE_RATE, true);
  view.setUint32(28, OUTPUT_SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // data sub-chunk
  const data = enc.encode("data");
  new Uint8Array(header, 36, 4).set(data);
  view.setUint32(40, 0x7fffffff, true); // large data size for streaming

  return new Uint8Array(header);
}

// ── Resample 24kHz → 48kHz (2× linear interpolation) ────────

function resample24to48(pcm24: Buffer): Uint8Array {
  const sampleCount = pcm24.length / 2; // 16-bit samples
  const output = new ArrayBuffer(sampleCount * 4); // 2× samples, 2 bytes each
  const out = new DataView(output);

  for (let i = 0; i < sampleCount; i++) {
    const sample = pcm24.readInt16LE(i * 2);
    const nextSample = i + 1 < sampleCount ? pcm24.readInt16LE((i + 1) * 2) : sample;
    out.setInt16(i * 4, sample, true);
    out.setInt16(i * 4 + 2, Math.round((sample + nextSample) / 2), true);
  }

  return new Uint8Array(output);
}

// ── Convert Zod tool defs → OpenAI Realtime tool format ──────

function buildRealtimeTools(ctx: ToolContext) {
  const defs = { ...createTools(), ...createAutomationTools() };
  return {
    tools: Object.entries(defs).map(([name, def]) => ({
      type: "function" as const,
      name,
      description: def.description,
      parameters: z.toJSONSchema(def.parameters),
    })),
    executeTool: async (name: string, argsJson: string): Promise<string> => {
      const def = defs[name];
      if (!def) return JSON.stringify({ error: `Unknown tool: ${name}` });
      try {
        const args = JSON.parse(argsJson);
        const result = await def.execute(args, ctx);
        return JSON.stringify(result);
      } catch (err) {
        console.error(`[realtime] Tool ${name} error:`, err);
        return JSON.stringify({ error: String(err) });
      }
    },
  };
}

// ── Realtime session callbacks ───────────────────────────────

export interface RealtimeCallbacks {
  /** OpenAI detected end of user speech */
  onSpeechStopped: () => void;
  /** First audio chunk ready — bridge should send TTS URL to device */
  onTtsStart: (audioPath: string) => void;
  /** Session complete — bridge should send RUN_END */
  onVoiceDone: () => void;
  /** Error occurred */
  onError: (err: Error) => void;
}

// ── RealtimeSession ──────────────────────────────────────────

export class RealtimeSession {
  readonly sessionId: string;
  readonly audioStream: ReadableStream<Uint8Array>;

  private rt: OpenAIRealtimeWebSocket | null = null;
  private audioController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private headerSent = false;
  private closed = false;
  private connected = false;
  private pendingAudio: Buffer[] = [];
  private callbacks: RealtimeCallbacks;
  private toolCtx: ToolContext;

  constructor(
    sessionId: string,
    callbacks: RealtimeCallbacks,
    toolCtx: ToolContext,
  ) {
    this.sessionId = sessionId;
    this.callbacks = callbacks;
    this.toolCtx = toolCtx;

    // Create the ReadableStream that the HTTP endpoint will serve
    this.audioStream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.audioController = controller;
      },
      cancel: () => {
        console.log(`[realtime] Audio stream cancelled for ${sessionId}`);
        this.close();
      },
    });
  }

  /** Open the OpenAI Realtime WebSocket and configure the session. */
  async open(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not set");
    }

    const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
    console.log(`[realtime] Opening session ${this.sessionId} (model: ${model})`);
    debugLog.add("voice_session_start", `Voice session: ${this.sessionId}`, { sessionId: this.sessionId, model });

    this.rt = new OpenAIRealtimeWebSocket(
      { model },
      { apiKey, baseURL: "https://api.openai.com/v1" },
    );

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Realtime WS connection timeout")), 10_000);
      this.rt!.socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.rt!.socket.addEventListener("error", (e) => {
        clearTimeout(timeout);
        reject(new Error(`Realtime WS error: ${e}`));
      });
    });

    this.configureSession();
    this.bindEvents();
  }

  /** Feed incoming 24kHz PCM audio from the bridge. */
  feedAudio(pcm24: Buffer): void {
    if (this.closed) return;
    if (!this.connected || !this.rt) {
      // Buffer audio until OpenAI WS is connected
      this.pendingAudio.push(pcm24);
      return;
    }
    try {
      const base64 = pcm24.toString("base64");
      this.rt.send({
        type: "input_audio_buffer.append",
        audio: base64,
      });
    } catch (err) {
      console.error("[realtime] Error sending audio:", err);
    }
  }

  /** Flush any audio that was buffered while connecting. */
  private flushPendingAudio(): void {
    if (!this.rt || !this.connected) return;
    const pending = this.pendingAudio;
    this.pendingAudio = [];
    console.log(`[realtime] Flushing ${pending.length} buffered audio chunks`);
    for (const chunk of pending) {
      this.feedAudio(chunk);
    }
  }

  /** Close the session and clean up. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    console.log(`[realtime] Closing session ${this.sessionId}`);

    try { this.audioController?.close(); } catch { /* already closed */ }
    try { this.rt?.close(); } catch { /* ignore */ }
    this.rt = null;
  }

  // ── Private ──────────────────────────────────────────────

  private configureSession(): void {
    if (!this.rt) return;

    const system = buildSystemPrompt(
      this.toolCtx.bridge,
      this.toolCtx.config,
      this.toolCtx.automations,
    );

    // Strip inline reference instructions — the Realtime API outputs audio, not text with XML tags
    const voiceSystem = system.replace(/Inline references:[\s\S]*$/, "").trim()
      + "\n\nYou are responding via voice. Be concise. Do not use markdown or XML tags.";

    const { tools } = buildRealtimeTools(this.toolCtx);

    this.rt.send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: voiceSystem,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: "gpt-4o-mini-transcribe",
            },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "medium",
            },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            voice: this.toolCtx.config.getVoice(),
          },
        },
        tools,
        tool_choice: "auto",
      },
    });
  }

  private bindEvents(): void {
    if (!this.rt) return;

    // Session lifecycle
    this.rt.on("session.created", () => {
      console.log(`[realtime] Session created`);
    });
    this.rt.on("session.updated", () => {
      console.log(`[realtime] Session configured — ready for audio`);
      this.connected = true;
      this.flushPendingAudio();
    });

    // VAD — speech detection
    this.rt.on("input_audio_buffer.speech_started", (e) => {
      console.log(`[realtime] Speech started at ${e.audio_start_ms}ms`);
    });
    this.rt.on("input_audio_buffer.speech_stopped", (e) => {
      console.log(`[realtime] Speech stopped at ${e.audio_end_ms}ms`);
      debugLog.add("voice_speech", `Speech stopped at ${e.audio_end_ms}ms`, { sessionId: this.sessionId, audioEndMs: e.audio_end_ms });
      this.callbacks.onSpeechStopped();
    });

    // Input transcription
    this.rt.on("conversation.item.input_audio_transcription.completed" as any, (e: any) => {
      console.log(`[realtime] User said: "${e.transcript}"`);
      debugLog.add("voice_transcript", `User: "${e.transcript}"`, { sessionId: this.sessionId, role: "user", transcript: e.transcript });
    });

    // Audio output
    this.rt.on("response.output_audio.delta", (e) => {
      this.handleAudioDelta(e.delta);
    });
    this.rt.on("response.output_audio_transcript.delta", (e) => {
      // Log streaming transcript
      if (e.delta) process.stdout.write(e.delta);
    });
    this.rt.on("response.output_audio_transcript.done", (e) => {
      if (e.transcript) {
        console.log(`\n[realtime] Response transcript: "${e.transcript}"`);
        debugLog.add("voice_transcript", `Assistant: "${e.transcript}"`, { sessionId: this.sessionId, role: "assistant", transcript: e.transcript });
      }
    });

    // Response completion (tool calls or final)
    this.rt.on("response.done", (e) => {
      this.handleResponseDone(e);
    });

    // Errors
    this.rt.on("error", (err) => {
      console.error("[realtime] Error:", err.message);
      debugLog.add("voice_error", `Voice error: ${err.message}`, { sessionId: this.sessionId, error: err.message });
      this.callbacks.onError(new Error(err.message));
    });

    this.rt.socket.addEventListener("close", () => {
      console.log(`[realtime] WebSocket closed`);
      if (!this.closed) {
        this.finalize();
      }
    });
  }

  private handleAudioDelta(base64Delta: string): void {
    if (this.closed || !this.audioController) return;

    const pcm24 = Buffer.from(base64Delta, "base64");
    const pcm48 = resample24to48(pcm24);

    try {
      if (!this.headerSent) {
        this.headerSent = true;
        // Send WAV header first
        this.audioController.enqueue(createStreamingWavHeader());
        // Notify bridge to send TTS URL to device
        this.callbacks.onTtsStart(`/audio/${this.sessionId}`);
        console.log(`[realtime] Started audio stream for ${this.sessionId}`);
      }
      this.audioController.enqueue(pcm48);
    } catch (err) {
      console.error("[realtime] Error writing audio:", err);
    }
  }

  private async handleResponseDone(e: any): Promise<void> {
    const response = e.response;
    if (!response?.output) return;

    // Check for function calls
    const functionCalls = response.output.filter(
      (item: any) => item.type === "function_call",
    );

    if (functionCalls.length > 0) {
      console.log(`[realtime] ${functionCalls.length} tool call(s)`);
      const { executeTool } = buildRealtimeTools(this.toolCtx);

      for (const call of functionCalls) {
        console.log(`[realtime] Calling tool: ${call.name}(${call.arguments})`);
        debugLog.add("voice_tool_call", `Voice tool: ${call.name}`, { sessionId: this.sessionId, tool: call.name, args: tryParseJSON(call.arguments) });
        const result = await executeTool(call.name, call.arguments);
        console.log(`[realtime] Tool result [${call.name}]: ${result}`);
        debugLog.add("voice_tool_result", `Voice tool result: ${call.name}`, { sessionId: this.sessionId, tool: call.name, result: tryParseJSON(result) });

        // Send tool result back to OpenAI
        this.rt?.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: result,
          } as any,
        });
      }

      // Trigger the model to continue (generate audio response)
      this.rt?.send({ type: "response.create" });
      return;
    }

    // No tool calls — this is a final audio response, finalize
    console.log(`[realtime] Response complete (finish: ${response.status})`);
    this.finalize();
  }

  private finalize(): void {
    if (this.closed) return;

    // Close the audio stream
    try { this.audioController?.close(); } catch { /* already closed */ }

    console.log(`[realtime] Session ${this.sessionId} finalized`);
    debugLog.add("voice_session_end", `Voice session ended: ${this.sessionId}`, { sessionId: this.sessionId });
    this.callbacks.onVoiceDone();
    this.close();
  }
}

// ── Helpers ──────────────────────────────────────────────

function tryParseJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
