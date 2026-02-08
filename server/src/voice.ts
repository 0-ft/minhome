/**
 * Voice module — handles the bridge WebSocket connection and coordinates
 * with the OpenAI Realtime session for speech-to-speech interaction.
 *
 * Protocol (bridge → server):
 *   - JSON: { type: "voice_start", conversation_id, wake_word }
 *   - Binary: raw 24kHz 16-bit PCM audio chunks (resampled by bridge from 16kHz)
 *
 * Protocol (server → bridge):
 *   - JSON: { type: "speech_stopped" }
 *   - JSON: { type: "tts_start", audio_path: "/audio/{sessionId}" }
 *   - JSON: { type: "voice_done" }
 */

import { RealtimeSession, type RealtimeCallbacks } from "./voice-realtime.js";
import type { ToolContext } from "./tools.js";

/** Registry of active audio streams for HTTP serving */
export type AudioStreamRegistry = Map<string, ReadableStream<Uint8Array>>;

export interface VoiceWSOptions {
  audioStreams: AudioStreamRegistry;
  toolCtx: ToolContext;
}

/**
 * Create the voice WebSocket handler.
 * Returns an object compatible with Hono's upgradeWebSocket callback.
 */
export function createVoiceWSHandler(opts: VoiceWSOptions) {
  return () => {
    let bridgeWs: { send: (data: string | ArrayBuffer) => void } | null = null;
    let activeSession: RealtimeSession | null = null;

    return {
      onOpen(_evt: unknown, ws: { send: (data: string | ArrayBuffer) => void }) {
        console.log("[voice] Bridge connected");
        bridgeWs = ws;
      },

      onMessage(evt: { data: unknown }, _ws: unknown) {
        const { data } = evt;

        // Binary message = audio chunk from bridge (24kHz PCM)
        if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
          if (!activeSession) {
            // No session yet — might be early audio before voice_start, ignore
            return;
          }
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
          activeSession.feedAudio(chunk);
          return;
        }

        // Text message = JSON control event
        if (typeof data === "string") {
          let msg: { type: string; [key: string]: unknown };
          try {
            msg = JSON.parse(data);
          } catch {
            console.warn("[voice] Invalid JSON:", data);
            return;
          }

          switch (msg.type) {
            case "voice_start": {
              const conversationId = String(msg.conversation_id ?? "");
              const wakeWord = String(msg.wake_word ?? "");
              console.log(
                `[voice] Session starting — conversation=${conversationId} wake_word="${wakeWord}"`,
              );

              // Create a new Realtime session
              const sessionId = conversationId || `voice-${Date.now()}`;
              const callbacks: RealtimeCallbacks = {
                onSpeechStopped: () => {
                  console.log("[voice] → bridge: speech_stopped");
                  bridgeWs?.send(JSON.stringify({ type: "speech_stopped" }));
                },
                onTtsStart: (audioPath: string) => {
                  console.log(`[voice] → bridge: tts_start (${audioPath})`);
                  bridgeWs?.send(JSON.stringify({ type: "tts_start", audio_path: audioPath }));
                },
                onVoiceDone: () => {
                  console.log("[voice] → bridge: voice_done");
                  bridgeWs?.send(
                    JSON.stringify({ type: "voice_done", conversation_id: sessionId }),
                  );
                  // Clean up audio stream after a delay (give device time to finish fetching)
                  setTimeout(() => {
                    opts.audioStreams.delete(sessionId);
                    console.log(`[voice] Cleaned up audio stream for ${sessionId}`);
                  }, 30_000);
                },
                onError: (err: Error) => {
                  console.error("[voice] Realtime session error:", err.message);
                  // Send voice_done so the bridge doesn't hang
                  bridgeWs?.send(
                    JSON.stringify({ type: "voice_done", conversation_id: sessionId }),
                  );
                  opts.audioStreams.delete(sessionId);
                },
              };

              const session = new RealtimeSession(sessionId, callbacks, opts.toolCtx);
              activeSession = session;

              // Register the audio stream for HTTP serving
              opts.audioStreams.set(sessionId, session.audioStream);

              // Open the OpenAI Realtime connection
              session.open().catch((err) => {
                console.error("[voice] Failed to open Realtime session:", err);
                bridgeWs?.send(
                  JSON.stringify({ type: "voice_done", conversation_id: sessionId }),
                );
                opts.audioStreams.delete(sessionId);
                activeSession = null;
              });

              break;
            }

            default:
              console.log("[voice] Unknown message type:", msg.type);
          }
        }
      },

      onClose() {
        console.log("[voice] Bridge disconnected");
        if (activeSession) {
          activeSession.close();
          activeSession = null;
        }
        bridgeWs = null;
      },

      onError(evt: unknown) {
        console.error("[voice] WebSocket error:", evt);
      },
    };
  };
}
