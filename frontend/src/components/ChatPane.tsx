import { useChat } from "@ai-sdk/react";
import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, X, Loader2, History } from "lucide-react";
import type { UIMessage } from "ai";
import { MemoizedMarkdown } from "./MemoizedMarkdown.js";
import { ToolCallPart, isToolPart } from "./ToolCallDisplay.js";
import type { ToolPart } from "./ToolCallDisplay.js";
import { useChats, useChatById, useCreateChat, useDeleteChat } from "../api.js";
import { ChatHistoryModal } from "./ChatHistoryModal.js";
import { ConfirmDialog } from "./ui/ConfirmDialog.js";

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

export function ChatPane({ onClose }: { onClose: () => void }) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);
  const creatingInitialChatRef = useRef(false);
  const hydratedChatIdRef = useRef<string | null>(null);
  const hydratedChatUpdatedAtRef = useRef<string | null>(null);

  const { data: chats = [], isFetched: chatsFetched } = useChats();
  const { data: activeChat } = useChatById(activeChatId);
  const createChat = useCreateChat();
  const deleteChat = useDeleteChat();
  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    id: activeChatId ?? undefined,
  });
  const { data: chatInfo } = useChatInfo();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (!chatsFetched) return;
    if (activeChatId) {
      bootstrappedRef.current = true;
      return;
    }
    if (chats.length > 0) {
      setActiveChatId(chats[0].id);
      hydratedChatIdRef.current = null;
      bootstrappedRef.current = true;
      return;
    }
    if (creatingInitialChatRef.current) return;
    creatingInitialChatRef.current = true;
    bootstrappedRef.current = true;
    createChat.mutate(
      { source: "text" },
      {
        onSuccess: (created) => {
          setActiveChatId(created.id);
          hydratedChatIdRef.current = created.id;
          hydratedChatUpdatedAtRef.current = created.updatedAt;
          setMessages((created.messages ?? []) as UIMessage[]);
          creatingInitialChatRef.current = false;
        },
        onError: () => {
          creatingInitialChatRef.current = false;
          bootstrappedRef.current = false;
        },
      },
    );
  }, [activeChatId, chats, chatsFetched, createChat, setMessages]);

  useEffect(() => {
    if (!activeChat || !activeChatId) return;
    if (activeChat.id !== activeChatId) return;
    if (
      hydratedChatIdRef.current === activeChatId
      && hydratedChatUpdatedAtRef.current === activeChat.updatedAt
    ) {
      return;
    }
    setMessages((activeChat.messages ?? []) as UIMessage[]);
    hydratedChatIdRef.current = activeChatId;
    hydratedChatUpdatedAtRef.current = activeChat.updatedAt;
  }, [activeChat, activeChatId, setMessages]);

  const handleSubmit = async (e: React.FormEvent) => {
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

  return (
    <div className="flex flex-col h-full bg-sand-100 border-l border-sand-300">
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
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-sand-500 hover:text-sand-800 hover:bg-sand-200 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
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

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

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
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 resize-none rounded-lg bg-sand-200 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-500 focus:outline-none focus:ring-2 focus:ring-teal-300/50 min-h-[36px] max-h-[120px]"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="shrink-0 p-2 rounded-lg bg-blood-400 text-sand-50 hover:bg-blood-500 transition-colors cursor-pointer"
              title="Stop generating"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || !activeChatId}
              className="shrink-0 p-2 rounded-lg bg-teal-400 text-teal-900 hover:bg-teal-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
          hydratedChatIdRef.current = null;
          hydratedChatUpdatedAtRef.current = null;
          setActiveChatId(chatId);
          setHistoryOpen(false);
        }}
        onDeleteRequested={(chatId) => setDeleteTargetId(chatId)}
        onNewChat={() => {
          createChat.mutate(
            { source: "text" },
            {
              onSuccess: (created) => {
                hydratedChatIdRef.current = created.id;
                hydratedChatUpdatedAtRef.current = created.updatedAt;
                setActiveChatId(created.id);
                setMessages((created.messages ?? []) as UIMessage[]);
                setHistoryOpen(false);
              },
            },
          );
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
                hydratedChatIdRef.current = null;
                hydratedChatUpdatedAtRef.current = null;
                setActiveChatId(remaining[0].id);
              } else {
                const created = await createChat.mutateAsync({ source: "text" });
                hydratedChatIdRef.current = created.id;
                hydratedChatUpdatedAtRef.current = created.updatedAt;
                setActiveChatId(created.id);
                setMessages((created.messages ?? []) as UIMessage[]);
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

// ── Message Bubble ──────────────────────────────────────

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-teal-400 text-teal-900 rounded-br-sm"
            : "bg-sand-200 text-sand-800 rounded-bl-sm"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            if (isUser) {
              return (
                <span key={i} className="whitespace-pre-wrap break-words">
                  {part.text}
                </span>
              );
            }
            return (
              <div key={i} className="prose-chat">
                <MemoizedMarkdown content={part.text} id={`${message.id}-${i}`} />
              </div>
            );
          }

          if (isToolPart(part)) {
            return <ToolCallPart key={i} part={part as ToolPart} />;
          }

          return null;
        })}
      </div>
    </div>
  );
}


