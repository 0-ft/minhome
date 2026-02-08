/**
 * Voice module — handles the bridge WebSocket connection and coordinates
 * with OpenAI Realtime sessions for speech-to-speech interaction.
 *
 * Supports multiple voice devices simultaneously via device_id routing.
 *
 * Protocol (bridge → server):
 *   - JSON: { type: "voice_start", device_id, conversation_id, wake_word }
 *   - Binary: raw 24kHz 16-bit PCM audio chunks (for the active streaming device)
 *
 * Protocol (server → bridge):
 *   - JSON: { type: "speech_stopped", device_id }
 *   - JSON: { type: "tts_start", device_id, audio_path }
 *   - JSON: { type: "voice_done", device_id, conversation_id }
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

    // Track sessions by device_id
    const sessions = new Map<string, RealtimeSession>();
    // Track which device_id is currently streaming audio
    let activeStreamingDevice: string | null = null;

    return {
      onOpen(_evt: unknown, ws: { send: (data: string | ArrayBuffer) => void }) {
        console.log("[voice] Bridge connected");
        bridgeWs = ws;
      },

      onMessage(evt: { data: unknown }, _ws: unknown) {
        const { data } = evt;

        // Binary message = audio chunk from bridge (24kHz PCM)
        if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
          if (!activeStreamingDevice) return;
          const session = sessions.get(activeStreamingDevice);
          if (!session) return;
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
          session.feedAudio(chunk);
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
              const deviceId = String(msg.device_id ?? "unknown");
              const conversationId = String(msg.conversation_id ?? "");
              const wakeWord = String(msg.wake_word ?? "");
              console.log(
                `[voice] Session starting — device=${deviceId} conversation=${conversationId} wake_word="${wakeWord}"`,
              );

              const sessionId = conversationId || `voice-${Date.now()}`;

              // Track active streaming device
              activeStreamingDevice = deviceId;

              const callbacks: RealtimeCallbacks = {
                onSpeechStopped: () => {
                  console.log(`[voice] → bridge: speech_stopped (device=${deviceId})`);
                  bridgeWs?.send(JSON.stringify({
                    type: "speech_stopped",
                    device_id: deviceId,
                  }));
                },
                onTtsStart: (audioPath: string) => {
                  console.log(`[voice] → bridge: tts_start (device=${deviceId}, ${audioPath})`);
                  bridgeWs?.send(JSON.stringify({
                    type: "tts_start",
                    device_id: deviceId,
                    audio_path: audioPath,
                  }));
                },
                onVoiceDone: () => {
                  console.log(`[voice] → bridge: voice_done (device=${deviceId})`);
                  bridgeWs?.send(JSON.stringify({
                    type: "voice_done",
                    device_id: deviceId,
                    conversation_id: sessionId,
                  }));
                  // Clear active streamer
                  if (activeStreamingDevice === deviceId) {
                    activeStreamingDevice = null;
                  }
                  sessions.delete(deviceId);
                  // Clean up audio stream after a delay
                  setTimeout(() => {
                    opts.audioStreams.delete(sessionId);
                    console.log(`[voice] Cleaned up audio stream for ${sessionId}`);
                  }, 30_000);
                },
                onError: (err: Error) => {
                  console.error(`[voice] Realtime session error (device=${deviceId}):`, err.message);
                  bridgeWs?.send(JSON.stringify({
                    type: "voice_done",
                    device_id: deviceId,
                    conversation_id: sessionId,
                  }));
                  if (activeStreamingDevice === deviceId) {
                    activeStreamingDevice = null;
                  }
                  sessions.delete(deviceId);
                  opts.audioStreams.delete(sessionId);
                },
              };

              const session = new RealtimeSession(sessionId, callbacks, opts.toolCtx);
              sessions.set(deviceId, session);

              // Register the audio stream for HTTP serving
              opts.audioStreams.set(sessionId, session.audioStream);

              // Open the OpenAI Realtime connection
              session.open().catch((err) => {
                console.error(`[voice] Failed to open Realtime session (device=${deviceId}):`, err);
                bridgeWs?.send(JSON.stringify({
                  type: "voice_done",
                  device_id: deviceId,
                  conversation_id: sessionId,
                }));
                if (activeStreamingDevice === deviceId) {
                  activeStreamingDevice = null;
                }
                sessions.delete(deviceId);
                opts.audioStreams.delete(sessionId);
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
        for (const [deviceId, session] of sessions) {
          console.log(`[voice] Cleaning up session for device=${deviceId}`);
          session.close();
        }
        sessions.clear();
        activeStreamingDevice = null;
        bridgeWs = null;
      },

      onError(evt: unknown) {
        console.error("[voice] WebSocket error:", evt);
      },
    };
  };
}
