import { X } from "lucide-react";
import type { PersistedChatSummary } from "../api.js";
import { ChatHistoryListContent } from "./chat/ChatHistoryListContent.js";

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
      <div className="relative w-full max-w-xl rounded-xl border border-grey-300 bg-grey-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-grey-300 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-grey-900">Chat history</h3>
            <p className="text-[11px] font-mono text-grey-500 mt-0.5">
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
              className="p-1.5 rounded-md text-grey-500 hover:text-grey-800 hover:bg-grey-200 transition-colors cursor-pointer"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <ChatHistoryListContent
          chats={chats}
          activeChatId={activeChatId}
          onSelect={onSelect}
          onDeleteRequested={onDeleteRequested}
          variant="regular"
        />
      </div>
    </div>
  );
}

