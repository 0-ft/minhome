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
          p: ({ children }) => <span>{children}</span>,
          em: ({ children }) => <em>{children}</em>,
          strong: ({ children }) => <strong>{children}</strong>,
          code: ({ children }) => <code>{children}</code>,
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

  const statusFilter = new Set(config.status_filter ?? []);
  const statusIconByStatus = new Map(list.columns.map((column) => [column.id, column.icon]));
  const sourceItems = statusFilter.size > 0
    ? list.items.filter((item) => statusFilter.has(item.statusId))
    : list.items;
  const items = sourceItems.slice(0, config.max_items);

  // Type sizing is the framework's job now -- it scales from the device profile,
  // which is why the old item_font_size knob is gone.
  return componentSuccess(
    <div className="flex flex--col gap--small">
      <span className="title title--small">{config.title ?? list.name}</span>
      {items.length > 0
        ? items.map((item) => {
            const iconSvg = getLucideIconSvgByName(statusIconByStatus.get(item.statusId));
            const iconSrc = iconSvg ? svgToDataUri(iconSvg) : null;
            return (
              // The icon sits inside the text's own line box rather than in a
              // sibling flex column, so `vertical-align: middle` aligns it to the
              // first line's midline -- the browser derives that from the font,
              // with no line-height constants for us to get wrong or re-tune per
              // device. The negative text-indent against the padding gives the
              // hanging indent, so wrapped lines clear the icon.
              <div className="item" key={item.id}>
                <div className="content">
                  <span
                    // font--regular keeps the 16px TRMNL16 size but drops the
                    // bold that `title` carries by design; list entries are not
                    // headings. Utilities are the last cascade layer, so it wins.
                    className="title title--small font--regular"
                    style={{ display: "block", paddingLeft: "1.6em", textIndent: "-1.6em" }}
                  >
                    {iconSrc ? (
                      <img
                        src={iconSrc}
                        alt=""
                        style={{
                          width: "1em",
                          height: "1em",
                          marginRight: "0.6em",
                          verticalAlign: "middle",
                        }}
                      />
                    ) : null}
                    {renderInlineMarkdownTitle(item.title)}
                  </span>
                </div>
              </div>
            );
          })
        : <span className="description">No items</span>}
    </div>,
  );
}
