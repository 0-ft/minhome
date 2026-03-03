import { Search } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";
import { LucideIcon } from "./LucideIcon.js";

export function ItemFilterRow({
  viewMode,
  statusFilter,
  statusFilters,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
}: {
  viewMode: "list" | "kanban";
  statusFilter: string[];
  statusFilters: Array<{ id: string; label: string; icon?: string }>;
  onStatusFilterChange: (next: string[]) => void;
  searchQuery: string;
  onSearchQueryChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {viewMode === "list" && (
        <ToggleGroup
          type="multiple"
          value={statusFilter}
          onValueChange={(value) => {
            const next = Array.isArray(value) ? value as string[] : [];
            onStatusFilterChange(next);
          }}
        >
          {statusFilters.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className="px-3 py-1">
              <span className="inline-flex items-center gap-1.5">
                <LucideIcon name={f.icon} className="h-3 w-3" />
                <span>{f.label}</span>
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sand-400 pointer-events-none" />
        <input
          type="text"
          className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-sand-100 border border-sand-300 text-sm text-sand-800 placeholder:text-sand-400 focus:outline-none focus:bg-sand-50 transition-colors"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Filter items..."
        />
      </div>
    </div>
  );
}

