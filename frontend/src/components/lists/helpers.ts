import type { ListColumn } from "../../api.js";

export const DEFAULT_COLUMNS: ListColumn[] = [
  { id: "backlog", name: "Backlog", collapsed: false },
  { id: "todo", name: "Todo", collapsed: false },
  { id: "done", name: "Done", collapsed: false },
  { id: "cancelled", name: "Cancelled", collapsed: false },
];

export function normalizeListId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function formatStatusLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusPillClass(statusId: string): string {
  const hash = [...statusId].reduce((acc, char) => acc + char.charCodeAt(0), 0) % 4;
  if (hash === 0) return "bg-teal-100 text-teal-800 border border-teal-200";
  if (hash === 1) return "bg-blue-100 text-blue-700 border border-blue-200";
  if (hash === 2) return "bg-violet-100 text-violet-700 border border-violet-200";
  return "bg-sand-200 text-sand-700 border border-sand-300";
}

export function sanitizeColumns(columns: ListColumn[]): ListColumn[] {
  const seen = new Set<string>();
  const next: ListColumn[] = [];
  for (const column of columns) {
    const id = column.id.trim();
    const name = column.name.trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    next.push({
      id,
      name,
      collapsed: Boolean(column.collapsed),
      icon: column.icon?.trim() || undefined,
    });
  }
  return next;
}

