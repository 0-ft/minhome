import { useCallback, useEffect, useRef, useState } from "react";

type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "responding"
  | "error";

interface OfferAnswerResponse {
  sessionId: string;
  type: RTCSdpType;
  sdp: string;
}

const ICE_GATHER_GRACE_MS = 350;

function downsampleTo24k(input: Float32Array, inputRate: number): Int16Array {
  if (inputRate === 24_000) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, input[i]));
      out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    return out;
  }

  const ratio = inputRate / 24_000;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < out.length) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i += 1) {
      accum += input[i];
      count += 1;
    }
    const average = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, average));
    out[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return out;
}

function int16ToAudioBuffer(ctx: AudioContext, pcm24: Int16Array): AudioBuffer {
  const audioBuffer = ctx.createBuffer(1, pcm24.length, 24_000);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < pcm24.length; i += 1) {
    channel[i] = pcm24[i] / 0x8000;
  }
  return audioBuffer;
}

export function useBrowserVoiceWebRtc(chatId: string | null) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputQueueTimeRef = useRef<number>(0);
  const sessionIdRef = useRef<string | null>(null);
  const pendingAudioChunksRef = useRef<ArrayBuffer[]>([]);
  const pendingAudioBytesRef = useRef(0);
  const MAX_PENDING_AUDIO_BYTES = 256_000;

  const cleanup = useCallback(async () => {
    try {
      scriptProcessorRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
    } catch { /* ignore */ }
    scriptProcessorRef.current = null;
    sourceNodeRef.current = null;

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) track.stop();
      mediaStreamRef.current = null;
    }

    try { dcRef.current?.close(); } catch { /* ignore */ }
    dcRef.current = null;
    try { pcRef.current?.close(); } catch { /* ignore */ }
    pcRef.current = null;

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    if (outputContextRef.current) {
      await outputContextRef.current.close().catch(() => undefined);
      outputContextRef.current = null;
    }
    outputQueueTimeRef.current = 0;
    pendingAudioChunksRef.current = [];
    pendingAudioBytesRef.current = 0;

    const activeSessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (activeSessionId) {
      await fetch(`/api/voice/browser/webrtc/${encodeURIComponent(activeSessionId)}/stop`, {
        method: "POST",
      }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  const playPcmChunk = useCallback((buffer: ArrayBuffer) => {
    if (!outputContextRef.current) {
      outputContextRef.current = new AudioContext();
      void outputContextRef.current.resume().catch(() => undefined);
    }
    const ctx = outputContextRef.current;
    if (!ctx) return;
    const pcm = new Int16Array(buffer);
    const audioBuffer = int16ToAudioBuffer(ctx, pcm);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.01, outputQueueTimeRef.current);
    src.start(startAt);
    outputQueueTimeRef.current = startAt + audioBuffer.duration;
  }, []);

  const start = useCallback(async () => {
    if (!chatId || status === "connecting" || status === "listening" || status === "responding") return;
    setStatus("connecting");
    setError(null);
    setLastTranscript(null);
    const startedAt = performance.now();
    const logStage = (stage: string, details?: Record<string, unknown>) => {
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (details) {
        console.debug(`[voice/client] ${stage} +${elapsedMs}ms`, details);
      } else {
        console.debug(`[voice/client] ${stage} +${elapsedMs}ms`);
      }
    };
    logStage("start_clicked", { chatId });

    try {
      let inputStream: MediaStream | null = null;

      logStage("pc_create_start");
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;
      logStage("pc_create_done");

      logStage("dc_create_start");
      const dc = pc.createDataChannel("voice-audio", { ordered: true });
      dcRef.current = dc;
      logStage("dc_create_done");

      dc.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data) as { type?: string; text?: string; message?: string };
            if (msg.type === "assistant_transcript" || msg.type === "user_transcript") {
              if (msg.text) setLastTranscript(msg.text);
            } else if (msg.type === "speech_stopped") {
              setStatus("responding");
            } else if (msg.type === "voice_done") {
              setStatus("idle");
            } else if (msg.type === "voice_error") {
              setStatus("error");
              setError(msg.message ?? "Voice session error");
            }
          } catch {
            // ignore non-json strings
          }
          return;
        }
        if (event.data instanceof ArrayBuffer) {
          playPcmChunk(event.data);
        } else if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then(playPcmChunk);
        }
      };

      dc.onopen = () => {
        logStage("dc_open");
        if (pendingAudioChunksRef.current.length > 0) {
          for (const chunk of pendingAudioChunksRef.current) {
            dc.send(chunk);
          }
          pendingAudioChunksRef.current = [];
          pendingAudioBytesRef.current = 0;
        }
        setStatus("listening");
      };

      dc.onclose = () => {
        if (status !== "error") setStatus("idle");
      };

      const offer = await pc.createOffer();
      logStage("create_offer_done");
      await pc.setLocalDescription(offer);
      logStage("set_local_description_done");
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }
        const startedAt = performance.now();
        const onGather = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", onGather);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", onGather);
        setTimeout(() => {
          pc.removeEventListener("icegatheringstatechange", onGather);
          logStage("ice_gather_grace_timeout", {
            state: pc.iceGatheringState,
            waitedMs: Math.round(performance.now() - startedAt),
          });
          resolve();
        }, ICE_GATHER_GRACE_MS);
      });
      logStage("ice_gather_done", { state: pc.iceGatheringState });

      const local = pc.localDescription;
      if (!local?.sdp) throw new Error("Missing local WebRTC offer");

      logStage("offer_post_start");
      const res = await fetch("/api/voice/browser/webrtc/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          type: "offer",
          sdp: local.sdp,
        }),
      });
      logStage("offer_post_done", { status: res.status });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({} as Record<string, unknown>));
        const payload = detail as { error?: string; detail?: string };
        throw new Error(payload.detail || payload.error || "Failed to create voice session");
      }
      const data = await res.json() as OfferAnswerResponse;
      logStage("offer_json_done");
      sessionIdRef.current = data.sessionId;
      await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
      logStage("set_remote_description_done");

      logStage("get_user_media_start");
      inputStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }).catch(() => null);
      logStage("get_user_media_done", { ok: Boolean(inputStream) });

      if (!inputStream) {
        throw new Error("Microphone permission was denied");
      }
      mediaStreamRef.current = inputStream;

      const inputCtx = new AudioContext();
      audioContextRef.current = inputCtx;
      await inputCtx.resume();
      logStage("input_audio_context_ready", { sampleRate: inputCtx.sampleRate });

      const source = inputCtx.createMediaStreamSource(inputStream);
      sourceNodeRef.current = source;
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;
      processor.onaudioprocess = (evt) => {
        const channel = evt.inputBuffer.getChannelData(0);
        const pcm24 = downsampleTo24k(channel, inputCtx.sampleRate);
        const chunk = pcm24.buffer.slice(0);
        if (dc.readyState === "open") {
          dc.send(chunk);
          return;
        }

        pendingAudioChunksRef.current.push(chunk);
        pendingAudioBytesRef.current += chunk.byteLength;
        while (
          pendingAudioChunksRef.current.length > 0
          && pendingAudioBytesRef.current > MAX_PENDING_AUDIO_BYTES
        ) {
          const dropped = pendingAudioChunksRef.current.shift();
          pendingAudioBytesRef.current -= dropped?.byteLength ?? 0;
        }
      };
      source.connect(processor);
      processor.connect(inputCtx.destination);
      logStage("audio_pipeline_ready");
    } catch (err) {
      logStage("start_failed", { error: err instanceof Error ? err.message : String(err) });
      await cleanup();
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to start voice");
    }
  }, [chatId, cleanup, playPcmChunk, status]);

  const stop = useCallback(async () => {
    if (dcRef.current?.readyState === "open") {
      dcRef.current.send(JSON.stringify({ type: "voice_stop" }));
    }
    await cleanup();
    setStatus("idle");
  }, [cleanup]);

  return {
    status,
    error,
    lastTranscript,
    isActive: status === "connecting" || status === "listening" || status === "responding",
    start,
    stop,
  };
}
