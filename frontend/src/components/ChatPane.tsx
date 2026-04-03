import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, X, Loader2, History, Mic, Info } from "lucide-react";
import { MemoizedMarkdown } from "./MemoizedMarkdown.js";
import { useDeleteChat } from "../api.js";
import { ChatHistoryModal } from "./ChatHistoryModal.js";
import { ConfirmDialog } from "./ui/ConfirmDialog.js";
import { usePersistedChatController } from "./chat/usePersistedChatController.js";
import { useBrowserVoiceWs } from "./chat/useBrowserVoiceWs.js";
import { buildChatRenderItems } from "./chat/chatRenderItems.js";
import { ToolCallGroup } from "./chat/ToolCallGroup.js";

function useChatInfo() {
  return useQuery({
    queryKey: ["chat-info"],
    queryFn: async () => {
      const res = await fetch("/api/chat/info");
      return res.json() as Promise<{ model: string; available: boolean }>;
    },
    staleTime: 60_000,
  });
}

export function ChatPane({
  onClose,
  showCloseButton = true,
}: {
  onClose: () => void;
  showCloseButton?: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const deleteChat = useDeleteChat();
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
    markHydrationDirty,
  } = usePersistedChatController("text");
  const { data: chatInfo } = useChatInfo();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);
  const voice = useBrowserVoiceWs(activeChatId);

  const isLoading = status === "submitted" || status === "streaming";
  const isVoiceActive = voice.isActive;

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Auto-scroll on new messages or streaming voice transcript changes
  useEffect(scrollToBottom, [messages, scrollToBottom]);
  useEffect(scrollToBottom, [voice.userTranscript, voice.assistantTranscript, scrollToBottom]);

  // Re-hydrate persisted messages when voice session ends
  const wasVoiceActiveRef = useRef(false);
  useEffect(() => {
    if (isVoiceActive) {
      wasVoiceActiveRef.current = true;
    } else if (wasVoiceActiveRef.current) {
      wasVoiceActiveRef.current = false;
      markHydrationDirty();
    }
  }, [isVoiceActive, markHydrationDirty]);

  // Focus once on mount; do not refocus after voice sessions.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading || !activeChatId || isVoiceActive) return;
    sendMessage({ text });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-sand-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sand-300">
        <div>
          <h2 className="text-sm font-semibold text-sand-800">AI Assistant</h2>
          <p className="text-[10px] font-mono text-sand-500 mt-0.5">
            {isLoading ? "thinking…" : chatInfo?.model ?? "…"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setHistoryOpen(true)}
            className="p-1.5 rounded-md text-sand-500 hover:text-sand-800 hover:bg-sand-200 transition-colors cursor-pointer"
            title="Chat history"
          >
            <History className="h-4 w-4" />
          </button>
          {showCloseButton && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-sand-500 hover:text-sand-800 hover:bg-sand-200 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-sand-600">Ask me anything about your smart home.</p>
            <p className="text-xs font-mono text-sand-500 mt-1">
              I can control devices, create automations, and more.
            </p>
          </div>
        )}

        {renderItems.map((item) => (
          item.kind === "text" ? (
            <MessageBubble
              key={item.id}
              id={item.id}
              role={item.role}
              text={item.text}
            />
          ) : item.kind === "extraInstructions" ? (
            <ExtraInstructionsBanner key={item.id} text={item.text} />
          ) : (
            <ToolCallGroup key={item.id} parts={item.tools} variant="regular" />
          )
        ))}

        {isVoiceActive && voice.userTranscript && (
          <MessageBubble id="voice-user" role="user" text={voice.userTranscript} />
        )}
        {isVoiceActive && voice.assistantTranscript && (
          <MessageBubble id="voice-assistant" role="assistant" text={voice.assistantTranscript} />
        )}

        {isLoading && messages.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-sand-500 pl-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="font-mono">thinking…</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-blood-600/20 border border-blood-400/30 px-3 py-2 text-xs text-blood-500">
            <p className="font-medium">Error</p>
            <p className="mt-0.5 font-mono">{error.message}</p>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-sand-300 px-4 py-3 bg-sand-50"
      >
        <div className="flex gap-2 items-stretch">
          {isVoiceActive ? (
            <div className="flex-1 rounded-lg bg-sand-200 px-3 py-2 min-h-[36px] inline-flex items-center">
              <p className="text-xs font-mono text-sand-700 truncate">
                voice: {voice.status}
                {voice.error ? ` - ${voice.error}` : ""}
              </p>
            </div>
          ) : (
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
              rows={1}
              className="flex-1 resize-none rounded-lg bg-sand-200 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-500 focus:outline-none focus:bg-sand-100 transition-colors min-h-[36px] max-h-[120px]"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
          )}
          <button
            type="button"
            onClick={() => {
              if (isVoiceActive) {
                void voice.stop();
              } else {
                void voice.start();
              }
            }}
            disabled={!activeChatId || isLoading}
            className={`shrink-0 h-9 w-9 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center ${
              voice.status === "connecting"
                ? "bg-blood-100 text-blood-600"
                : voice.status === "responding"
                  ? "bg-blood-200 text-blood-700"
                : isVoiceActive
                  ? "bg-blood-400 text-sand-50"
                  : "bg-sand-300 text-sand-700 hover:bg-sand-200"
            }`}
            style={{
              transform:
                voice.status === "connecting" || voice.status === "responding"
                  ? "scale(1.16)"
                  : isVoiceActive
                    ? "scale(1.24)"
                    : "scale(1)",
              transition: "transform 220ms ease, background-color 220ms ease, color 220ms ease",
            }}
            title={isVoiceActive ? "Stop voice session" : "Start voice"}
          >
            {voice.status === "connecting" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : voice.status === "responding" ? (
              <span className="inline-flex items-center gap-0.5">
                <span className="h-1 w-1 rounded-full bg-current animate-bounce" />
                <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:120ms]" />
                <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:240ms]" />
              </span>
            ) : (
              <Mic className={`h-4 w-4 ${isVoiceActive ? "animate-pulse" : ""}`} />
            )}
          </button>
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="shrink-0 h-9 w-9 rounded-lg bg-blood-400 text-sand-50 hover:bg-blood-500 transition-colors cursor-pointer inline-flex items-center justify-center"
              title="Stop generating"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || !activeChatId}
              className="shrink-0 h-9 w-9 rounded-lg bg-blood-200 text-blood-700 hover:bg-blood-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center"
              title="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>

      <ChatHistoryModal
        open={historyOpen}
        chats={chats}
        activeChatId={activeChatId}
        onClose={() => setHistoryOpen(false)}
        onSelect={(chatId) => {
          selectChat(chatId);
          setHistoryOpen(false);
        }}
        onDeleteRequested={(chatId) => setDeleteTargetId(chatId)}
        onNewChat={async () => {
          await createNewChat();
          setHistoryOpen(false);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        title="Delete chat?"
        message="This will permanently remove the selected chat history."
        confirmLabel="Delete"
        pending={deleteChat.isPending}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={async () => {
          if (!deleteTargetId) return;
          const deletingId = deleteTargetId;
          const remaining = chats.filter((chat) => chat.id !== deletingId);
          try {
            await deleteChat.mutateAsync(deletingId);
            setDeleteTargetId(null);
            if (activeChatId === deletingId) {
              if (remaining.length > 0) {
                selectChat(remaining[0].id);
              } else {
                await createNewChat();
              }
            }
          } catch {
            // Surface API errors via existing mutation state handling.
          }
        }}
      />
    </div>
  );
}

// ── Extra Instructions Banner ────────────────────────────

function ExtraInstructionsBanner({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="inline-flex items-start gap-1.5 rounded-md bg-sand-200/70 border border-sand-300/60 px-2.5 py-1.5 max-w-[85%]">
        <Info className="h-3 w-3 text-sand-500 mt-0.5 shrink-0" />
        <p className="text-[11px] leading-snug text-sand-600 italic break-words">
          {text}
        </p>
      </div>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────

function MessageBubble({ id, role, text }: { id: string; role: "user" | "assistant"; text: string }) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-teal-400 text-teal-900 rounded-br-sm"
            : "bg-sand-200 text-sand-800 rounded-bl-sm"
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap break-words">{text}</span>
        ) : (
          <div className="prose-chat">
            <MemoizedMarkdown content={text} id={`${id}-markdown`} />
          </div>
        )}
      </div>
    </div>
  );
}


