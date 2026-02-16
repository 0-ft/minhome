import type { TodoItem, TodoStatus } from "../../api.js";
import ReactMarkdown from "react-markdown";
import { StatusPicker } from "./StatusPicker.js";

export function ListItemCard({
  item,
  statusOptions,
  statusIconByStatus,
  onOpen,
  onStatusSet,
}: {
  item: TodoItem;
  statusOptions: TodoStatus[];
  statusIconByStatus?: Partial<Record<TodoStatus, string | undefined>>;
  onOpen: () => void;
  onStatusSet: (status: TodoStatus) => void;
}) {
  return (
    <div className="rounded-lg bg-sand-50 border border-sand-300 p-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="text-left min-w-0 flex-1 cursor-pointer hover:text-sand-700"
          onClick={onOpen}
        >
          <div className="text-sand-900 flex items-center gap-2 min-w-0">
            <span className="text-sm font-mono text-sand-500 shrink-0">#{item.id}</span>
            <div className="text-lg leading-snug font-medium min-w-0 truncate">
              <ReactMarkdown
                allowedElements={["p", "em", "strong", "code"]}
                components={{
                  p: ({ children }) => <span>{children}</span>,
                  code: ({ children }) => (
                    <code className="rounded bg-sand-200 px-1 py-0.5 text-[0.85em]">{children}</code>
                  ),
                }}
              >
                {item.title}
              </ReactMarkdown>
            </div>
          </div>
        </button>
        <StatusPicker
          value={item.status}
          options={statusOptions}
          iconByStatus={statusIconByStatus}
          onChange={onStatusSet}
        />
      </div>
    </div>
  );
}

