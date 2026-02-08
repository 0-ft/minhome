/**
 * Voice module — handles incoming audio from the Voice PE bridge.
 *
 * Provides a WebSocket endpoint at /ws/voice that receives:
 *   - JSON text messages: control events (voice_start, voice_end)
 *   - Binary messages: raw 16-bit PCM audio chunks (16 kHz, mono)
 *
 * Audio is accumulated per session and saved as a WAV file on completion.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

// PCM format constants
const SAMPLE_RATE = 16000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

export interface VoiceSession {
  conversationId: string;
  wakeWord: string;
  startedAt: number;
  chunks: Buffer[];
  totalBytes: number;
}

export interface VoiceHandlers {
  /** Called when a voice session starts (wake word detected on device). */
  onSessionStart?: (session: VoiceSession) => void;
  /** Called when a voice session ends (async — pipeline runs to completion). */
  onSessionEnd?: (session: VoiceSession, wavPath: string) => void | Promise<void>;
  /** Called on each audio chunk received. */
  onAudioChunk?: (session: VoiceSession, chunk: Buffer) => void;
}

/**
 * Creates a WAV file header for raw PCM data.
 */
export function createWavHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(44);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4); // file size - 8
  header.write("WAVE", 8);

  // fmt sub-chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // sub-chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(NUM_CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * NUM_CHANNELS * BYTES_PER_SAMPLE, 28); // byte rate
  header.writeUInt16LE(NUM_CHANNELS * BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);

  // data sub-chunk
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * Save accumulated PCM chunks as a WAV file.
 * Returns the path to the saved file.
 */
function saveSessionAsWav(session: VoiceSession, outputDir: string): string {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date(session.startedAt).toISOString().replace(/[:.]/g, "-");
  const filename = `voice-${timestamp}.wav`;
  const filepath = resolve(outputDir, filename);

  const pcmData = Buffer.concat(session.chunks);
  const header = createWavHeader(pcmData.length);
  const wavData = Buffer.concat([header, pcmData]);

  writeFileSync(filepath, wavData);
  return filepath;
}

/**
 * Create the voice WebSocket handler.
 * Returns an object compatible with Hono's upgradeWebSocket callback.
 */
export function createVoiceWSHandler(outputDir: string, handlers?: VoiceHandlers) {
  return () => {
    let currentSession: VoiceSession | null = null;
    // Store WS ref so we can send voice_done back to the bridge
    let bridgeWs: { send: (data: string) => void } | null = null;

    return {
      onOpen(_evt: unknown, ws: { send: (data: string) => void }) {
        console.log("[voice] Bridge connected");
        bridgeWs = ws;
      },

      onMessage(evt: { data: unknown }, _ws: unknown) {
        const { data } = evt;

        // Binary message = audio chunk
        if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
          if (!currentSession) {
            console.warn("[voice] Received audio but no active session");
            return;
          }
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
          currentSession.chunks.push(chunk);
          currentSession.totalBytes += chunk.length;
          handlers?.onAudioChunk?.(currentSession, chunk);
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
              currentSession = {
                conversationId,
                wakeWord,
                startedAt: Date.now(),
                chunks: [],
                totalBytes: 0,
              };
              console.log(
                `[voice] Session started — conversation=${conversationId} wake_word="${wakeWord}"`,
              );
              handlers?.onSessionStart?.(currentSession);
              break;
            }

            case "voice_end": {
              if (!currentSession) {
                console.warn("[voice] voice_end but no active session");
                break;
              }

              const durationSecs =
                currentSession.totalBytes / (SAMPLE_RATE * BYTES_PER_SAMPLE);
              console.log(
                `[voice] Session ended — ${currentSession.totalBytes} bytes (~${durationSecs.toFixed(1)}s audio)`,
              );

              // Save WAV and run AI pipeline
              if (currentSession.totalBytes > 0) {
                const wavPath = saveSessionAsWav(currentSession, outputDir);
                console.log(`[voice] Saved WAV: ${wavPath}`);
                const session = currentSession;
                // Run the async handler; when it completes, send voice_done
                // back to the bridge so it can release the device from
                // "thinking" state.
                Promise.resolve(handlers?.onSessionEnd?.(session, wavPath))
                  .then(() => {
                    console.log(`[voice] Pipeline complete — sending voice_done`);
                    bridgeWs?.send(
                      JSON.stringify({
                        type: "voice_done",
                        conversation_id: session.conversationId,
                      }),
                    );
                  })
                  .catch((err) => {
                    console.error("[voice] Pipeline error:", err);
                    // Still send voice_done so the bridge doesn't hang
                    bridgeWs?.send(
                      JSON.stringify({
                        type: "voice_done",
                        conversation_id: session.conversationId,
                      }),
                    );
                  });
              } else {
                console.log("[voice] No audio data received, skipping WAV save");
              }

              currentSession = null;
              break;
            }

            default:
              console.log("[voice] Unknown message type:", msg.type);
          }
        }
      },

      onClose() {
        console.log("[voice] Bridge disconnected");
        // If a session was in progress, save what we have
        if (currentSession && currentSession.totalBytes > 0) {
          const wavPath = saveSessionAsWav(currentSession, outputDir);
          console.log(`[voice] Bridge disconnected mid-session — saved partial WAV: ${wavPath}`);
          handlers?.onSessionEnd?.(currentSession, wavPath);
        }
        currentSession = null;
        bridgeWs = null;
      },

      onError(evt: unknown) {
        console.error("[voice] WebSocket error:", evt);
      },
    };
  };
}
