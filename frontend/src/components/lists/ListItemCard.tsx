import type { ListItem } from "../../api.js";
import { ViewTransition } from "react";
import { LucideIcon } from "./LucideIcon.js";
import { StatusPicker, type StatusOption } from "./StatusPicker.js";
import { EditableText } from "../ui/editable-text.js";

export function ListItemCard({
  item,
  cardViewTransitionName,
  titleViewTransitionName,
  statusViewTransitionName,
  statusOptions,
  onOpen,
  onStatusSet,
  onSaveTitle,
}: {
  item: ListItem;
  cardViewTransitionName?: string;
  titleViewTransitionName?: string;
  statusViewTransitionName?: string;
  statusOptions: StatusOption[];
  onOpen: () => void;
  onStatusSet: (statusId: string) => void;
  onSaveTitle: (nextTitle: string) => void;
}) {
  const activeStatus = statusOptions.find((option) => option.id === item.statusId);

  const cardBody = (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-sand-100/60 cursor-pointer"
      onClick={onOpen}
    >
      <div className="min-w-0">
        <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sand-500 mb-1">
          <LucideIcon name={activeStatus?.icon} className="h-3 w-3" />
          <span>{item.id}</span>
        </div>
        {titleViewTransitionName ? (
          <ViewTransition name={titleViewTransitionName} share={titleViewTransitionName}>
            <EditableText
              value={item.title}
              onSave={onSaveTitle}
              textClassName="text-sm leading-snug font-medium text-sand-900"
            />
          </ViewTransition>
        ) : (
          <EditableText
            value={item.title}
            onSave={onSaveTitle}
            textClassName="text-sm leading-snug font-medium text-sand-900"
          />
        )}
      </div>
      <div className="justify-self-end" onClick={(e) => e.stopPropagation()}>
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

