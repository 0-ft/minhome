import { Plus, ChevronRight } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ViewTransition } from "react";
import type { ListItem } from "../../api.js";
import { LucideIcon } from "./LucideIcon.js";
import { EditableText } from "../ui/editable-text.js";

function KanbanCard({
  listId,
  item,
  statusIcon,
  onOpen,
  onSaveTitle,
  cardViewTransitionName,
  titleViewTransitionName,
}: {
  listId: string;
  item: ListItem;
  statusIcon?: string;
  onOpen: () => void;
  onSaveTitle: (nextTitle: string) => void;
  cardViewTransitionName?: string;
  titleViewTransitionName?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `list-item:${listId}:${item.id}`,
    data: { itemId: item.id, statusId: item.statusId },
  });

  const style = {
    transform: isDragging ? undefined : CSS.Translate.toString(transform),
  };

  const cardBody = (
    <div className={`rounded-md bg-sand-50 border border-sand-300 p-2 transition-colors duration-200 transition-shadow duration-200 ${isDragging ? "shadow-lg" : "shadow-sm"} hover:bg-sand-100`}>
      <div
        className="w-full text-left cursor-pointer hover:text-sand-700"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        {titleViewTransitionName ? (
          <div className="text-sand-900 min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[10px] leading-none uppercase tracking-wider text-sand-500 mb-1">
              <LucideIcon name={statusIcon} className="h-3 w-3" />
              <span className="leading-none">{item.id}</span>
            </div>
            <ViewTransition name={titleViewTransitionName} share={titleViewTransitionName}>
              <EditableText
                value={item.title}
                onSave={onSaveTitle}
                fullWidth={false}
                textClassName="text-sm leading-snug font-medium text-sand-900"
              />
            </ViewTransition>
          </div>
        ) : (
          <div className="text-sand-900 min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[10px] leading-none uppercase tracking-wider text-sand-500 mb-1">
              <LucideIcon name={statusIcon} className="h-3 w-3" />
              <span className="leading-none">{item.id}</span>
            </div>
            <EditableText
              value={item.title}
              onSave={onSaveTitle}
              fullWidth={false}
              textClassName="text-sm leading-snug font-medium text-sand-900"
            />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing ${isDragging ? "opacity-0" : ""}`}
    >
      {cardViewTransitionName ? (
        <ViewTransition name={cardViewTransitionName} share="list-card-share">
          {cardBody}
        </ViewTransition>
      ) : (
        cardBody
      )}
    </div>
  );
}

export function KanbanColumn({
  listId,
  statusId,
  label,
  icon,
  collapsed,
  items,
  onAddItem,
  onOpenItem,
  onSaveItemTitle,
  onToggleCollapse,
  getCardTransitionName,
  getTitleTransitionName,
}: {
  listId: string;
  statusId: string;
  label: string;
  icon?: string;
  collapsed: boolean;
  items: ListItem[];
  onAddItem: (statusId: string) => void;
  onOpenItem: (itemId: number) => void;
  onSaveItemTitle: (itemId: number, nextTitle: string) => void;
  onToggleCollapse: (statusId: string) => void;
  getCardTransitionName?: (itemId: number) => string;
  getTitleTransitionName?: (itemId: number) => string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `list-column:${statusId}`,
    data: { statusId },
  });

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={`h-full min-h-[320px] w-12 shrink-0 rounded-lg transition-colors ${
          isOver ? "bg-teal-100" : "bg-sand-200/50"
        }`}
      >
        <button
          type="button"
          className="h-full w-full flex items-center justify-center cursor-pointer text-sand-700 hover:text-sand-900"
          onClick={() => onToggleCollapse(statusId)}
          title={`Expand ${label}`}
        >
          <div className="-rotate-90 whitespace-nowrap inline-flex items-center gap-1.5 text-sm font-semibold">
            <ChevronRight className="h-4 w-4" />
            <LucideIcon name={icon} className="h-4 w-4" />
            <span>{label}</span>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`w-80 h-full min-h-0 shrink-0 rounded-lg p-3 transition-colors flex flex-col ${
        isOver ? "bg-teal-100" : "bg-sand-200/50"
      }`}
    >
      <div className="flex items-center justify-between mb-2 shrink-0">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-sand-900 cursor-pointer hover:text-sand-700"
          onClick={() => onToggleCollapse(statusId)}
        >
          <LucideIcon name={icon} className="h-4 w-4" />
          <span>{label}</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-sand-600">{items.length}</span>
          <button
            type="button"
            onClick={() => onAddItem(statusId)}
            className="h-6 w-6 inline-flex items-center justify-center rounded-md bg-sand-200 text-sand-600 hover:bg-sand-300 hover:text-sand-800 transition-colors cursor-pointer"
            title={`Add item to ${label}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="scrollbar-outside space-y-2 min-h-0 flex-1 overflow-y-auto">
        {items.map((item) => (
          <KanbanCard
            key={`${listId}:${item.id}`}
            listId={listId}
            item={item}
            statusIcon={icon}
            onOpen={() => onOpenItem(item.id)}
            onSaveTitle={(nextTitle) => onSaveItemTitle(item.id, nextTitle)}
            cardViewTransitionName={getCardTransitionName?.(item.id)}
            titleViewTransitionName={getTitleTransitionName?.(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

