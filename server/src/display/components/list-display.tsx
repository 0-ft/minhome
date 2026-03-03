import type { ReactElement } from "react";
import * as LucideStatic from "lucide-static";
import ReactMarkdown from "react-markdown";
import { z } from "zod";
import type { List } from "../../config/lists.js";
import { componentFailure, componentSuccess, type DisplayComponentResult } from "./component-result.js";

export const ListDisplayComponentConfigSchema = z.object({
  kind: z.literal("list_display"),
  list_id: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  max_items: z.number().int().positive().default(8),
  status_filter: z.array(z.string().trim().min(1)).optional(),
  item_font_size: z.number().int().positive().default(22),
});

export type ListDisplayComponentConfig = z.infer<typeof ListDisplayComponentConfigSchema>;

export interface ListProvider {
  getList(listId: string): List | undefined;
}

const KEBAB_ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function kebabToPascalCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function getLucideIconSvgByName(name: string | undefined): string | null {
  if (!name || !KEBAB_ICON_NAME_RE.test(name)) return null;
  const iconsByName = LucideStatic as Record<string, unknown>;
  const maybeSvg = iconsByName[kebabToPascalCase(name)];
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
          p: ({ children }) => <span tw="whitespace-pre-wrap">{children}</span>,
          em: ({ children }) => (
            <span tw="origin-left skew-x-[-12deg] not-italic font-normal">
              {children}
            </span>
          ),
          strong: ({ children }) => <strong tw="font-bold">{children}</strong>,
          code: ({ children }) => (
            <span tw="font-mono p-0 text-[1em] leading-[1.3] align-baseline text-inherit bg-transparent whitespace-pre-wrap">
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

export function createListDisplayElement(
  config: ListDisplayComponentConfig,
  listProvider: ListProvider,
): DisplayComponentResult {
  const list = listProvider.getList(config.list_id);
  if (!list) {
    return componentFailure(
      config.kind,
      "List not found",
      `No list exists with id "${config.list_id}"`,
    );
  }

  const titleFontSize = 18;
  const itemFontSize = config.item_font_size;
  const markerPx = Math.max(11, Math.round(itemFontSize * 0.72));

  const statusFilter = new Set(config.status_filter ?? []);
  const statusIconByStatus = new Map(list.columns.map((column) => [column.id, column.icon]));
  const sourceItems = statusFilter.size > 0
    ? list.items.filter((item) => statusFilter.has(item.statusId))
    : list.items;
  const items = sourceItems.slice(0, config.max_items);

  return componentSuccess(
    <div tw="font-sans flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden text-black">
      <div
        tw="font-bold leading-[1.2] whitespace-nowrap overflow-hidden text-ellipsis"
        style={{
          fontSize: titleFontSize,
          marginBottom: Math.max(6, Math.round(titleFontSize * 0.35)),
        }}
      >
        {config.title ?? list.name}
      </div>
      <div tw="flex flex-1 min-h-0 flex-col overflow-hidden gap-1">
        {items.length > 0 ? (
          items.map((item) => {
            const iconSvg = getLucideIconSvgByName(statusIconByStatus.get(item.statusId));
            const iconSrc = iconSvg ? svgToDataUri(iconSvg) : null;
            return (
              <div
                key={item.id}
                tw="flex flex-row items-start gap-1.5 leading-[1.3] whitespace-normal break-words shrink-0"
                style={{
                  fontSize: itemFontSize,
                }}
              >
                <div tw="flex items-center justify-center h-[1.3em] w-[1em] shrink-0">
                  {iconSrc ? (
                    <img
                      src={iconSrc}
                      width={markerPx}
                      height={markerPx}
                      style={{ display: "block", width: markerPx, height: markerPx }}
                    />
                  ) : (
                    <span tw="text-[0.9em] leading-none">{"\u2022"}</span>
                  )}
                </div>
                <div tw="flex-1 min-w-0 break-words">{renderInlineMarkdownTitle(item.title)}</div>
              </div>
            );
          })
        ) : (
          <div tw="leading-[1.3]" style={{ fontSize: itemFontSize }}>No items</div>
        )}
      </div>
    </div>,
  );
}
