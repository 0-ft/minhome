import type { CSSProperties, ReactElement } from "react";
import * as LucideStatic from "lucide-static";
import ReactMarkdown from "react-markdown";
import { z } from "zod";
import type { TodoList } from "../../config/todos.js";
import { componentFailure, componentSuccess, type DisplayComponentResult } from "./component-result.js";

export const TodoDisplayComponentConfigSchema = z.object({
  kind: z.literal("todo_display"),
  list_id: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  max_items: z.number().int().positive().default(8),
  status_filter: z.array(z.string().trim().min(1)).optional(),
});

export type TodoDisplayComponentConfig = z.infer<typeof TodoDisplayComponentConfigSchema>;

export interface TodoListProvider {
  getTodoList(listId: string): TodoList | undefined;
}

function getLucideIconSvgByName(name: string | undefined): string | null {
  if (!name) return null;
  const maybeSvg = (LucideStatic as Record<string, unknown>)[name];
  if (typeof maybeSvg !== "string") return null;
  return maybeSvg.replaceAll("currentColor", "#000");
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function renderInlineMarkdownTitle(title: string): ReactElement {
  try {
    return (
      <ReactMarkdown
        allowedElements={["p", "em", "strong", "code"]}
        unwrapDisallowed
        skipHtml
        components={{
          p: ({ children }) => <span style={{ whiteSpace: "pre" }}>{children}</span>,
          em: ({ children }) => (
            <span
              style={{
                transform: "skewX(-12deg)",
                transformOrigin: "left center",
                fontStyle: "normal",
                fontWeight: 400,
              }}
            >
              {children}
            </span>
          ),
          strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
          code: ({ children }) => (
            <span
              style={{
                fontFamily: "DejaVu Sans Mono",
                padding: 0,
                fontSize: "1em",
                lineHeight: "1.3",
                verticalAlign: "baseline",
                color: "inherit",
                backgroundColor: "transparent",
                whiteSpace: "pre",
              }}
            >
              {children}
            </span>
          ),
        }}
      >
        {title}
      </ReactMarkdown>
    );
  } catch {
    return <span>{title}</span>;
  }
}

export function createTodoDisplayElement(
  config: TodoDisplayComponentConfig,
  todoProvider: TodoListProvider,
): DisplayComponentResult {
  const list = todoProvider.getTodoList(config.list_id);
  if (!list) {
    return componentFailure(
      config.kind,
      "Todo list not found",
      `No todo list exists with id "${config.list_id}"`,
    );
  }

  const titleFontSize = 18;
  const itemFontSize = 22;
  const rowGap = 4;

  const statusFilter = new Set(config.status_filter ?? []);
  const statusIconByStatus = new Map(list.columns.map((column) => [column.status, column.icon]));
  const sourceItems = statusFilter.size > 0
    ? list.items.filter((item) => statusFilter.has(item.status))
    : list.items;
  const items = sourceItems.slice(0, config.max_items);

  const containerStyle: CSSProperties = {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "column",
    color: "#000",
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
    alignItems: "center",
    gap: 6,
    fontSize: itemFontSize,
    lineHeight: 1.3,
    overflow: "hidden",
  };

  const rowIconWrapStyle: CSSProperties = {
    flex: "0 0 auto",
    width: itemFontSize,
    height: itemFontSize,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const rowTitleStyle: CSSProperties = {
    display: "block",
    flex: 1,
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
          items.map((item) => {
            const iconSvg = getLucideIconSvgByName(statusIconByStatus.get(item.status));
            const iconSrc = iconSvg ? svgToDataUri(iconSvg) : null;
            return (
              <div key={item.id} style={rowStyle}>
                <span style={rowIconWrapStyle}>
                  {iconSrc ? (
                    <img
                      src={iconSrc}
                      width={itemFontSize}
                      height={itemFontSize}
                      style={{ display: "block" }}
                    />
                  ) : null}
                </span>
                <span style={rowTitleStyle}>{renderInlineMarkdownTitle(item.title)}</span>
              </div>
            );
          })
        ) : (
          <div style={rowStyle}>No items</div>
        )}
      </div>
    </div>,
  );
}
