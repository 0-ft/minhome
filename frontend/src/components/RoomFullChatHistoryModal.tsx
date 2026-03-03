import { Plus, X } from "lucide-react";
import type { PersistedChatSummary } from "../api.js";
import { ChatHistoryListContent } from "./chat/ChatHistoryListContent.js";

export function RoomFullChatHistoryModal({
  open,
  chats,
  activeChatId,
  onClose,
  onSelect,
  onNewChat,
}: {
  open: boolean;
  chats: PersistedChatSummary[];
  activeChatId: string | null;
  onClose: () => void;
  onSelect: (chatId: string) => void;
  onNewChat: () => void | Promise<void>;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px] cursor-default"
        onClick={onClose}
        aria-label="Close chat history"
      />

      <div className="relative w-full max-w-xl rounded-xl border border-white/[0.1] bg-[#13100d]/95 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-sand-100">Chat history</h3>
            <p className="text-[11px] font-mono text-sand-500/90 mt-0.5">
              Resume saved room chats
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-400/15 border border-teal-400/20 px-2.5 py-1.5 text-xs font-medium text-teal-200 hover:bg-teal-400/25 transition-colors cursor-pointer"
              onClick={onNewChat}
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>
            <button
              type="button"
              className="p-1.5 rounded-md text-sand-500 hover:text-sand-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
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
          variant="roomFull"
        />
      </div>
    </div>
  );
}
