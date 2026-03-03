import { useRef, useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { Send, X, Home, Loader2, Check, Camera, History, Plus } from "lucide-react";
import { MemoizedMarkdown } from "./MemoizedMarkdown.js";
import { Scene, useRoomData } from "./RoomView.js";
import type { GetCameraState } from "./RoomView.js";
import { useSaveRoomCamera } from "../api.js";
import { RoomFullChatHistoryModal } from "./RoomFullChatHistoryModal.js";
import { usePersistedChatController } from "./chat/usePersistedChatController.js";
import { buildChatRenderItems } from "./chat/chatRenderItems.js";
import { ToolCallGroup } from "./chat/ToolCallGroup.js";

// ── Floating message ──────────────────────────────────────

function FloatingTextMessage({ id, role, text }: { id: string; role: "user" | "assistant"; text: string }) {
  const isUser = role === "user";

  return (
    <div className="animate-float-in mb-5">
      {isUser ? (
        <p
          className="text-teal-300/90 text-[15px] leading-relaxed"
          style={{ textShadow: "0 1px 16px rgba(0,0,0,0.9), 0 0 40px rgba(0,0,0,0.4)" }}
        >
          <span className="whitespace-pre-wrap break-words">{text}</span>
        </p>
      ) : (
        <div
          className="prose-float"
          style={{ textShadow: "0 1px 16px rgba(0,0,0,0.9), 0 0 40px rgba(0,0,0,0.4)" }}
        >
          <div>
            <MemoizedMarkdown content={text} id={`float-${id}-markdown`} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────

export function RoomFullView() {
  const navigate = useNavigate();

  // ── Room data ─────────────────────────────────────────
  const { deviceMap, roomConfig, onToggle, onDragSet, isLoading: roomLoading } = useRoomData();
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
  const {
    activeChatId,
    chats,
    createNewChat,
    selectChat,
    messages,
    sendMessage,
    status,
    stop,
    error,
  } = usePersistedChatController("text");
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);

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
    if (!text || isLoading || !activeChatId) return;
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
          <fog attach="fog" args={["#100e0c", 10, 15]} />
          <Scene
            roomConfig={roomConfig}
            deviceMap={deviceMap}
            onToggle={onToggle}
            onDragSet={onDragSet}
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
      <div className="absolute inset-0 pointer-events-none flex flex-col min-h-0">
        {/* Messages area with blurred chat controls */}
        <div className="relative flex-1 min-h-0 max-w-lg pointer-events-auto">
          <div
            className="absolute top-0 left-0 right-0 z-10 h-24 pointer-events-none"
            style={{
              backdropFilter: "blur(10px)",
              background: "linear-gradient(to bottom, rgba(13, 11, 9, 0.42), rgba(13, 11, 9, 0.08), transparent)",
              maskImage: "linear-gradient(to bottom, black 68%, transparent)",
            }}
          >
            <div className="absolute top-5 left-10 flex items-center gap-2 pointer-events-auto">
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="shrink-0 p-2.5 rounded-lg bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] text-sand-500 hover:text-sand-100 hover:bg-white/[0.08] transition-all cursor-pointer"
                title="Chat history"
              >
                <History className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  await createNewChat();
                }}
                className="shrink-0 p-2.5 rounded-lg bg-teal-400/10 backdrop-blur-sm border border-teal-400/18 text-teal-300/80 hover:bg-teal-400/20 hover:text-teal-200 transition-all cursor-pointer"
                title="New chat"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="h-full min-h-0 overflow-y-auto px-10 pt-20 pb-4 scrollbar-float"
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

            {renderItems.map((item) => (
              item.kind === "text" ? (
                <FloatingTextMessage key={item.id} id={item.id} role={item.role} text={item.text} />
              ) : (
                <div key={item.id} className="animate-float-in mb-5">
                  <ToolCallGroup parts={item.tools} variant="roomFull" />
                </div>
              )
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
              className="flex-1 resize-none rounded-xl bg-white/[0.04] backdrop-blur-md border border-white/[0.07] px-4 py-3 text-[15px] text-sand-200 placeholder:text-sand-600/40 focus:outline-none focus:bg-white/[0.06] min-h-[44px] max-h-[120px] transition-all"
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
                disabled={!input.trim() || !activeChatId}
                className="shrink-0 p-3 rounded-xl bg-teal-400/10 backdrop-blur-sm border border-teal-400/15 text-teal-300/80 hover:bg-teal-400/20 hover:text-teal-200 transition-all disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
                title="Send"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Fixed nav buttons (do not affect chat layout) */}
      <div className="fixed top-5 right-5 flex gap-2 pointer-events-auto z-10">
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

      <RoomFullChatHistoryModal
        open={historyOpen}
        chats={chats}
        activeChatId={activeChatId}
        onClose={() => setHistoryOpen(false)}
        onSelect={(chatId) => {
          selectChat(chatId);
          setHistoryOpen(false);
        }}
        onNewChat={async () => {
          await createNewChat();
          setHistoryOpen(false);
        }}
      />
    </div>
  );
}

