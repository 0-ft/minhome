import type { ListItem } from "../../api.js";
import { ViewTransition } from "react";
import ReactMarkdown from "react-markdown";
import { LucideIcon } from "./LucideIcon.js";
import { StatusPicker, type StatusOption } from "./StatusPicker.js";

export function ListItemCard({
  item,
  cardViewTransitionName,
  titleViewTransitionName,
  statusViewTransitionName,
  statusOptions,
  onOpen,
  onStatusSet,
}: {
  item: ListItem;
  cardViewTransitionName?: string;
  titleViewTransitionName?: string;
  statusViewTransitionName?: string;
  statusOptions: StatusOption[];
  onOpen: () => void;
  onStatusSet: (statusId: string) => void;
}) {
  const activeStatus = statusOptions.find((option) => option.id === item.statusId);

  const cardBody = (
    <div className="rounded-lg bg-sand-50 border border-sand-300 p-3 h-fit transition-colors duration-200 hover:bg-sand-100/80">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="text-left min-w-0 flex-1 cursor-pointer hover:text-sand-700"
          onClick={onOpen}
        >
          <div className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-sand-500 mb-1">
            <LucideIcon name={activeStatus?.icon} className="h-3 w-3" />
            <span>#{item.id}</span>
          </div>
          {titleViewTransitionName ? (
            <ViewTransition name={titleViewTransitionName} share="list-title-share">
              <div className="text-sand-900 min-w-0">
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
            <div className="text-sand-900 min-w-0">
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
          <ViewTransition name={statusViewTransitionName} share="list-status-share">
            <StatusPicker
              value={item.statusId}
              options={statusOptions}
              onChange={onStatusSet}
            />
          </ViewTransition>
        ) : (
          <StatusPicker
            value={item.statusId}
            options={statusOptions}
            onChange={onStatusSet}
          />
        )}
      </div>
    </div>
  );

  if (cardViewTransitionName) {
    return (
      <ViewTransition name={cardViewTransitionName} share="list-card-share">
        {cardBody}
      </ViewTransition>
    );
  }

  return (
    cardBody
  );
}

