import type { TodoStatus } from "../../api.js";
import { Search } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";
import { LucideIcon } from "./LucideIcon.js";

export function ItemFilterRow({
  viewMode,
  statusFilter,
  statusFilters,
  statusIconByStatus,
  statusOptions,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
}: {
  viewMode: "list" | "kanban";
  statusFilter: TodoStatus[];
  statusFilters: Array<{ id: TodoStatus; label: string }>;
  statusIconByStatus?: Partial<Record<TodoStatus, string | undefined>>;
  statusOptions: TodoStatus[];
  onStatusFilterChange: (next: TodoStatus[]) => void;
  searchQuery: string;
  onSearchQueryChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {viewMode === "list" ? (
        <ToggleGroup
          type="multiple"
          value={statusFilter}
          onValueChange={(value) => {
            const next = Array.isArray(value) ? value as TodoStatus[] : [];
            onStatusFilterChange(next.length > 0 ? next : statusOptions);
          }}
        >
          {statusFilters.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className="px-3 py-1 text-[11px]">
              <span className="inline-flex items-center gap-1.5">
                <LucideIcon name={statusIconByStatus?.[f.id]} className="h-3 w-3" />
                <span>{f.label}</span>
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : <div />}
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sand-400 pointer-events-none" />
        <input
          type="text"
          className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-sand-50 border border-sand-300 text-sm text-sand-800 placeholder:text-sand-400 focus:outline-none focus:ring-2 focus:ring-teal-300/50"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Filter items..."
        />
      </div>
    </div>
  );
}

