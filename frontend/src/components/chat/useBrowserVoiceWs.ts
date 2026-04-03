import { useCallback, useEffect, useRef, useState } from "react";

type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "responding"
  | "error";

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

export function useBrowserVoiceWs(chatId: string | null) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantTranscript, setAssistantTranscript] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputQueueTimeRef = useRef<number>(0);
  const pendingAudioChunksRef = useRef<ArrayBuffer[]>([]);
  const pendingAudioBytesRef = useRef(0);
  const MAX_PENDING_AUDIO_BYTES = 256_000;
  const wsReadyRef = useRef(false);

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

    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;

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
    wsReadyRef.current = false;
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
    setUserTranscript("");
    setAssistantTranscript("");

    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/voice/browser`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "voice_start", chat_id: chatId }));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data) as { type?: string; text?: string; delta?: string; message?: string };
            if (msg.type === "voice_ready") {
              wsReadyRef.current = true;
              if (pendingAudioChunksRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
                for (const chunk of pendingAudioChunksRef.current) ws.send(chunk);
                pendingAudioChunksRef.current = [];
                pendingAudioBytesRef.current = 0;
              }
              setStatus("listening");
            } else if (msg.type === "user_transcript") {
              if (msg.text) setUserTranscript(msg.text);
            } else if (msg.type === "assistant_transcript_delta") {
              if (msg.delta) setAssistantTranscript((prev) => prev + msg.delta);
            } else if (msg.type === "assistant_transcript") {
              if (msg.text) setAssistantTranscript(msg.text);
            } else if (msg.type === "speech_stopped") {
              setStatus("responding");
            } else if (msg.type === "voice_done") {
              setStatus("idle");
            } else if (msg.type === "voice_error") {
              setStatus("error");
              setError(msg.message ?? "Voice session error");
            }
          } catch {
            // ignore malformed message
          }
          return;
        }

        if (event.data instanceof ArrayBuffer) {
          playPcmChunk(event.data);
        } else if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then(playPcmChunk);
        }
      };

      ws.onclose = () => {
        wsReadyRef.current = false;
        setStatus((prev) => (prev === "error" ? prev : "idle"));
      };

      const inputStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = inputStream;

      const inputCtx = new AudioContext();
      audioContextRef.current = inputCtx;
      await inputCtx.resume();

      const source = inputCtx.createMediaStreamSource(inputStream);
      sourceNodeRef.current = source;
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;
      processor.onaudioprocess = (evt) => {
        const channel = evt.inputBuffer.getChannelData(0);
        const pcm24 = downsampleTo24k(channel, inputCtx.sampleRate);
        const chunk = pcm24.buffer.slice(0);
        if (ws.readyState === WebSocket.OPEN && wsReadyRef.current) {
          ws.send(chunk);
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
    } catch (err) {
      await cleanup();
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to start voice");
    }
  }, [chatId, cleanup, playPcmChunk, status]);

  const stop = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "voice_stop" }));
    }
    await cleanup();
    setStatus("idle");
  }, [cleanup]);

  return {
    status,
    error,
    userTranscript,
    assistantTranscript,
    isActive: status === "connecting" || status === "listening" || status === "responding",
    start,
    stop,
  };
}

