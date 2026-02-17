import { Plus, ChevronRight } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { TodoItem, TodoStatus } from "../../api.js";
import { LucideIcon } from "./LucideIcon.js";

function KanbanCard({
  listId,
  item,
  onOpen,
}: {
  listId: string;
  item: TodoItem;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `todo-item:${listId}:${item.id}`,
    data: { itemId: item.id, status: item.status },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="rounded-md bg-sand-50 border border-sand-300 p-2 cursor-grab active:cursor-grabbing shadow-sm"
    >
      <button
        type="button"
        className="w-full text-left cursor-pointer hover:text-sand-700"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <div className="text-sm text-sand-900 flex items-baseline gap-2">
          <span className="text-xs font-mono text-sand-500">#{item.id}</span>
          <span>{item.title}</span>
        </div>
      </button>
    </div>
  );
}

export function KanbanColumn({
  listId,
  status,
  label,
  icon,
  collapsed,
  items,
  onAddItem,
  onOpenItem,
  onToggleCollapse,
}: {
  listId: string;
  status: TodoStatus;
  label: string;
  icon?: string;
  collapsed: boolean;
  items: TodoItem[];
  onAddItem: (status: TodoStatus) => void;
  onOpenItem: (itemId: number) => void;
  onToggleCollapse: (status: TodoStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `todo-column:${status}`,
    data: { status },
  });

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={`h-[320px] w-12 shrink-0 rounded-lg border transition-colors ${
          isOver
            ? "border-teal-300/80 bg-teal-50"
            : "border-sand-300 bg-sand-100/70"
        }`}
      >
        <button
          type="button"
          className="h-full w-full flex items-center justify-center cursor-pointer text-sand-700 hover:text-sand-900"
          onClick={() => onToggleCollapse(status)}
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
      className={`w-80 shrink-0 rounded-lg border p-3 transition-colors ${
        isOver
          ? "border-teal-300/80 bg-teal-50"
          : "border-sand-300 bg-sand-100/70"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-sand-900 cursor-pointer hover:text-sand-700"
          onClick={() => onToggleCollapse(status)}
        >
          <LucideIcon name={icon} className="h-4 w-4" />
          <span>{label}</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-sand-600">{items.length}</span>
          <button
            type="button"
            onClick={() => onAddItem(status)}
            className="h-6 w-6 inline-flex items-center justify-center rounded-md bg-sand-200 text-sand-600 hover:bg-sand-300 hover:text-sand-800 transition-colors cursor-pointer"
            title={`Add item to ${label}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-2 min-h-20">
        {items.map((item) => (
          <KanbanCard
            key={item.id}
            listId={listId}
            item={item}
            onOpen={() => onOpenItem(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

