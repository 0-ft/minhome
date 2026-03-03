import { Clock3, MessageSquare, Mic, Trash2 } from "lucide-react";
import type { PersistedChatSummary } from "../../api.js";

function formatUpdatedAt(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

type Variant = "regular" | "roomFull";

const variantStyles: Record<Variant, {
  list: string;
  empty: string;
  emptyText: string;
  rowBase: string;
  rowActive: string;
  rowIdle: string;
  title: string;
  meta: string;
  deleteButton: string;
}> = {
  regular: {
    list: "max-h-[60vh] overflow-y-auto p-3 space-y-2",
    empty: "rounded-lg border border-sand-300 bg-sand-50 px-3 py-4 text-center",
    emptyText: "text-sm text-sand-700",
    rowBase: "rounded-lg border px-3 py-2",
    rowActive: "border-teal-400/70 bg-teal-100/50",
    rowIdle: "border-sand-300 bg-sand-50",
    title: "text-sm font-medium text-sand-900 break-words",
    meta: "mt-1 flex items-center gap-3 text-[11px] font-mono text-sand-500",
    deleteButton: "mt-0.5 p-1.5 rounded-md text-blood-500 hover:bg-blood-500/10 transition-colors cursor-pointer",
  },
  roomFull: {
    list: "max-h-[60vh] overflow-y-auto p-3 space-y-2",
    empty: "rounded-lg border border-white/[0.08] bg-black/20 px-3 py-4 text-center",
    emptyText: "text-sm text-sand-400",
    rowBase: "rounded-lg border px-3 py-2 backdrop-blur-sm",
    rowActive: "border-teal-400/35 bg-teal-400/10",
    rowIdle: "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]",
    title: "text-sm font-medium text-sand-100 break-words",
    meta: "mt-1 flex items-center gap-3 text-[11px] font-mono text-sand-500/90",
    deleteButton: "mt-0.5 p-1.5 rounded-md text-blood-300/90 hover:bg-blood-500/20 transition-colors cursor-pointer",
  },
};

export function ChatHistoryListContent({
  chats,
  activeChatId,
  onSelect,
  onDeleteRequested,
  variant = "regular",
}: {
  chats: PersistedChatSummary[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onDeleteRequested?: (chatId: string) => void;
  variant?: Variant;
}) {
  const styles = variantStyles[variant];

  return (
    <div className={styles.list}>
      {chats.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyText}>No saved chats yet.</p>
        </div>
      )}

      {chats.map((chat) => {
        const isActive = chat.id === activeChatId;
        const label = chat.title?.trim() || "Untitled chat";
        return (
          <div
            key={chat.id}
            className={`${styles.rowBase} ${isActive ? styles.rowActive : styles.rowIdle}`}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                className="text-left flex-1 cursor-pointer"
                onClick={() => onSelect(chat.id)}
              >
                <p className={styles.title}>{label}</p>
                <div className={styles.meta}>
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

              {onDeleteRequested && (
                <button
                  type="button"
                  className={styles.deleteButton}
                  title="Delete chat"
                  onClick={() => onDeleteRequested(chat.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
