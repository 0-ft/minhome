import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { TodoColumn, TodoList } from "../../api.js";
import { Button } from "../ui/button.js";
import { ListSettingsView } from "./ListSettingsView.js";
import { sanitizeColumns } from "./helpers.js";

export function TodoConfigView({
  lists,
  activeListId,
  expandedListId,
  onExpandedListChange,
  onCreateListRequested,
  onSaveList,
  onDeleteList,
  savePending,
  deletePending,
}: {
  lists: TodoList[];
  activeListId: string | null;
  expandedListId: string | null;
  onExpandedListChange: (listId: string | null) => void;
  onCreateListRequested: () => void;
  onSaveList: (args: { listId: string; patch: { name: string; include_in_system_prompt: boolean; columns: TodoColumn[] } }) => void;
  onDeleteList: (listId: string) => void;
  savePending: boolean;
  deletePending: boolean;
}) {
  const [draftName, setDraftName] = useState("");
  const [draftInclude, setDraftInclude] = useState(false);
  const [draftColumns, setDraftColumns] = useState<TodoColumn[]>([]);
  const [newColumnDraft, setNewColumnDraft] = useState("");

  useEffect(() => {
    if (!lists.length) {
      onExpandedListChange(null);
      return;
    }
    if (expandedListId && !lists.some((list) => list.id === expandedListId)) {
      onExpandedListChange(null);
    }
  }, [lists, expandedListId, onExpandedListChange]);

  const expandedList = useMemo(
    () => (expandedListId ? lists.find((list) => list.id === expandedListId) ?? null : null),
    [lists, expandedListId],
  );

  useEffect(() => {
    if (!expandedList) return;
    setDraftName(expandedList.name);
    setDraftInclude(expandedList.includeInSystemPrompt);
    setDraftColumns(expandedList.columns);
    setNewColumnDraft("");
  }, [expandedList?.id, expandedList?.name, expandedList?.includeInSystemPrompt, expandedList?.columns]);

  if (lists.length === 0) {
    return (
      <div className="rounded-xl border border-sand-300 bg-sand-50 p-6 text-center space-y-3">
        <p className="text-sm text-sand-700">No todo lists configured.</p>
        <Button onClick={onCreateListRequested} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add list
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={onCreateListRequested} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add list
        </Button>
      </div>

      {lists.map((list) => {
        const isExpanded = expandedListId === list.id;
        const columnsSummary = list.columns.map((c) => c.status).join(", ");
        return (
          <div
            key={list.id}
            className={`rounded-xl bg-sand-50 px-5 py-4 transition-all ${isExpanded ? "ring-2 ring-teal-300/50" : ""}`}
          >
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => {
                if (isExpanded) {
                  onExpandedListChange(null);
                  return;
                }
                onExpandedListChange(list.id);
              }}
            >
              <div className="flex items-center gap-3">
                <div className={`h-2 w-2 rounded-full ${activeListId === list.id ? "bg-teal-400" : "bg-sand-400"}`} />
                <span className="text-sm font-medium text-sand-900">{list.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {list.includeInSystemPrompt && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider bg-teal-50 text-teal-600">
                    Prompt
                  </span>
                )}
                {!isExpanded && (
                  <button
                    type="button"
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md text-blood-300 hover:text-blood-500 hover:bg-sand-200 transition-colors cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm(`Delete "${list.name}" and all its items?`)) return;
                      onDeleteList(list.id);
                    }}
                    disabled={deletePending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <ChevronDown className={`h-4 w-4 text-sand-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </div>
            </div>

            {!isExpanded && (
              <div className="flex gap-4 mt-2 ml-5">
                <span className="text-[10px] font-mono text-sand-500 uppercase tracking-wider">
                  columns: {columnsSummary}
                </span>
                <span className="text-[10px] font-mono text-sand-500 uppercase tracking-wider">
                  items: {list.items.length}
                </span>
              </div>
            )}

            {isExpanded && (
              <div className="mt-4">
                <ListSettingsView
                  listName={draftName}
                  onListNameChange={setDraftName}
                  includeInPrompt={draftInclude}
                  onIncludeInPromptChange={setDraftInclude}
                  columns={draftColumns}
                  onColumnsChange={setDraftColumns}
                  newColumnStatus={newColumnDraft}
                  onNewColumnStatusChange={setNewColumnDraft}
                  pending={savePending}
                  onSave={() => {
                    const columns = sanitizeColumns(draftColumns);
                    if (columns.length === 0) return;
                    onSaveList({
                      listId: list.id,
                      patch: {
                        name: draftName.trim(),
                        include_in_system_prompt: draftInclude,
                        columns,
                      },
                    });
                  }}
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="outline"
                    className="text-blood-700 border-blood-300 hover:bg-blood-100/60"
                    onClick={() => {
                      if (!window.confirm(`Delete "${list.name}" and all its items?`)) return;
                      onDeleteList(list.id);
                    }}
                    disabled={deletePending}
                    title={`Delete ${list.name}`}
                    aria-label={`Delete ${list.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

