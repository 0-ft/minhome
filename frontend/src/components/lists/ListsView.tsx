import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ArrowLeft, Columns3, ListChecks, Plus, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  type List,
  type ListStatusId,
  useCreateList,
  useDeleteListItem,
  useDeleteList,
  useSetListItemStatus,
  useLists,
  useUpdateList,
  useUpsertListItem,
} from "../../api.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";
import { KanbanColumn } from "./KanbanColumn.js";
import { ListItemCard } from "./ListItemCard.js";
import { ItemDetailView } from "./ItemDetailView.js";
import { ItemFilterRow } from "./ItemFilterRow.js";
import type { StatusOption } from "./StatusPicker.js";
import { ListsConfigView } from "./TodoConfigView.js";
import { DEFAULT_COLUMNS, normalizeListId } from "./helpers.js";

function parseListRoute(pathname: string) {
  const raw = pathname.startsWith("/lists")
    ? pathname.slice("/lists".length)
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

export function ListsView() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = useMemo(() => parseListRoute(location.pathname), [location.pathname]);

  const { data: lists, isLoading, error } = useLists();
  const createList = useCreateList();
  const deleteList = useDeleteList();
  const updateList = useUpdateList();
  const upsertListItem = useUpsertListItem();
  const setListItemStatus = useSetListItemStatus();
  const deleteListItem = useDeleteListItem();

  const [newListName, setNewListName] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [draggedKanbanItem, setDraggedKanbanItem] = useState<{ id: number; title: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!lists) return;
    if (lists.length === 0) return;

    if (routeState.panel === "items") {
      if (!routeState.listId || !lists.some((list) => list.id === routeState.listId)) {
        navigate(`/lists/${encodeURIComponent(lists[0].id)}`, { replace: true });
        return;
      }
      if (routeState.itemId != null) {
        const list = lists.find((l) => l.id === routeState.listId);
        if (!list?.items.some((item) => item.id === routeState.itemId)) {
          navigate(`/lists/${encodeURIComponent(routeState.listId)}`, { replace: true });
        }
      }
      return;
    }

    if (routeState.listId && !lists.some((list) => list.id === routeState.listId)) {
      navigate("/lists/settings", { replace: true });
    }
  }, [lists, routeState, navigate]);

  const activeList = useMemo<List | null>(() => {
    if (!lists || !routeState.listId) return null;
    return lists.find((list) => list.id === routeState.listId) ?? null;
  }, [lists, routeState.listId]);
  const viewMode = activeList?.view ?? "list";

  const statusOptions = useMemo<StatusOption[]>(() => {
    return (activeList?.columns ?? []).map((column) => ({
      id: column.id,
      label: column.name,
      icon: column.icon,
    }));
  }, [activeList?.columns]);
  const statusOptionIds = useMemo(
    () => statusOptions.map((option) => option.id),
    [statusOptions],
  );
  const statusFilter = useMemo<ListStatusId[]>(
    () => (activeList?.columns ?? [])
      .filter((column) => !column.collapsed)
      .map((column) => column.id),
    [activeList?.columns],
  );

  const statusFilters = useMemo(
    () => statusOptions.map((option) => ({ id: option.id, label: option.label, icon: option.icon })),
    [statusOptions],
  );

  const selectedItem = useMemo(
    () => activeList?.items.find((item) => item.id === routeState.itemId) ?? null,
    [activeList, routeState.itemId],
  );
  const backToListsPath = useMemo(() => {
    if (routeState.listId) {
      return `/lists/${encodeURIComponent(routeState.listId)}`;
    }
    const firstListId = lists?.[0]?.id;
    if (firstListId) {
      return `/lists/${encodeURIComponent(firstListId)}`;
    }
    return "/lists";
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
    return searchedItems
      .filter((item) => statusFilter.includes(item.statusId))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [searchedItems, statusFilter]);

  const groupedByColumn = useMemo(() => {
    return (activeList?.columns ?? []).map((column) => ({
      ...column,
      label: column.name,
      items: searchedItems
        .filter((item) => item.statusId === column.id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
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

  const getTitleTransitionName = useCallback(
    (listId: string, itemId: number) => `list-title-${listId}-${itemId}`,
    [],
  );
  const getCardTransitionName = useCallback(
    (listId: string, itemId: number) => `list-card-${listId}-${itemId}`,
    [],
  );
  const getStatusTransitionName = useCallback(
    (listId: string, itemId: number) => `list-status-${listId}-${itemId}`,
    [],
  );

  const addPlaceholderItem = (statusId?: ListStatusId) => {
    if (!activeList) return;
    const fallbackStatusId = statusOptionIds[0];
    if (!fallbackStatusId) return;
    const nextStatusId = statusId && statusOptionIds.includes(statusId) ? statusId : fallbackStatusId;
    setSearchQuery("");
    const itemId = Math.max((activeList.items ?? []).reduce((max, item) => Math.max(max, item.id), 0) + 1, 1);
    upsertListItem.mutate(
      { listId: activeList.id, itemId, patch: { title: "New item", body: "", status_id: nextStatusId } },
      { onSuccess: () => navigate(`/lists/${encodeURIComponent(activeList.id)}/${itemId}`) },
    );
  };

  const saveItemTitle = (itemId: number, nextTitle: string) => {
    if (!activeList) return;
    upsertListItem.mutate({ listId: activeList.id, itemId, patch: { title: nextTitle } });
  };

  const onKanbanDragEnd = (event: DragEndEvent) => {
    setDraggedKanbanItem(null);
    if (!activeList) return;
    const { active, over } = event;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("list-column:")) return;
    const nextStatusId = overId.replace("list-column:", "") as ListStatusId;
    if (!statusOptionIds.includes(nextStatusId)) return;
    const activeItemId = active.data.current?.itemId as number | undefined;
    const activeStatusId = active.data.current?.statusId as ListStatusId | undefined;
    if (!activeItemId || !activeStatusId || activeStatusId === nextStatusId) return;
    setListItemStatus.mutate({ listId: activeList.id, itemId: activeItemId, statusId: nextStatusId });
  };

  const onKanbanDragStart = (event: DragStartEvent) => {
    if (!activeList) return;
    const activeItemId = event.active.data.current?.itemId as number | undefined;
    if (!activeItemId) return;
    const item = activeList.items.find((candidate) => candidate.id === activeItemId);
    if (!item) return;
    setDraggedKanbanItem({ id: item.id, title: item.title });
  };

  const toggleColumnCollapsed = (statusId: ListStatusId) => {
    if (!activeList) return;
    const nextColumns = activeList.columns.map((column) =>
      column.id === statusId ? { ...column, collapsed: !column.collapsed } : column,
    );
    updateList.mutate({ listId: activeList.id, patch: { columns: nextColumns } });
  };

  const onStatusFilterChange = (next: string[]) => {
    if (!activeList) return;
    const allowed = new Set(statusOptionIds);
    const visible = new Set(next.filter((statusId): statusId is ListStatusId => allowed.has(statusId)));
    const nextColumns = activeList.columns.map((column) => ({
      ...column,
      collapsed: !visible.has(column.id),
    }));
    const hasChange = nextColumns.some((column, idx) => column.collapsed !== activeList.columns[idx]?.collapsed);
    if (!hasChange) return;
    updateList.mutate({ listId: activeList.id, patch: { columns: nextColumns } });
  };

  const onViewModeChange = (mode: "list" | "kanban") => {
    if (!activeList || activeList.view === mode) return;
    updateList.mutate({ listId: activeList.id, patch: { view: mode } });
  };

  const onExpandedListChange = useCallback((listId: string | null) => {
    if (!listId) {
      navigate("/lists/settings");
      return;
    }
    navigate(`/lists/settings/${encodeURIComponent(listId)}`);
  }, [navigate]);

  const onCreateListRequested = useCallback(() => {
    setCreateModalOpen(true);
  }, []);

  const onSaveConfigList = useCallback(({
    listId,
    patch,
  }: {
    listId: string;
    patch: { name: string; include_in_system_prompt: boolean; columns: List["columns"] };
  }) => {
    updateList.mutate({ listId, patch });
  }, [updateList]);

  const onDeleteConfigList = useCallback((listId: string) => {
    deleteList.mutate(listId, {
      onSuccess: () => {
        if (routeState.listId === listId) {
          navigate("/lists/settings");
        }
      },
    });
  }, [deleteList, navigate, routeState.listId]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center gap-2 text-sm text-sand-600 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading lists...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-blood-600">
        Failed to load lists.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4">
        {routeState.panel === "items" && selectedItem && activeList ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <ItemDetailView
              item={selectedItem}
                cardViewTransitionName={getCardTransitionName(activeList.id, selectedItem.id)}
                titleViewTransitionName={getTitleTransitionName(activeList.id, selectedItem.id)}
                statusViewTransitionName={getStatusTransitionName(activeList.id, selectedItem.id)}
              statusOptions={statusOptions}
              onBack={() => navigate(`/lists/${encodeURIComponent(activeList.id)}`)}
              onSavePatch={(patch) =>
                upsertListItem.mutate({ listId: activeList.id, itemId: selectedItem.id, patch })
              }
              onSetStatus={(statusId) =>
                setListItemStatus.mutate({ listId: activeList.id, itemId: selectedItem.id, statusId })
              }
              onDelete={() => {
                deleteListItem.mutate(
                  { listId: activeList.id, itemId: selectedItem.id },
                  { onSuccess: () => navigate(`/lists/${encodeURIComponent(activeList.id)}`) },
                );
              }}
            />
          </div>
        ) : routeState.panel === "config" ? (
          <>
            <div className="flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => navigate(backToListsPath)}
                className="inline-flex items-center gap-1.5 text-sm text-sand-700 hover:text-sand-900 cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to lists
              </button>
              <Button onClick={onCreateListRequested} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add list
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <ListsConfigView
                lists={lists ?? []}
                activeListId={routeState.listId}
                expandedListId={routeState.listId}
                onExpandedListChange={onExpandedListChange}
                onCreateListRequested={onCreateListRequested}
                onSaveList={onSaveConfigList}
                onDeleteList={onDeleteConfigList}
                savePending={updateList.isPending}
                deletePending={deleteList.isPending}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 shrink-0">
              <div className="max-w-full overflow-x-auto">
                <ToggleGroup
                  type="single"
                  value={routeState.listId ?? undefined}
                  onValueChange={(value) => {
                    if (!value) return;
                    navigate(`/lists/${encodeURIComponent(value)}`);
                  }}
                  className="w-max"
                >
                  {(lists ?? []).map((list) => (
                    <ToggleGroupItem
                      key={list.id}
                      value={list.id}
                      className="px-3 py-1 whitespace-nowrap"
                    >
                      {list.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
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
                <button
                  type="button"
                  onClick={() => {
                    if (routeState.listId) {
                      navigate(`/lists/settings/${encodeURIComponent(routeState.listId)}`);
                    } else {
                      navigate("/lists/settings");
                    }
                  }}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors cursor-pointer ${
                    routeState.panel === "config"
                      ? "text-blood-700 bg-blood-100/70"
                      : "text-blood-500 hover:text-blood-700 hover:bg-blood-100/60"
                  }`}
                  title="List configuration"
                  aria-label="Open list configuration"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
            </div>

            {activeList ? (
              <>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex-1 min-w-0">
                    <ItemFilterRow
                      viewMode={viewMode}
                      statusFilter={statusFilter}
                      statusFilters={statusFilters}
                      onStatusFilterChange={onStatusFilterChange}
                      searchQuery={searchQuery}
                      onSearchQueryChange={setSearchQuery}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => addPlaceholderItem(statusFilter[0] ?? statusOptionIds[0])}
                    className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg bg-sand-200 text-sand-600 hover:bg-sand-300 hover:text-sand-800 transition-colors cursor-pointer"
                    title="Add item"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                {viewMode === "list" ? (
                  <div className="flex-1 min-h-0 flex flex-col gap-2">
                    {filteredListItems.length === 0 ? (
                      <div className="flex-1 min-h-0 overflow-y-auto text-center py-12 text-sm text-sand-600 rounded-xl border border-sand-300 bg-sand-50">
                        No matching items.
                      </div>
                    ) : (
                      <div className="h-full min-h-0 rounded-xl border border-sand-300 bg-sand-50 overflow-hidden flex flex-col">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 border-b border-sand-300 bg-sand-100/70 text-[10px] uppercase tracking-wider text-sand-500">
                          <span>Issue</span>
                          <span className="pr-0.5">Status</span>
                        </div>
                        <div className="divide-y divide-sand-300 overflow-y-auto min-h-0">
                          {filteredListItems.map((item) => (
                            <ListItemCard
                              key={`${activeList.id}:${item.id}`}
                              item={item}
                              cardViewTransitionName={getCardTransitionName(activeList.id, item.id)}
                              titleViewTransitionName={getTitleTransitionName(activeList.id, item.id)}
                              statusViewTransitionName={getStatusTransitionName(activeList.id, item.id)}
                              statusOptions={statusOptions}
                              onOpen={() =>
                                startTransition(() =>
                                  navigate(`/lists/${encodeURIComponent(activeList.id)}/${item.id}`),
                                )
                              }
                              onSaveTitle={(nextTitle) => saveItemTitle(item.id, nextTitle)}
                              onStatusSet={(statusId) =>
                                setListItemStatus.mutate({ listId: activeList.id, itemId: item.id, statusId })
                              }
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 min-h-0">
                    <div className="h-full md:hidden overflow-x-auto pb-2 snap-x snap-mandatory">
                      <div className="flex items-stretch gap-3 min-w-full h-full">
                        {groupedByColumn.map((col) => (
                          <div key={col.id} className="min-w-full h-full snap-center">
                            <KanbanColumn
                              listId={activeList.id}
                              statusId={col.id}
                              label={col.label}
                              icon={col.icon}
                              collapsed={col.collapsed}
                              mobileCarousel={true}
                              enableDragDrop={false}
                              items={col.items}
                              onAddItem={(statusId) => addPlaceholderItem(statusId)}
                              onOpenItem={(itemId) =>
                                startTransition(() =>
                                  navigate(`/lists/${encodeURIComponent(activeList.id)}/${itemId}`),
                                )
                              }
                              onSaveItemTitle={saveItemTitle}
                              onToggleCollapse={toggleColumnCollapsed}
                              getCardTransitionName={(itemId) => getCardTransitionName(activeList.id, itemId)}
                              getTitleTransitionName={(itemId) =>
                                getTitleTransitionName(activeList.id, itemId)
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <DndContext
                      sensors={sensors}
                      collisionDetection={pointerWithin}
                      onDragStart={onKanbanDragStart}
                      onDragCancel={() => setDraggedKanbanItem(null)}
                      onDragEnd={onKanbanDragEnd}
                    >
                      <div className="hidden md:block h-full overflow-x-auto pb-2">
                        <div className="flex items-start gap-3 w-max min-w-full h-full">
                          {expandedKanbanColumns.map((col) => (
                            <KanbanColumn
                              key={col.id}
                              listId={activeList.id}
                              statusId={col.id}
                              label={col.label}
                              icon={col.icon}
                              collapsed={false}
                              items={col.items}
                              onAddItem={(statusId) => addPlaceholderItem(statusId)}
                              onOpenItem={(itemId) =>
                                startTransition(() =>
                                  navigate(`/lists/${encodeURIComponent(activeList.id)}/${itemId}`),
                                )
                              }
                              onSaveItemTitle={saveItemTitle}
                              onToggleCollapse={toggleColumnCollapsed}
                              getCardTransitionName={(itemId) => getCardTransitionName(activeList.id, itemId)}
                              getTitleTransitionName={(itemId) =>
                                getTitleTransitionName(activeList.id, itemId)
                              }
                            />
                          ))}
                          {collapsedKanbanColumns.map((col) => (
                            <KanbanColumn
                              key={col.id}
                              listId={activeList.id}
                              statusId={col.id}
                              label={col.label}
                              icon={col.icon}
                              collapsed={true}
                              items={col.items}
                              onAddItem={(statusId) => addPlaceholderItem(statusId)}
                              onOpenItem={(itemId) =>
                                startTransition(() =>
                                  navigate(`/lists/${encodeURIComponent(activeList.id)}/${itemId}`),
                                )
                              }
                              onSaveItemTitle={saveItemTitle}
                              onToggleCollapse={toggleColumnCollapsed}
                              getCardTransitionName={(itemId) => getCardTransitionName(activeList.id, itemId)}
                              getTitleTransitionName={(itemId) =>
                                getTitleTransitionName(activeList.id, itemId)
                              }
                            />
                          ))}
                        </div>
                      </div>
                      <div className="hidden md:block">
                        <DragOverlay dropAnimation={null}>
                          {draggedKanbanItem ? (
                            <div className="w-72 rounded-md bg-sand-50 border border-sand-300 p-2 shadow-lg opacity-95">
                              <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sand-500 mb-1">
                                <span>{draggedKanbanItem.id}</span>
                              </div>
                              <div className="text-sm leading-snug font-medium text-sand-900 whitespace-pre-wrap break-words">
                                {draggedKanbanItem.title}
                              </div>
                            </div>
                          ) : null}
                        </DragOverlay>
                      </div>
                    </DndContext>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto text-sm text-sand-600 py-10 text-center rounded-xl border border-sand-300 bg-sand-50">
                No lists yet. Open settings to create one.
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => navigate("/lists/settings")}>
                    Open settings
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/45 cursor-default"
            onClick={() => setCreateModalOpen(false)}
            aria-label="Close create list modal"
          />
          <div className="relative w-full max-w-md rounded-xl border border-blood-300/50 bg-blood-500 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-sand-50">Create list</h3>
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
                          navigate(`/lists/settings/${encodeURIComponent(list.id)}`);
                        } else {
                          navigate(`/lists/${encodeURIComponent(list.id)}`);
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
                          navigate(`/lists/settings/${encodeURIComponent(list.id)}`);
                        } else {
                          navigate(`/lists/${encodeURIComponent(list.id)}`);
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

