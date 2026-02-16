import type { CSSProperties } from "react";
import { z } from "zod";
import type { TodoList } from "../../config/todos.js";
import { componentFailure, componentSuccess, type DisplayComponentResult } from "./component-result.js";

export const TodoDisplayComponentConfigSchema = z.object({
  kind: z.literal("todo_display"),
  list_id: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  max_items: z.number().int().positive().default(8),
  show_completed: z.boolean().default(false),
  border_width: z.number().positive().optional(),
  padding: z.number().nonnegative().optional(),
});

export type TodoDisplayComponentConfig = z.infer<typeof TodoDisplayComponentConfigSchema>;

export interface TodoListProvider {
  getTodoList(listId: string): TodoList | undefined;
}

function getCompletedStatuses(list: TodoList): Set<string> {
  // Only treat statuses as "completed-like" when they are explicitly configured on the list.
  const completed = new Set<string>();
  for (const column of list.columns) {
    const normalized = column.status.trim().toLowerCase();
    if (normalized === "done" || normalized === "cancelled") {
      completed.add(column.status);
    }
  }
  return completed;
}

function isOutstandingStatus(list: TodoList, status: TodoList["items"][number]["status"]): boolean {
  const completed = getCompletedStatuses(list);
  if (completed.size === 0) return true;
  return !completed.has(status);
}

function statusPrefix(list: TodoList, status: TodoList["items"][number]["status"]): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "done") return "[x]";
  if (normalized === "cancelled") return "[-]";
  if (normalized === "backlog") return "[ ]";
  if (normalized === "todo") return "[>]";
  return list.columns.some((column) => column.status === status) ? "[•]" : "[?]";
}

export function createTodoDisplayElement(
  config: TodoDisplayComponentConfig,
  todoProvider: TodoListProvider,
  width: number,
  height: number,
): DisplayComponentResult {
  const list = todoProvider.getTodoList(config.list_id);
  if (!list) {
    return componentFailure(
      config.kind,
      "Todo list not found",
      `No todo list exists with id "${config.list_id}"`,
    );
  }

  const borderWidth = Math.max(1, Math.round(config.border_width ?? 2));
  const padding = Math.max(0, Math.round(config.padding ?? 10));
  const baseSize = Math.min(width, height);
  const titleFontSize = Math.max(14, Math.round(baseSize * 0.12));
  const itemFontSize = Math.max(11, Math.round(baseSize * 0.075));
  const rowGap = Math.max(2, Math.round(itemFontSize * 0.25));

  const sourceItems = config.show_completed
    ? list.items
    : list.items.filter((item) => isOutstandingStatus(list, item.status));
  const items = sourceItems.slice(0, config.max_items);

  const containerStyle: CSSProperties = {
    width,
    height,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    border: `${borderWidth}px solid #000`,
    backgroundColor: "#fff",
    color: "#000",
    padding,
    fontFamily: "DejaVu Sans",
    overflow: "hidden",
  };

  const titleStyle: CSSProperties = {
    fontSize: titleFontSize,
    fontWeight: 700,
    lineHeight: 1.2,
    marginBottom: Math.max(6, Math.round(titleFontSize * 0.35)),
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const listStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: rowGap,
    overflow: "hidden",
    flex: 1,
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    gap: Math.max(4, Math.round(itemFontSize * 0.4)),
    fontSize: itemFontSize,
    lineHeight: 1.3,
    overflow: "hidden",
  };

  const rowPrefixStyle: CSSProperties = {
    flex: "0 0 auto",
    fontFamily: "DejaVu Sans Mono, monospace",
  };

  const rowTitleStyle: CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return componentSuccess(
    <div style={containerStyle}>
      <div style={titleStyle}>{config.title ?? list.name}</div>
      <div style={listStyle}>
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item.id} style={rowStyle}>
              <span style={rowPrefixStyle}>{statusPrefix(list, item.status)}</span>
              <span style={rowTitleStyle}>{item.title}</span>
            </div>
          ))
        ) : (
          <div style={rowStyle}>No items</div>
        )}
      </div>
    </div>,
  );
}
