import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import wrtc from "@roamhq/wrtc";
import { RealtimeSession, type RealtimeCallbacks } from "./voice-realtime.js";
import type { ToolContext } from "./tools.js";

const { RTCPeerConnection } = wrtc;

interface BrowserVoicePeer {
  id: string;
  chatId: string;
  pc: RTCPeerConnection;
  dataChannel: any | null;
  session: RealtimeSession;
  closed: boolean;
}

function parseControlMessage(raw: string): { type: string; [key: string]: unknown } | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") return null;
    return parsed as { type: string; [key: string]: unknown };
  } catch {
    return null;
  }
}

function isPeerOpen(peer: BrowserVoicePeer): boolean {
  return !peer.closed && peer.pc.connectionState !== "closed";
}

function safeSendJson(peer: BrowserVoicePeer, payload: object): void {
  if (!peer.dataChannel) return;
  if (peer.dataChannel.readyState !== "open") return;
  try {
    peer.dataChannel.send(JSON.stringify(payload));
  } catch {
    // ignore transient channel failures
  }
}

function safeSendBinary(peer: BrowserVoicePeer, data: Buffer): void {
  if (!peer.dataChannel) return;
  if (peer.dataChannel.readyState !== "open") return;
  try {
    peer.dataChannel.send(data);
  } catch {
    // ignore transient channel failures
  }
}

async function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const onState = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onState);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onState);
    setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", onState);
      resolve();
    }, 400);
  });
}

function closePeer(peer: BrowserVoicePeer, peers: Map<string, BrowserVoicePeer>): void {
  if (peer.closed) return;
  peer.closed = true;
  peers.delete(peer.id);
  try { peer.session.close(); } catch { /* ignore */ }
  try { peer.dataChannel?.close(); } catch { /* ignore */ }
  try { peer.pc.close(); } catch { /* ignore */ }
}

export function createBrowserVoiceWebRtcRoute(toolCtx: ToolContext) {
  const route = new Hono();
  const peers = new Map<string, BrowserVoicePeer>();

  route.post("/api/voice/browser/webrtc/offer", async (c) => {
    const body = await c.req.json<{
      chatId?: string;
      sdp?: string;
      type?: "offer";
    }>().catch(() => undefined);

    const chatId = body?.chatId?.trim();
    const offerSdp = body?.sdp;
    if (!chatId || !offerSdp || body?.type !== "offer") {
      return c.json({ error: "Invalid offer payload" }, 400);
    }

    const existingChat = toolCtx.chats.get(chatId);
    if (!existingChat) return c.json({ error: "Chat not found" }, 404);
    toolCtx.chats.touch(chatId);

    const startedAt = Date.now();
    const peerId = randomUUID();
    const deviceId = `browser-${peerId.slice(0, 8)}`;
    const sessionId = `browser-voice-${Date.now()}`;
    const logStage = (stage: string, details?: Record<string, unknown>) => {
      const elapsedMs = Date.now() - startedAt;
      if (details) {
        console.log(`[voice/browser][${peerId}] ${stage} (+${elapsedMs}ms)`, details);
      } else {
        console.log(`[voice/browser][${peerId}] ${stage} (+${elapsedMs}ms)`);
      }
    };
    logStage("offer_received", { chatId });

    let peer: BrowserVoicePeer | null = null;

    const callbacks: RealtimeCallbacks = {
      onSpeechStopped: () => {
        if (!peer || !isPeerOpen(peer)) return;
        safeSendJson(peer, { type: "speech_stopped" });
      },
      onTtsStart: () => {
        // Browser playback receives raw audio over datachannel instead of /audio URL.
      },
      onVoiceDone: () => {
        if (!peer || !isPeerOpen(peer)) return;
        safeSendJson(peer, { type: "voice_done" });
      },
      onError: (err: Error, code?: string) => {
        if (!peer || !isPeerOpen(peer)) return;
        safeSendJson(peer, { type: "voice_error", code: code ?? "server-error", message: err.message });
      },
      onOutputAudioChunk: (pcm24: Buffer) => {
        if (!peer || !isPeerOpen(peer)) return;
        safeSendBinary(peer, pcm24);
      },
      onUserTranscript: (text: string) => {
        if (!peer || !isPeerOpen(peer)) return;
        safeSendJson(peer, { type: "user_transcript", text });
      },
      onAssistantTranscript: (text: string) => {
        if (!peer || !isPeerOpen(peer)) return;
        safeSendJson(peer, { type: "assistant_transcript", text });
      },
    };

    const session = new RealtimeSession(
      sessionId,
      chatId,
      existingChat.source,
      deviceId,
      callbacks,
      toolCtx,
    );

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    logStage("peer_connection_created");

    peer = {
      id: peerId,
      chatId,
      pc,
      dataChannel: null,
      session,
      closed: false,
    };
    peers.set(peerId, peer);

    pc.onconnectionstatechange = () => {
      if (!peer) return;
      logStage("pc_connection_state", { state: pc.connectionState });
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        closePeer(peer, peers);
      }
    };

    pc.ondatachannel = (event) => {
      if (!peer) return;
      const dc = event.channel;
      peer.dataChannel = dc;
      logStage("datachannel_created", { label: dc.label });

      dc.onopen = () => {
        logStage("datachannel_open");
      };

      dc.onmessage = (msgEvent) => {
        if (!peer || peer.closed) return;
        const data = msgEvent.data;
        if (typeof data === "string") {
          const msg = parseControlMessage(data);
          if (!msg) return;
          if (msg.type === "voice_stop") {
            safeSendJson(peer, { type: "voice_done" });
            closePeer(peer, peers);
          }
          return;
        }

        if (data instanceof ArrayBuffer) {
          peer.session.feedAudio(Buffer.from(data));
          return;
        }

        if (Buffer.isBuffer(data)) {
          peer.session.feedAudio(data);
        }
      };

      dc.onclose = () => {
        if (!peer) return;
        logStage("datachannel_close");
        closePeer(peer, peers);
      };
    };

    try {
      logStage("set_remote_description_start");
      await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
      logStage("set_remote_description_done");
      logStage("create_answer_start");
      const answer = await pc.createAnswer();
      logStage("create_answer_done");
      logStage("set_local_description_start");
      await pc.setLocalDescription(answer);
      logStage("set_local_description_done");
      logStage("ice_gather_wait_start", { state: pc.iceGatheringState });
      await waitForIceGatheringComplete(pc);
      logStage("ice_gather_wait_done", { state: pc.iceGatheringState });

      const local = pc.localDescription;
      if (!local?.sdp) {
        closePeer(peer, peers);
        return c.json({ error: "Missing local SDP answer" }, 500);
      }
      logStage("answer_ready");

      const response = c.json({
        sessionId: peerId,
        type: local.type,
        sdp: local.sdp,
      });
      logStage("answer_returning");

      // Return SDP immediately; OpenAI realtime setup proceeds in background.
      const openStartAt = Date.now();
      void session.open().catch((err) => {
        if (!peer || peer.closed || !isPeerOpen(peer)) return;
        console.error(`[voice/browser][${peerId}] realtime_open_failed (+${Date.now() - openStartAt}ms)`, err);
        safeSendJson(peer, {
          type: "voice_error",
          code: "realtime-open-failed",
          message: String(err),
        });
        closePeer(peer, peers);
      }).then(() => {
        logStage("realtime_open_done", { elapsedMs: Date.now() - openStartAt });
      });

      return response;
    } catch (err) {
      console.error(`[voice/browser][${peerId}] establish_failed`, err);
      closePeer(peer, peers);
      return c.json({
        error: "Failed to establish browser voice WebRTC session",
        detail: String(err),
      }, 500);
    }
  });

  route.post("/api/voice/browser/webrtc/:id/stop", (c) => {
    const id = c.req.param("id");
    const peer = peers.get(id);
    if (!peer) return c.json({ ok: true });
    closePeer(peer, peers);
    return c.json({ ok: true });
  });

  return route;
}
