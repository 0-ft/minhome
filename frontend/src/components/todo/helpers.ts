import type { TodoColumn, TodoStatus } from "../../api.js";

export const DEFAULT_COLUMNS: TodoColumn[] = [
  { status: "backlog", collapsed: false },
  { status: "todo", collapsed: false },
  { status: "done", collapsed: false },
  { status: "cancelled", collapsed: false },
];

export function normalizeListId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function formatStatusLabel(status: TodoStatus): string {
  return status
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusPillClass(status: TodoStatus): string {
  const hash = [...status].reduce((acc, char) => acc + char.charCodeAt(0), 0) % 4;
  if (hash === 0) return "bg-teal-100 text-teal-800 border border-teal-200";
  if (hash === 1) return "bg-blue-100 text-blue-700 border border-blue-200";
  if (hash === 2) return "bg-violet-100 text-violet-700 border border-violet-200";
  return "bg-sand-200 text-sand-700 border border-sand-300";
}

export function sanitizeColumns(columns: TodoColumn[]): TodoColumn[] {
  const seen = new Set<string>();
  const next: TodoColumn[] = [];
  for (const column of columns) {
    const status = column.status.trim();
    if (!status || seen.has(status)) continue;
    seen.add(status);
    next.push({
      status,
      collapsed: Boolean(column.collapsed),
      icon: column.icon?.trim() || undefined,
    });
  }
  return next;
}

