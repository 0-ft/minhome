import type { TodoItem, TodoStatus } from "../../api.js";
import { ViewTransition } from "react";
import ReactMarkdown from "react-markdown";
import { StatusPicker } from "./StatusPicker.js";

export function ListItemCard({
  item,
  cardViewTransitionName,
  titleViewTransitionName,
  statusViewTransitionName,
  statusOptions,
  statusIconByStatus,
  onOpen,
  onStatusSet,
}: {
  item: TodoItem;
  cardViewTransitionName?: string;
  titleViewTransitionName?: string;
  statusViewTransitionName?: string;
  statusOptions: TodoStatus[];
  statusIconByStatus?: Partial<Record<TodoStatus, string | undefined>>;
  onOpen: () => void;
  onStatusSet: (status: TodoStatus) => void;
}) {
  const cardBody = (
    <div className="rounded-lg bg-sand-50 border border-sand-300 p-3 h-fit">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="text-left min-w-0 flex-1 cursor-pointer hover:text-sand-700"
          onClick={onOpen}
        >
          {titleViewTransitionName ? (
            <ViewTransition name={titleViewTransitionName} share="todo-title-share">
              <div className="text-sand-900 flex items-center gap-2 min-w-0 w-fit">
                <span className="text-lg leading-snug font-medium font-mono text-sand-500 shrink-0">#{item.id}</span>
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
            </ViewTransition>
          ) : (
            <div className="text-sand-900 flex items-center gap-2 min-w-0">
              <span className="text-lg leading-snug font-medium font-mono text-sand-500 shrink-0">#{item.id}</span>
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
          )}
        </button>
        {statusViewTransitionName ? (
          <ViewTransition name={statusViewTransitionName} share="todo-status-share">
            <StatusPicker
              value={item.status}
              options={statusOptions}
              iconByStatus={statusIconByStatus}
              onChange={onStatusSet}
            />
          </ViewTransition>
        ) : (
          <StatusPicker
            value={item.status}
            options={statusOptions}
            iconByStatus={statusIconByStatus}
            onChange={onStatusSet}
          />
        )}
      </div>
    </div>
  );

  if (cardViewTransitionName) {
    return (
      <ViewTransition name={cardViewTransitionName} share="todo-card-share">
        {cardBody}
      </ViewTransition>
    );
  }

  return (
    cardBody
  );
}

