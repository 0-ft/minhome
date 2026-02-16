import { ArrowLeft } from "lucide-react";
import type { TodoColumn } from "../../api.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Toggle } from "../ui/toggle.js";
import { sanitizeColumns } from "./helpers.js";

export function ListSettingsView({
  listName,
  onListNameChange,
  includeInPrompt,
  onIncludeInPromptChange,
  columns,
  onColumnsChange,
  newColumnStatus,
  onNewColumnStatusChange,
  onBack,
  onSave,
  pending,
}: {
  listName: string;
  onListNameChange: (value: string) => void;
  includeInPrompt: boolean;
  onIncludeInPromptChange: (checked: boolean) => void;
  columns: TodoColumn[];
  onColumnsChange: (columns: TodoColumn[]) => void;
  newColumnStatus: string;
  onNewColumnStatusChange: (value: string) => void;
  onBack?: () => void;
  onSave: () => void;
  pending: boolean;
}) {
  return (
    <div className="rounded-xl border border-sand-300 bg-sand-50 p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-sand-700 hover:text-sand-900 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to todos
          </button>
        ) : <div />}
        <Button
          disabled={pending || listName.trim().length === 0 || sanitizeColumns(columns).length === 0}
          onClick={onSave}
        >
          Save settings
        </Button>
      </div>

      <div>
        <label className="block text-[11px] font-mono uppercase tracking-wider text-sand-500 mb-1">
          List name
        </label>
        <Input
          value={listName}
          onChange={(e) => onListNameChange(e.target.value)}
          placeholder="List name"
          className="bg-sand-50 text-sand-900 border-sand-300 focus-visible:bg-sand-50"
        />
      </div>

      <div className="flex items-center justify-between rounded-lg bg-sand-100/70 border border-sand-300 px-3 py-2">
        <span className="text-sm text-sand-800">Include in AI prompt</span>
        <Toggle
          checked={includeInPrompt}
          onCheckedChange={onIncludeInPromptChange}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-mono uppercase tracking-wider text-sand-500">
          Columns
        </div>
        <div className="space-y-2">
          {columns.map((column, idx) => (
            <div key={`${column.status}-${idx}`} className="rounded-md border border-sand-300 bg-sand-100/40 p-2 space-y-2">
              <div className="grid grid-cols-[1fr_140px] gap-2">
                <Input
                  value={column.status}
                  onChange={(e) => {
                    onColumnsChange(columns.map((c, i) => (i === idx ? { ...c, status: e.target.value } : c)));
                  }}
                  placeholder="Status"
                  className="bg-sand-50 text-sand-900 border-sand-300 focus-visible:bg-sand-50"
                />
                <Input
                  value={column.icon ?? ""}
                  onChange={(e) => {
                    onColumnsChange(columns.map((c, i) => (i === idx ? { ...c, icon: e.target.value } : c)));
                  }}
                  placeholder="Icon (optional)"
                  className="bg-sand-50 text-sand-900 border-sand-300 focus-visible:bg-sand-50"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-sand-800">
                  <span>Collapsed by default</span>
                  <Toggle
                    checked={Boolean(column.collapsed)}
                    onCheckedChange={(checked) => {
                      onColumnsChange(columns.map((c, i) => (i === idx ? { ...c, collapsed: checked } : c)));
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={columns.length <= 1}
                  onClick={() => {
                    onColumnsChange(columns.filter((_, i) => i !== idx));
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newColumnStatus}
            onChange={(e) => onNewColumnStatusChange(e.target.value)}
            placeholder="Add column status"
            className="bg-sand-50 text-sand-900 border-sand-300 focus-visible:bg-sand-50"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const next = newColumnStatus.trim();
              if (!next) return;
              onColumnsChange([...columns, { status: next, collapsed: false }]);
              onNewColumnStatusChange("");
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              const next = newColumnStatus.trim();
              if (!next) return;
              onColumnsChange([...columns, { status: next, collapsed: false }]);
              onNewColumnStatusChange("");
            }}
          >
            Add column
          </Button>
        </div>
      </div>
    </div>
  );
}

