import { ArrowLeft, Trash2 } from "lucide-react";
import type { ListColumn } from "../../api.js";
import { Button } from "../ui/button.js";
import { IconPicker } from "../ui/icon-picker.js";
import { Input } from "../ui/input.js";
import { Toggle } from "../ui/toggle.js";

function normalizeColumnId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getNextColumnId(columns: ListColumn[], proposedName: string): string | null {
  const base = normalizeColumnId(proposedName);
  if (!base) return null;
  const used = new Set(columns.map((column) => column.id));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

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
  saving,
}: {
  listName: string;
  onListNameChange: (value: string) => void;
  includeInPrompt: boolean;
  onIncludeInPromptChange: (checked: boolean) => void;
  columns: ListColumn[];
  onColumnsChange: (columns: ListColumn[]) => void;
  newColumnStatus: string;
  onNewColumnStatusChange: (value: string) => void;
  onBack?: () => void;
  saving?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-sand-700 hover:text-sand-900 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to lists
          </button>
        ) : <div />}
        {saving && (
          <span className="text-xs text-sand-500 font-mono">Saving…</span>
        )}
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
          disabled={saving}
        />
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-mono uppercase tracking-wider text-sand-500">
          Columns
        </div>
        <div className="space-y-2">
          {columns.map((column, idx) => (
            <div key={idx} className="rounded-md border border-sand-300 bg-sand-100/40 p-2 space-y-2">
              <div className="grid grid-cols-[1fr_220px_auto] gap-2 items-center">
                <Input
                  value={column.name}
                  onChange={(e) => {
                    onColumnsChange(columns.map((c, i) => (i === idx ? { ...c, name: e.target.value } : c)));
                  }}
                  placeholder="Status"
                  className="bg-sand-50 text-sand-900 border-sand-300 focus-visible:bg-sand-50"
                />
                <IconPicker
                  value={column.icon}
                  onChange={(icon) => {
                    onColumnsChange(columns.map((c, i) => (i === idx ? { ...c, icon } : c)));
                  }}
                />
                <button
                  type="button"
                  disabled={columns.length <= 1}
                  onClick={() => {
                    onColumnsChange(columns.filter((_, i) => i !== idx));
                  }}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md text-blood-300 hover:text-blood-500 hover:bg-sand-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Remove column"
                  aria-label="Remove column"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
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
              const nextId = getNextColumnId(columns, next);
              if (!nextId) return;
              onColumnsChange([...columns, { id: nextId, name: next, collapsed: false }]);
              onNewColumnStatusChange("");
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              const next = newColumnStatus.trim();
              if (!next) return;
              const nextId = getNextColumnId(columns, next);
              if (!nextId) return;
              onColumnsChange([...columns, { id: nextId, name: next, collapsed: false }]);
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

