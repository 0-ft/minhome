import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ArrowLeft, Columns3, ListChecks, Plus, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  type TodoList,
  type TodoStatus,
  useCreateTodoList,
  useDeleteTodoItem,
  useDeleteTodoList,
  useSetTodoItemStatus,
  useTodoLists,
  useUpdateTodoList,
  useUpsertTodoItem,
} from "../../api.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";
import { KanbanColumn } from "./KanbanColumn.js";
import { ListItemCard } from "./ListItemCard.js";
import { ItemDetailView } from "./ItemDetailView.js";
import { ItemFilterRow } from "./ItemFilterRow.js";
import { TodoConfigView } from "./TodoConfigView.js";
import { DEFAULT_COLUMNS, formatStatusLabel, normalizeListId } from "./helpers.js";

function parseTodoRoute(pathname: string) {
  const raw = pathname.startsWith("/todos")
    ? pathname.slice("/todos".length)
    : pathname;
  const segs = raw.split("/").filter(Boolean).map((s) => decodeURIComponent(s));

  if (segs[0] === "settings") {
    return {
      panel: "config" as const,
      listId: segs[1] ?? null,
      itemId: null as number | null,
    };
  }

  const listId = segs[0] ?? null;
  const itemId = segs[1] && /^\d+$/.test(segs[1]) ? Number.parseInt(segs[1], 10) : null;
  return {
    panel: "items" as const,
    listId,
    itemId,
  };
}

export function TodosView() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = useMemo(() => parseTodoRoute(location.pathname), [location.pathname]);

  const { data: lists, isLoading, error } = useTodoLists();
  const createList = useCreateTodoList();
  const deleteList = useDeleteTodoList();
  const updateList = useUpdateTodoList();
  const upsertTodoItem = useUpsertTodoItem();
  const setTodoItemStatus = useSetTodoItemStatus();
  const deleteTodoItem = useDeleteTodoItem();

  const [newListName, setNewListName] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TodoStatus[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!lists) return;
    if (lists.length === 0) return;

    if (routeState.panel === "items") {
      if (!routeState.listId || !lists.some((list) => list.id === routeState.listId)) {
        navigate(`/todos/${encodeURIComponent(lists[0].id)}`, { replace: true });
        return;
      }
      if (routeState.itemId != null) {
        const list = lists.find((l) => l.id === routeState.listId);
        if (!list?.items.some((item) => item.id === routeState.itemId)) {
          navigate(`/todos/${encodeURIComponent(routeState.listId)}`, { replace: true });
        }
      }
      return;
    }

    if (routeState.listId && !lists.some((list) => list.id === routeState.listId)) {
      navigate("/todos/settings", { replace: true });
    }
  }, [lists, routeState, navigate]);

  const activeList = useMemo<TodoList | null>(() => {
    if (!lists || !routeState.listId) return null;
    return lists.find((list) => list.id === routeState.listId) ?? null;
  }, [lists, routeState.listId]);
  const viewMode = activeList?.view ?? "list";

  const statusOptions = useMemo(() => {
    return (activeList?.columns ?? []).map((column) => column.status);
  }, [activeList?.columns]);

  useEffect(() => {
    const validSelected = statusFilter.filter((status) => statusOptions.includes(status));
    if (validSelected.length === statusFilter.length && validSelected.length > 0) return;
    setStatusFilter(statusOptions);
  }, [statusFilter, statusOptions]);

  const statusFilters = useMemo(
    () => statusOptions.map((status) => ({ id: status, label: formatStatusLabel(status) })),
    [statusOptions],
  );
  const statusIconByStatus = useMemo(
    () => Object.fromEntries((activeList?.columns ?? []).map((column) => [column.status, column.icon])) as Partial<Record<TodoStatus, string | undefined>>,
    [activeList?.columns],
  );

  const selectedItem = useMemo(
    () => activeList?.items.find((item) => item.id === routeState.itemId) ?? null,
    [activeList, routeState.itemId],
  );
  const backToTodosPath = useMemo(() => {
    if (routeState.listId) {
      return `/todos/${encodeURIComponent(routeState.listId)}`;
    }
    const firstListId = lists?.[0]?.id;
    if (firstListId) {
      return `/todos/${encodeURIComponent(firstListId)}`;
    }
    return "/todos";
  }, [lists, routeState.listId]);

  const searchedItems = useMemo(() => {
    const items = activeList?.items ?? [];
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q) ||
        String(item.id).includes(q)
      );
    });
  }, [activeList, searchQuery]);

  const filteredListItems = useMemo(() => {
    const selected = statusFilter.length > 0 ? statusFilter : statusOptions;
    return searchedItems.filter((item) => selected.includes(item.status));
  }, [searchedItems, statusFilter, statusOptions]);

  const groupedByColumn = useMemo(() => {
    return (activeList?.columns ?? []).map((column) => ({
      ...column,
      label: formatStatusLabel(column.status),
      items: searchedItems.filter((item) => item.status === column.status),
    }));
  }, [activeList?.columns, searchedItems]);

  const expandedKanbanColumns = useMemo(
    () => groupedByColumn.filter((col) => !col.collapsed),
    [groupedByColumn],
  );
  const collapsedKanbanColumns = useMemo(
    () => groupedByColumn.filter((col) => col.collapsed),
    [groupedByColumn],
  );

  const createListDisabled = createList.isPending || newListName.trim().length === 0;

  const getTitleTransitionName = useCallback((itemId: number) => `todo-title-${itemId}`, []);
  const getCardTransitionName = useCallback((itemId: number) => `todo-card-${itemId}`, []);
  const getStatusTransitionName = useCallback((itemId: number) => `todo-status-${itemId}`, []);

  const addPlaceholderItem = (status?: TodoStatus) => {
    if (!activeList) return;
    const fallbackStatus = statusOptions[0];
    if (!fallbackStatus) return;
    const nextStatus = status && statusOptions.includes(status) ? status : fallbackStatus;
    setSearchQuery("");
    const itemId = Math.max((activeList.items ?? []).reduce((max, item) => Math.max(max, item.id), 0) + 1, 1);
    upsertTodoItem.mutate(
      { listId: activeList.id, itemId, patch: { title: "New todo", body: "", status: nextStatus } },
      { onSuccess: () => navigate(`/todos/${encodeURIComponent(activeList.id)}/${itemId}`) },
    );
  };

  const onKanbanDragEnd = (event: DragEndEvent) => {
    if (!activeList) return;
    const { active, over } = event;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("todo-column:")) return;
    const nextStatus = overId.replace("todo-column:", "") as TodoStatus;
    if (!statusOptions.includes(nextStatus)) return;
    const activeItemId = active.data.current?.itemId as number | undefined;
    const activeStatus = active.data.current?.status as TodoStatus | undefined;
    if (!activeItemId || !activeStatus || activeStatus === nextStatus) return;
    setTodoItemStatus.mutate({ listId: activeList.id, itemId: activeItemId, status: nextStatus });
  };

  const toggleColumnCollapsed = (status: TodoStatus) => {
    if (!activeList) return;
    const nextColumns = activeList.columns.map((column) =>
      column.status === status ? { ...column, collapsed: !column.collapsed } : column,
    );
    updateList.mutate({ listId: activeList.id, patch: { columns: nextColumns } });
  };

  const onViewModeChange = (mode: "list" | "kanban") => {
    if (!activeList || activeList.view === mode) return;
    updateList.mutate({ listId: activeList.id, patch: { view: mode } });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-sand-600 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading todos...
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-10 text-sm text-blood-600 font-mono">
        Failed to load todos.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        {routeState.panel === "items" && selectedItem && activeList ? (
          <ItemDetailView
            item={selectedItem}
            cardViewTransitionName={getCardTransitionName(selectedItem.id)}
            titleViewTransitionName={getTitleTransitionName(selectedItem.id)}
            statusViewTransitionName={getStatusTransitionName(selectedItem.id)}
            statusOptions={statusOptions}
            statusIconByStatus={statusIconByStatus}
            onBack={() => navigate(`/todos/${encodeURIComponent(activeList.id)}`)}
            onSavePatch={(patch) =>
              upsertTodoItem.mutate({ listId: activeList.id, itemId: selectedItem.id, patch })
            }
            onSetStatus={(status) =>
              setTodoItemStatus.mutate({ listId: activeList.id, itemId: selectedItem.id, status })
            }
            onDelete={() => {
              deleteTodoItem.mutate(
                { listId: activeList.id, itemId: selectedItem.id },
                { onSuccess: () => navigate(`/todos/${encodeURIComponent(activeList.id)}`) },
              );
            }}
          />
        ) : routeState.panel === "config" ? (
          <>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => navigate(backToTodosPath)}
                className="inline-flex items-center gap-1.5 text-sm text-sand-700 hover:text-sand-900 cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to todos
              </button>
            </div>
            <TodoConfigView
              lists={lists ?? []}
              activeListId={routeState.listId}
              expandedListId={routeState.listId}
              onExpandedListChange={(listId) => {
                if (!listId) {
                  navigate("/todos/settings");
                  return;
                }
                navigate(`/todos/settings/${encodeURIComponent(listId)}`);
              }}
              onCreateListRequested={() => setCreateModalOpen(true)}
              onSaveList={({ listId, patch }) => {
                updateList.mutate({ listId, patch });
              }}
              onDeleteList={(listId) => {
                deleteList.mutate(listId, {
                  onSuccess: () => {
                    if (routeState.listId === listId) {
                      navigate("/todos/settings");
                    }
                  },
                });
              }}
              savePending={updateList.isPending}
              deletePending={deleteList.isPending}
            />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex gap-0.5 bg-sand-200 rounded-lg p-0.5 max-w-full overflow-x-auto">
                {(lists ?? []).map((list) => (
                  <button
                    key={list.id}
                    onClick={() => navigate(`/todos/${encodeURIComponent(list.id)}`)}
                    className={`px-3 py-1 rounded-md text-[11px] font-mono uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                      routeState.listId === list.id
                        ? "bg-sand-50 text-sand-900 shadow-sm"
                        : "text-sand-500 hover:text-sand-700 hover:bg-sand-100/60"
                    }`}
                  >
                    {list.name}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <ToggleGroup
                  type="single"
                  value={viewMode}
                  onValueChange={(value) => {
                    if (value === "list" || value === "kanban") onViewModeChange(value);
                  }}
                >
                  <ToggleGroupItem value="list" aria-label="List view" className="gap-1.5">
                    <ListChecks className="h-3.5 w-3.5" />
                    List
                  </ToggleGroupItem>
                  <ToggleGroupItem value="kanban" aria-label="Kanban view" className="gap-1.5">
                    <Columns3 className="h-3.5 w-3.5" />
                    Kanban
                  </ToggleGroupItem>
                </ToggleGroup>
                <Button
                  size="icon"
                  variant={routeState.panel === "config" ? "default" : "outline"}
                  onClick={() => {
                    if (routeState.listId) {
                      navigate(`/todos/settings/${encodeURIComponent(routeState.listId)}`);
                    } else {
                      navigate("/todos/settings");
                    }
                  }}
                  title="Todo configuration"
                  aria-label="Open todo configuration"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {activeList ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <ItemFilterRow
                      viewMode={viewMode}
                      statusFilter={statusFilter}
                      statusFilters={statusFilters}
                      statusIconByStatus={statusIconByStatus}
                      statusOptions={statusOptions}
                      onStatusFilterChange={setStatusFilter}
                      searchQuery={searchQuery}
                      onSearchQueryChange={setSearchQuery}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => addPlaceholderItem(statusFilter[0] ?? statusOptions[0])}
                    className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg bg-sand-200 text-sand-600 hover:bg-sand-300 hover:text-sand-800 transition-colors cursor-pointer"
                    title="Add item"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {viewMode === "list" ? (
                  <div className="flex flex-col gap-2">
                    {filteredListItems.length === 0 ? (
                      <div className="text-center py-12 text-sm text-sand-600 rounded-xl border border-sand-300 bg-sand-50">
                        No matching items.
                      </div>
                    ) : (
                      filteredListItems.map((item) => (
                        <ListItemCard
                          key={item.id}
                          item={item}
                          cardViewTransitionName={getCardTransitionName(item.id)}
                          titleViewTransitionName={getTitleTransitionName(item.id)}
                          statusViewTransitionName={getStatusTransitionName(item.id)}
                          statusOptions={statusOptions}
                          statusIconByStatus={statusIconByStatus}
                          onOpen={() =>
                            startTransition(() =>
                              navigate(`/todos/${encodeURIComponent(activeList.id)}/${item.id}`),
                            )
                          }
                          onStatusSet={(status) =>
                            setTodoItemStatus.mutate({ listId: activeList.id, itemId: item.id, status })
                          }
                        />
                      ))
                    )}
                  </div>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onKanbanDragEnd}>
                    <div className="overflow-x-auto pb-2">
                      <div className="flex items-start gap-3 w-max min-w-full">
                        {expandedKanbanColumns.map((col) => (
                          <KanbanColumn
                            key={col.status}
                            listId={activeList.id}
                            status={col.status}
                            label={col.label}
                            icon={col.icon}
                            collapsed={false}
                            items={col.items}
                            onAddItem={(status) => addPlaceholderItem(status)}
                            onOpenItem={(itemId) =>
                              startTransition(() =>
                                navigate(`/todos/${encodeURIComponent(activeList.id)}/${itemId}`),
                              )
                            }
                            onToggleCollapse={toggleColumnCollapsed}
                            getCardTransitionName={getCardTransitionName}
                            getTitleTransitionName={getTitleTransitionName}
                          />
                        ))}
                        {collapsedKanbanColumns.map((col) => (
                          <KanbanColumn
                            key={col.status}
                            listId={activeList.id}
                            status={col.status}
                            label={col.label}
                            icon={col.icon}
                            collapsed={true}
                            items={col.items}
                            onAddItem={(status) => addPlaceholderItem(status)}
                            onOpenItem={(itemId) =>
                              startTransition(() =>
                                navigate(`/todos/${encodeURIComponent(activeList.id)}/${itemId}`),
                              )
                            }
                            onToggleCollapse={toggleColumnCollapsed}
                            getCardTransitionName={getCardTransitionName}
                            getTitleTransitionName={getTitleTransitionName}
                          />
                        ))}
                      </div>
                    </div>
                  </DndContext>
                )}
              </>
            ) : (
              <div className="text-sm text-sand-600 font-mono py-10 text-center rounded-xl border border-sand-300 bg-sand-50">
                No todo lists yet. Open settings to create one.
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => navigate("/todos/settings")}>
                    Open settings
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/45 cursor-default"
            onClick={() => setCreateModalOpen(false)}
            aria-label="Close create list modal"
          />
          <div className="relative w-full max-w-md rounded-xl border border-blood-300/50 bg-blood-500 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-sand-50">Create todo list</h3>
            <p className="mt-1 text-sm text-blood-100">Give the list a name. ID is auto-generated from it.</p>
            <div className="mt-4">
              <Input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="e.g. Weekend jobs"
                className="bg-sand-50 text-sand-900 border-sand-300 focus-visible:bg-sand-50"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || createListDisabled) return;
                  const name = newListName.trim();
                  if (!name) return;
                  const id = normalizeListId(name);
                  if (!id) return;
                  createList.mutate(
                    { id, name, columns: DEFAULT_COLUMNS },
                    {
                      onSuccess: (list) => {
                        setNewListName("");
                        setCreateModalOpen(false);
                        if (routeState.panel === "config") {
                          navigate(`/todos/settings/${encodeURIComponent(list.id)}`);
                        } else {
                          navigate(`/todos/${encodeURIComponent(list.id)}`);
                        }
                      },
                    },
                  );
                }}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={createListDisabled}
                onClick={() => {
                  const name = newListName.trim();
                  if (!name) return;
                  const id = normalizeListId(name);
                  if (!id) return;
                  createList.mutate(
                    { id, name, columns: DEFAULT_COLUMNS },
                    {
                      onSuccess: (list) => {
                        setNewListName("");
                        setCreateModalOpen(false);
                        if (routeState.panel === "config") {
                          navigate(`/todos/settings/${encodeURIComponent(list.id)}`);
                        } else {
                          navigate(`/todos/${encodeURIComponent(list.id)}`);
                        }
                      },
                    },
                  );
                }}
              >
                Create list
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

