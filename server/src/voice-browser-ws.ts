import { randomUUID } from "node:crypto";
import { RealtimeSession, type RealtimeCallbacks } from "./voice-realtime.js";
import type { ToolContext } from "./tools.js";

export function createBrowserVoiceWSHandler(opts: { toolCtx: ToolContext }) {
  return () => {
    let session: RealtimeSession | null = null;
    let sessionId: string | null = null;
    let closed = false;

    const closeSession = () => {
      if (!session) return;
      try { session.close(); } catch { /* ignore */ }
      session = null;
      sessionId = null;
    };

    return {
      onOpen() {
        // Wait for explicit voice_start from browser client.
      },

      onMessage(evt: { data: unknown }, ws: { send: (data: string | ArrayBuffer) => void }) {
        const { data } = evt;

        if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
          if (!session) return;
          const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
          session.feedAudio(chunk);
          return;
        }

        if (typeof data !== "string") return;

        let msg: { type: string; [key: string]: unknown };
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }

        if (msg.type === "voice_stop") {
          closeSession();
          ws.send(JSON.stringify({ type: "voice_done" }));
          return;
        }

        if (msg.type !== "voice_start") return;

        const chatId = String(msg.chat_id ?? "").trim();
        if (!chatId) {
          ws.send(JSON.stringify({
            type: "voice_error",
            code: "missing-chat-id",
            message: "chat_id is required",
          }));
          return;
        }

        const existingChat = opts.toolCtx.chats.get(chatId);
        if (!existingChat) {
          ws.send(JSON.stringify({
            type: "voice_error",
            code: "chat-not-found",
            message: "Chat not found",
          }));
          return;
        }

        opts.toolCtx.chats.touch(chatId);
        closeSession();

        const deviceId = `browser-${randomUUID().slice(0, 8)}`;
        sessionId = `browser-voice-${Date.now()}`;
        const callbacks: RealtimeCallbacks = {
          onSpeechStopped: () => {
            ws.send(JSON.stringify({ type: "speech_stopped" }));
          },
          onTtsStart: () => {
            // Browser playback receives raw PCM output over WS binary frames.
          },
          onVoiceDone: () => {
            ws.send(JSON.stringify({ type: "voice_done" }));
          },
          onError: (err: Error, code?: string) => {
            ws.send(JSON.stringify({
              type: "voice_error",
              code: code ?? "server-error",
              message: err.message,
            }));
          },
          onOutputAudioChunk: (pcm24: Buffer) => {
            ws.send(pcm24);
          },
          onUserTranscript: (text: string) => {
            ws.send(JSON.stringify({ type: "user_transcript", text }));
          },
          onAssistantTranscript: (text: string) => {
            ws.send(JSON.stringify({ type: "assistant_transcript", text }));
          },
        };

        session = new RealtimeSession(
          sessionId,
          chatId,
          existingChat.source,
          deviceId,
          callbacks,
          opts.toolCtx,
        );

        // Browser can start sending audio immediately; RealtimeSession will buffer
        // until OpenAI session configuration is fully ready.
        ws.send(JSON.stringify({ type: "voice_ready" }));

        void session.open()
          .then(() => {
            // no-op; readiness is already communicated to client
          })
          .catch((err) => {
            if (closed) return;
            ws.send(JSON.stringify({
              type: "voice_error",
              code: "realtime-open-failed",
              message: String(err),
            }));
            closeSession();
          });
      },

      onClose() {
        closed = true;
        closeSession();
      },

      onError() {
        closeSession();
      },
    };
  };
}

