import { useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { useChat } from "@ai-sdk/react";
import { Send, X, Home, Loader2, Check, Camera } from "lucide-react";
import type { UIMessage } from "ai";
import { MemoizedMarkdown } from "./MemoizedMarkdown.js";
import { ToolCallPart } from "./ToolCallDisplay.js";
import type { ToolPart } from "./ToolCallDisplay.js";
import { Scene, useRoomData } from "./RoomView.js";
import type { GetCameraState } from "./RoomView.js";
import { useSaveRoomCamera } from "../api.js";

// ── Floating message ──────────────────────────────────────

function FloatingMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className="animate-float-in mb-5">
      {isUser ? (
        <p
          className="text-teal-300/90 text-[15px] leading-relaxed"
          style={{ textShadow: "0 1px 16px rgba(0,0,0,0.9), 0 0 40px rgba(0,0,0,0.4)" }}
        >
          {message.parts.map((part, i) =>
            part.type === "text" ? (
              <span key={i} className="whitespace-pre-wrap break-words">
                {part.text}
              </span>
            ) : null,
          )}
        </p>
      ) : (
        <div
          className="prose-float"
          style={{ textShadow: "0 1px 16px rgba(0,0,0,0.9), 0 0 40px rgba(0,0,0,0.4)" }}
        >
          {message.parts.map((part, i) => {
            if (part.type === "text") {
              return (
                <div key={i}>
                  <MemoizedMarkdown content={part.text} id={`float-${message.id}-${i}`} />
                </div>
              );
            }

            if (part.type === "dynamic-tool") {
              const tp = part as ToolPart;
              const done = tp.state === "output-available";
              const errored = tp.state === "output-error";
              return (
                <div key={i} className="transition-opacity duration-300">
                  <div
                    className={`flex items-center gap-1.5 text-[12px] py-0.5 font-mono ${
                      done ? "text-sand-500/30" : errored ? "text-blood-400/70" : "text-sand-400/60"
                    }`}
                  >
                    {done ? (
                      <Check className="h-3 w-3 text-teal-400/50" />
                    ) : errored ? (
                      <X className="h-3 w-3 text-blood-400/70" />
                    ) : (
                      <Loader2 className="h-3 w-3 animate-spin text-teal-400/40" />
                    )}
                    <span>{tp.toolName}</span>
                  </div>
                  {errored && tp.errorText && (
                    <p className="text-[10px] text-blood-400/50 ml-[18px] truncate max-w-xs">{tp.errorText}</p>
                  )}
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────

export function RoomFullView() {
  const navigate = useNavigate();

  // ── Room data ─────────────────────────────────────────
  const { deviceMap, roomConfig, onToggle, isLoading: roomLoading } = useRoomData();
  const cameraRef = useRef<GetCameraState | null>(null);
  const saveCamera = useSaveRoomCamera();
  const [cameraSaved, setCameraSaved] = useState(false);

  const handleSaveCamera = () => {
    const getter = cameraRef.current;
    if (!getter) return;
    const state = getter();
    // Round values for cleaner config.json
    const round = (v: number) => Math.round(v * 100) / 100;
    saveCamera.mutate({
      position: state.position.map(round) as [number, number, number],
      target: state.target.map(round) as [number, number, number],
      zoom: round(state.zoom),
    });
    setCameraSaved(true);
    setTimeout(() => setCameraSaved(false), 2000);
  };

  // ── Chat ──────────────────────────────────────────────
  const { messages, sendMessage, status, stop, error } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage({ text });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const loading = roomLoading;

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#0d0b09]">
      {/* Full-screen 3D Canvas */}
      {!loading && roomConfig && (
        <Canvas
          orthographic
          camera={{
            position: roomConfig.camera?.position ?? [0.7, 5.5, 8],
            zoom: roomConfig.camera?.zoom ?? 100,
          }}
          shadows={{ type: THREE.VSMShadowMap }}
          className="!absolute inset-0"
        >
          <Scene
            roomConfig={roomConfig}
            deviceMap={deviceMap}
            onToggle={onToggle}
            orbitTarget={[roomConfig.dimensions.width / 2 - 2, 0.5, roomConfig.dimensions.depth / 2]}
            cameraRef={cameraRef}
          />
        </Canvas>
      )}

      {/* Not configured message */}
      {!loading && !roomConfig && (
        <div className="absolute inset-0 flex items-center justify-center text-sand-500/50 font-mono text-sm">
          Room not configured
        </div>
      )}

      {/* Floating UI overlay */}
      <div className="absolute inset-0 pointer-events-none flex flex-col">
        {/* Top bar buttons */}
        <div className="flex justify-end gap-2 px-5 py-5 pointer-events-auto shrink-0">
          <button
            onClick={handleSaveCamera}
            className={`p-2 rounded-lg backdrop-blur-sm border transition-all cursor-pointer ${
              cameraSaved
                ? "bg-teal-400/15 border-teal-400/20 text-teal-300"
                : "bg-white/[0.04] border-white/[0.06] text-sand-500 hover:text-sand-100 hover:bg-white/[0.08]"
            }`}
            title="Save camera position"
          >
            {cameraSaved ? <Check className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          </button>
          <button
            onClick={() => navigate("/room")}
            className="p-2 rounded-lg bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] text-sand-500 hover:text-sand-100 hover:bg-white/[0.08] transition-all cursor-pointer"
            title="Back to home"
          >
            <Home className="h-4 w-4" />
          </button>
        </div>

        {/* Messages area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-10 pb-4 max-w-lg scrollbar-float pointer-events-auto"
          style={{
            maskImage:
              "linear-gradient(to bottom, black, black calc(100% - 24px), transparent)",
          }}
        >
          {messages.length === 0 && (
            <div className="animate-float-in mt-4">
              <p
                className="text-sand-500/30 text-[15px] font-mono"
                style={{ textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}
              >
                Ask me anything about your room…
              </p>
            </div>
          )}

          {messages.map((message) => (
            <FloatingMessage key={message.id} message={message} />
          ))}

          {isLoading && messages.length > 0 && (
            <div className="animate-float-in flex items-center gap-2 text-sm text-sand-500/50 mb-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="font-mono">thinking…</span>
            </div>
          )}

          {error && (
            <div
              className="animate-float-in text-sm text-blood-400/70 font-mono mb-4"
              style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}
            >
              {error.message}
            </div>
          )}
        </div>

        {/* Floating input */}
        <div className="px-10 pb-6 pt-2 max-w-lg pointer-events-auto shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything…"
              rows={1}
              className="flex-1 resize-none rounded-xl bg-white/[0.04] backdrop-blur-md border border-white/[0.07] px-4 py-3 text-[15px] text-sand-200 placeholder:text-sand-600/40 focus:outline-none focus:ring-1 focus:ring-teal-400/20 focus:border-teal-400/10 min-h-[44px] max-h-[120px] transition-all"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            {isLoading ? (
              <button
                type="button"
                onClick={stop}
                className="shrink-0 p-3 rounded-xl bg-blood-500/20 backdrop-blur-sm border border-blood-400/15 text-blood-300 hover:bg-blood-500/35 transition-all cursor-pointer"
                title="Stop"
              >
                <X className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="shrink-0 p-3 rounded-xl bg-teal-400/10 backdrop-blur-sm border border-teal-400/15 text-teal-300/80 hover:bg-teal-400/20 hover:text-teal-200 transition-all disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
                title="Send"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

