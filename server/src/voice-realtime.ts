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
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { UIMessage } from "ai";
import { createTools, type ToolContext } from "./tools.js";
import { createAutomationTools } from "./automation-tools.js";
import { buildSystemPrompt } from "./chat/context.js";
import { debugLog } from "./debug-log.js";
import { createStreamingWavHeader, resample24to48 } from "./audio-utils.js";
import { VoiceAudioCapture } from "./voice-audio-capture.js";

interface PersistedToolPart {
  type: `tool-${string}`;
  toolCallId: string;
  state: "output-available" | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
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
        const args = def.parameters.parse(JSON.parse(argsJson));
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
  /** Error occurred — code is a short identifier for the device (e.g. "rate-limit") */
  onError: (err: Error, code?: string) => void;
}

// ── RealtimeSession ──────────────────────────────────────────

export class RealtimeSession {
  readonly sessionId: string;
  readonly chatId: string;
  readonly deviceId: string;
  readonly audioStream: ReadableStream<Uint8Array>;

  private rt: OpenAIRealtimeWebSocket | null = null;
  private audioController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private headerSent = false;
  private closed = false;
  private connected = false;
  private pendingAudio: Buffer[] = [];
  private callbacks: RealtimeCallbacks;
  private toolCtx: ToolContext;
  private audioCapture: VoiceAudioCapture | null = null;
  private audioCaptureFlushed = false;
  private lastAudioTime = 0;
  private audioSilenceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    sessionId: string,
    chatId: string,
    deviceId: string,
    callbacks: RealtimeCallbacks,
    toolCtx: ToolContext,
  ) {
    this.sessionId = sessionId;
    this.chatId = chatId;
    this.deviceId = deviceId;
    this.callbacks = callbacks;
    this.toolCtx = toolCtx;
    if (this.toolCtx.config.getVoiceDebugCaptureEnabled()) {
      this.audioCapture = new VoiceAudioCapture({
        captureDir: this.toolCtx.config.getVoiceDebugCaptureDir(),
        sessionId: this.sessionId,
        deviceId: this.deviceId,
        sampleRate: 24_000,
      });
      debugLog.add("voice_audio", `Capture enabled for ${this.sessionId}`, {
        sessionId: this.sessionId,
        chatId: this.chatId,
        deviceId: this.deviceId,
        captureDir: this.toolCtx.config.getVoiceDebugCaptureDir(),
        partialPath: this.audioCapture.getPartialPath(),
      });
    }

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
    this.lastAudioTime = Date.now();
    if (!this.connected || !this.rt) {
      // Buffer audio until OpenAI WS is connected — capture happens on flush
      this.pendingAudio.push(pcm24);
      return;
    }
    this.audioCapture?.appendPcmChunk(pcm24);
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
    if (this.audioSilenceTimer) {
      clearInterval(this.audioSilenceTimer);
      this.audioSilenceTimer = null;
    }
    this.flushAudioCapture("close");

    try { this.audioController?.close(); } catch { /* already closed */ }
    try { this.rt?.close(); } catch { /* ignore */ }
    this.rt = null;
  }

  // ── Private ──────────────────────────────────────────────

  private startAudioSilenceMonitor(): void {
    this.audioSilenceTimer = setInterval(() => {
      if (this.closed || !this.lastAudioTime) return;
      const silenceMs = Date.now() - this.lastAudioTime;
      if (silenceMs >= 3000) {
        console.log(`[realtime] No audio received for ${(silenceMs / 1000).toFixed(1)}s — input may have stopped`);
      }
    }, 3000);
  }

  private configureSession(): void {
    if (!this.rt) return;

    const system = buildSystemPrompt(
      this.toolCtx.bridge,
      this.toolCtx.config,
      this.toolCtx.todos,
      this.toolCtx.automations,
      this.toolCtx.voiceDevices,
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

    // Log ALL events from OpenAI for diagnostics
    this.rt.on("event", (event: any) => {
      const type = event?.type ?? "unknown";
      // Skip high-volume audio delta events
      if (type === "response.output_audio.delta" || type === "response.output_audio_transcript.delta") return;
      const preview = JSON.stringify(event).substring(0, 300);
      console.log(`[realtime:event] ${type} ${preview}`);
    });

    // Session lifecycle
    this.rt.on("session.created", () => {
      console.log(`[realtime] Session created`);
    });
    this.rt.on("session.updated", (e: any) => {
      // Log the turn detection config that OpenAI actually accepted
      const td = e?.session?.audio?.input?.turn_detection
        ?? e?.session?.turn_detection
        ?? "NOT_FOUND";
      console.log(`[realtime] Session configured — turn_detection: ${JSON.stringify(td)}`);
      console.log(`[realtime] Ready for audio`);
      this.connected = true;
      this.flushPendingAudio();
      this.startAudioSilenceMonitor();
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
      const transcript = typeof e.transcript === "string" ? e.transcript.trim() : "";
      if (transcript) {
        this.appendChatMessage({
          role: "user",
          parts: [{ type: "text", text: transcript }],
        });
      }
    });
    this.rt.on("conversation.item.input_audio_transcription.failed" as any, (e: any) => {
      const errMsg = e?.error?.message ?? "unknown transcription error";
      const errCode = e?.error?.code ?? "unknown";
      console.error(`[realtime] Transcription failed (${errCode}): ${errMsg}`);
      debugLog.add("voice_error", `Transcription failed: ${errMsg}`, {
        sessionId: this.sessionId,
        errorCode: errCode,
        errorType: e?.error?.type,
      });
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
        const transcript = e.transcript.trim();
        if (transcript) {
          this.appendChatMessage({
            role: "assistant",
            parts: [{ type: "text", text: transcript }],
          });
        }
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
      const code = (err as any).error?.code ?? "realtime-error";
      this.callbacks.onError(new Error(err.message), code);
      this.close();
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
    if (!response) return;

    // Check for failed response (rate limit, quota, etc.)
    if (response.status === "failed") {
      const detail = response.status_details?.error;
      const errCode = detail?.code ?? "unknown";
      const errMsg = detail?.message ?? "Response failed";
      const errType = detail?.type ?? "unknown";
      console.error(`[realtime] Response FAILED (${errCode}): ${errMsg}`);
      debugLog.add("voice_error", `Response failed: ${errMsg}`, {
        sessionId: this.sessionId,
        errorCode: errCode,
        errorType: errType,
        responseId: response.id,
      });
      this.callbacks.onError(new Error(`OpenAI response failed (${errCode}): ${errMsg}`), errCode);
      this.close();
      return;
    }

    // Cancelled response (e.g. user interrupted) — don't finalize, wait for next response
    if (response.status === "cancelled") {
      console.log(`[realtime] Response cancelled (likely user interruption)`);
      return;
    }

    if (!response.output) return;

    // Check for function calls
    const functionCalls = response.output.filter(
      (item: any) => item.type === "function_call",
    );

    if (functionCalls.length > 0) {
      console.log(`[realtime] ${functionCalls.length} tool call(s)`);
      const { executeTool } = buildRealtimeTools(this.toolCtx);
      const toolParts: PersistedToolPart[] = [];

      for (const call of functionCalls) {
        console.log(`[realtime] Calling tool: ${call.name}(${call.arguments})`);
        const parsedInput = tryParseJSON(call.arguments);
        debugLog.add("voice_tool_call", `Voice tool: ${call.name}`, {
          sessionId: this.sessionId,
          tool: call.name,
          args: parsedInput,
        });
        const result = await executeTool(call.name, call.arguments);
        console.log(`[realtime] Tool result [${call.name}]: ${result}`);
        const parsedOutput = tryParseJSON(result);
        debugLog.add("voice_tool_result", `Voice tool result: ${call.name}`, {
          sessionId: this.sessionId,
          tool: call.name,
          result: parsedOutput,
        });

        const errorText = extractToolError(parsedOutput);
        toolParts.push(buildToolPart({
          toolName: call.name,
          toolCallId: call.call_id,
          input: parsedInput,
          output: parsedOutput,
          errorText,
        }));

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

      if (toolParts.length > 0) {
        this.appendChatMessage({
          role: "assistant",
          parts: toolParts as unknown as UIMessage["parts"],
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
    this.flushAudioCapture("finalize");

    console.log(`[realtime] Session ${this.sessionId} finalized`);
    debugLog.add("voice_session_end", `Voice session ended: ${this.sessionId}`, { sessionId: this.sessionId });
    this.callbacks.onVoiceDone();
    this.close();
  }

  private appendChatMessage(message: Pick<UIMessage, "role" | "parts">): void {
    this.toolCtx.chats.appendMessage({
      id: this.chatId,
      source: "voice",
      message: {
        id: `msg-${randomUUID()}`,
        role: message.role,
        parts: message.parts,
      } as UIMessage,
    });
  }

  private flushAudioCapture(reason: "close" | "finalize"): void {
    if (this.audioCaptureFlushed || !this.audioCapture) return;
    this.audioCaptureFlushed = true;
    void this.audioCapture.finalize()
      .then((info) => {
        if (!info) return;
        debugLog.add("voice_audio", `Captured voice input for ${this.sessionId}`, {
          sessionId: this.sessionId,
          chatId: this.chatId,
          deviceId: this.deviceId,
          reason,
          filePath: info.path,
          pcmBytes: info.pcmBytes,
          sampleRate: info.sampleRate,
          durationSeconds: Number(info.durationSeconds.toFixed(3)),
        });
      })
      .catch((err) => {
        console.error(`[realtime] Failed to save audio capture for ${this.sessionId}:`, err);
        debugLog.add("voice_error", `Capture save failed: ${this.sessionId}`, {
          sessionId: this.sessionId,
          chatId: this.chatId,
          deviceId: this.deviceId,
          reason,
          error: String(err),
        });
      });
  }
}

// ── Helpers ──────────────────────────────────────────────

function tryParseJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

function buildToolPart(args: {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
  errorText?: string;
}): PersistedToolPart {
  return {
    type: `tool-${args.toolName}`,
    toolCallId: args.toolCallId,
    state: args.errorText ? "output-error" : "output-available",
    input: args.input,
    output: args.output,
    ...(args.errorText ? { errorText: args.errorText } : {}),
  };
}

function extractToolError(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const candidate = (output as { error?: unknown }).error;
  return typeof candidate === "string" ? candidate : undefined;
}
