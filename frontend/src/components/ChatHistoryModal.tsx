import { Clock3, MessageSquare, Mic, Trash2, X } from "lucide-react";
import type { PersistedChatSummary } from "../api.js";

function formatUpdatedAt(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export function ChatHistoryModal({
  open,
  chats,
  activeChatId,
  onClose,
  onSelect,
  onDeleteRequested,
  onNewChat,
}: {
  open: boolean;
  chats: PersistedChatSummary[];
  activeChatId: string | null;
  onClose: () => void;
  onSelect: (chatId: string) => void;
  onDeleteRequested: (chatId: string) => void;
  onNewChat: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 cursor-default"
        onClick={onClose}
        aria-label="Close chat history"
      />
      <div className="relative w-full max-w-xl rounded-xl border border-sand-300 bg-sand-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-sand-300 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-sand-900">Chat history</h3>
            <p className="text-[11px] font-mono text-sand-500 mt-0.5">
              Resume or delete saved chats
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-teal-300/70 px-2.5 py-1.5 text-xs font-medium text-teal-900 hover:bg-teal-300 transition-colors cursor-pointer"
              onClick={onNewChat}
            >
              New chat
            </button>
            <button
              type="button"
              className="p-1.5 rounded-md text-sand-500 hover:text-sand-800 hover:bg-sand-200 transition-colors cursor-pointer"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
          {chats.length === 0 && (
            <div className="rounded-lg border border-sand-300 bg-sand-50 px-3 py-4 text-center">
              <p className="text-sm text-sand-700">No saved chats yet.</p>
            </div>
          )}

          {chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            const label = chat.title?.trim() || "Untitled chat";
            return (
              <div
                key={chat.id}
                className={`rounded-lg border px-3 py-2 ${
                  isActive ? "border-teal-400/70 bg-teal-100/50" : "border-sand-300 bg-sand-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="text-left flex-1 cursor-pointer"
                    onClick={() => onSelect(chat.id)}
                  >
                    <p className="text-sm font-medium text-sand-900 break-words">{label}</p>
                    <div className="mt-1 flex items-center gap-3 text-[11px] font-mono text-sand-500">
                      <span className="inline-flex items-center gap-1">
                        {chat.source === "voice" ? <Mic className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                        {chat.source}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        {formatUpdatedAt(chat.updatedAt)}
                      </span>
                      <span>{chat.messageCount} msg</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="mt-0.5 p-1.5 rounded-md text-blood-500 hover:bg-blood-500/10 transition-colors cursor-pointer"
                    title="Delete chat"
                    onClick={() => onDeleteRequested(chat.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

