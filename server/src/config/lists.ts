import { existsSync, readFileSync, writeFileSync } from "fs";
import { z } from "zod";

const DefaultListColumns = [
  { id: "backlog", name: "Backlog", collapsed: false },
  { id: "todo", name: "Todo", collapsed: false },
  { id: "done", name: "Done", collapsed: false },
  { id: "cancelled", name: "Cancelled", collapsed: false },
] as const;
const DefaultCompleteStatusIds = ["done", "cancelled"] as const;

export const ListStatusIdSchema = z.string().trim().min(1);
export type ListStatusId = z.infer<typeof ListStatusIdSchema>;
export const ListViewSchema = z.enum(["list", "kanban"]);
export type ListView = z.infer<typeof ListViewSchema>;

export const ListColumnSchema = z.object({
  id: ListStatusIdSchema,
  name: z.string().trim().min(1),
  collapsed: z.boolean().default(false),
  icon: z.string().optional(),
});
export type ListColumn = z.infer<typeof ListColumnSchema>;

export const ListItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1),
  body: z.string().default(""),
  statusId: ListStatusIdSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ListItem = z.infer<typeof ListItemSchema>;

export const ListSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  includeInSystemPrompt: z.boolean().default(false),
  view: ListViewSchema.default("list"),
  columns: z.array(ListColumnSchema).min(1),
  items: z.array(ListItemSchema).default([]),
  completeStatusIds: z.array(ListStatusIdSchema).optional(),
});
export type List = z.infer<typeof ListSchema>;

export const ListsFileSchema = z.object({
  lists: z.array(ListSchema).default([]),
});
export type ListsFile = z.infer<typeof ListsFileSchema>;

export class ListStore {
  private data: ListsFile;
  private changeListeners = new Set<() => void>();

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      this.data = this.parseAndNormalize(JSON.parse(raw));
    } else {
      this.data = { lists: [] };
      this.save();
    }
  }

  /** Re-read from disk so hand-edits to lists.json are picked up */
  private reload(): void {
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, "utf-8");
      this.data = this.parseAndNormalize(JSON.parse(raw));
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + "\n");
    this.changeListeners.forEach((fn) => fn());
  }

  onChanged(fn: () => void): void { this.changeListeners.add(fn); }
  offChanged(fn: () => void): void { this.changeListeners.delete(fn); }

  getAllLists(): List[] {
    this.reload();
    return this.data.lists;
  }

  getList(listId: string): List | undefined {
    this.reload();
    return this.data.lists.find((list) => list.id === listId);
  }

  createList(list: {
    id: string;
    name: string;
    includeInSystemPrompt?: boolean;
    view?: ListView;
    columns?: Array<{ id: string; name: string; collapsed?: boolean; icon?: string }>;
    completeStatusIds?: string[];
  }): List {
    this.reload();
    if (this.data.lists.some((existing) => existing.id === list.id)) {
      throw new Error("List already exists");
    }

    const created = ListSchema.parse({
      id: list.id,
      name: list.name,
      includeInSystemPrompt: list.includeInSystemPrompt ?? false,
      view: list.view ?? "list",
      columns: list.columns ?? DefaultListColumns.map((column) => ({ ...column })),
      items: [],
      completeStatusIds: list.completeStatusIds,
    });
    this.data.lists.push(created);
    this.save();
    return created;
  }

  updateList(
    listId: string,
    patch: {
      name?: string;
      includeInSystemPrompt?: boolean;
      view?: ListView;
      columns?: Array<{ id: string; name: string; collapsed?: boolean; icon?: string }>;
      completeStatusIds?: string[];
    },
  ): List {
    this.reload();
    const list = this.data.lists.find((existing) => existing.id === listId);
    if (!list) throw new Error("List not found");
    if (patch.name !== undefined) {
      list.name = z.string().trim().min(1).parse(patch.name);
    }
    if (patch.includeInSystemPrompt !== undefined) {
      list.includeInSystemPrompt = patch.includeInSystemPrompt;
    }
    if (patch.view !== undefined) {
      list.view = ListViewSchema.parse(patch.view);
    }
    if (patch.columns !== undefined) {
      list.columns = this.parseColumnsPatch(patch.columns);
    }
    if (patch.completeStatusIds !== undefined) {
      list.completeStatusIds = patch.completeStatusIds.length > 0
        ? patch.completeStatusIds
        : undefined;
    }
    this.save();
    return list;
  }

  deleteList(listId: string): boolean {
    this.reload();
    const idx = this.data.lists.findIndex((existing) => existing.id === listId);
    if (idx < 0) return false;
    this.data.lists.splice(idx, 1);
    this.save();
    return true;
  }

  upsertList(list: Pick<List, "id"> & Partial<Pick<List, "name" | "includeInSystemPrompt" | "view">>): List {
    this.reload();
    const idx = this.data.lists.findIndex((existing) => existing.id === list.id);
    if (idx >= 0) {
      const existing = this.data.lists[idx];
      this.data.lists[idx] = {
        ...existing,
        name: list.name ?? existing.name,
        includeInSystemPrompt: list.includeInSystemPrompt ?? existing.includeInSystemPrompt,
        view: list.view ?? existing.view,
        columns: existing.columns,
      };
    } else {
      this.data.lists.push(
        ListSchema.parse({
          id: list.id,
          name: list.name ?? list.id,
          includeInSystemPrompt: list.includeInSystemPrompt ?? false,
          view: list.view ?? "list",
          columns: DefaultListColumns.map((column) => ({ ...column })),
          items: [],
        }),
      );
    }
    this.save();
    return this.data.lists.find((existing) => existing.id === list.id)!;
  }

  upsertItem(
    listId: string,
    item: {
      id?: number;
      title?: string;
      body?: string;
      statusId?: ListStatusId;
    },
    listPatch?: Partial<Pick<List, "name" | "includeInSystemPrompt">>,
  ): ListItem {
    this.reload();
    const list = this.ensureList(listId, listPatch);
    const targetId = item.id ?? this.getNextItemId(list);
    const idx = list.items.findIndex((existing) => existing.id === targetId);

    const now = new Date().toISOString();
    if (idx >= 0) {
      const existing = list.items[idx];
      list.items[idx] = ListItemSchema.parse({
        id: targetId,
        title: item.title ?? existing.title,
        body: item.body ?? existing.body,
        statusId: this.resolveStatusId(list, item.statusId ?? existing.statusId, `list ${list.id} item ${targetId}`),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      this.save();
      return list.items[idx];
    }

    if (!item.title) {
      throw new Error("New list items require title");
    }

    const created = ListItemSchema.parse({
      id: targetId,
      title: item.title,
      body: item.body ?? "",
      statusId: this.resolveStatusId(list, item.statusId),
      createdAt: now,
      updatedAt: now,
    });
    list.items.push(created);
    this.save();
    return created;
  }

  setItemStatus(listId: string, itemId: number, statusId: ListStatusId): ListItem {
    this.reload();
    const list = this.data.lists.find((existing) => existing.id === listId);
    if (!list) throw new Error("List not found");
    const item = list.items.find((existing) => existing.id === itemId);
    if (!item) throw new Error("List item not found");
    item.statusId = this.resolveStatusId(list, statusId, `list ${list.id} item ${itemId}`);
    item.updatedAt = new Date().toISOString();
    this.save();
    return item;
  }

  deleteItem(listId: string, itemId: number): boolean {
    this.reload();
    const list = this.data.lists.find((existing) => existing.id === listId);
    if (!list) return false;
    const idx = list.items.findIndex((existing) => existing.id === itemId);
    if (idx < 0) return false;
    list.items.splice(idx, 1);
    this.save();
    return true;
  }

  getPromptLists(): Array<{
    id: string;
    name: string;
    columns: ListColumn[];
    items: ListItem[];
  }> {
    this.reload();
    return this.data.lists
      .filter((list) => list.includeInSystemPrompt)
      .map((list) => {
        const completeStatusIds = list.completeStatusIds ?? [...DefaultCompleteStatusIds];
        const completeSet = new Set(completeStatusIds);
        return {
          id: list.id,
          name: list.name,
          columns: list.columns,
          items: list.items.filter((item) => !completeSet.has(item.statusId)),
        };
      })
      .filter((list) => list.items.length > 0);
  }

  private ensureList(
    listId: string,
    listPatch?: Partial<Pick<List, "name" | "includeInSystemPrompt">>,
  ): List {
    const existing = this.data.lists.find((list) => list.id === listId);
    if (existing) {
      if (listPatch?.name !== undefined) {
        existing.name = listPatch.name;
      }
      if (listPatch?.includeInSystemPrompt !== undefined) {
        existing.includeInSystemPrompt = listPatch.includeInSystemPrompt;
      }
      return existing;
    }

    const created = ListSchema.parse({
      id: listId,
      name: listPatch?.name ?? listId,
      includeInSystemPrompt: listPatch?.includeInSystemPrompt ?? false,
      view: "list",
      columns: DefaultListColumns.map((column) => ({ ...column })),
      items: [],
    });
    this.data.lists.push(created);
    return created;
  }

  private getNextItemId(list: List): number {
    const highest = list.items.reduce((max, item) => Math.max(max, item.id), 0);
    return Math.max(highest + 1, 1);
  }

  private parseAndNormalize(raw: unknown): ListsFile {
    if (!raw || typeof raw !== "object") {
      return { lists: [] };
    }

    const root = raw as { lists?: unknown };
    const rawLists = Array.isArray(root.lists) ? root.lists : [];

    const lists: List[] = rawLists.map((listRaw) => {
      const listObj = (listRaw && typeof listRaw === "object") ? listRaw as Record<string, unknown> : {};
      const id = typeof listObj.id === "string" && listObj.id.trim() ? listObj.id.trim() : "list";
      const name = typeof listObj.name === "string" && listObj.name.trim() ? listObj.name.trim() : id;
      const includeInSystemPrompt = Boolean(listObj.includeInSystemPrompt);
      const view = ListViewSchema.safeParse(listObj.view).success
        ? listObj.view as ListView
        : "list";
      const columns = this.parseColumnsFromRawList(listObj, id);
      const statusIds = this.getColumnStatusIds(columns);
      const rawItems = Array.isArray(listObj.items) ? listObj.items : [];

      const completeStatusIds = Array.isArray(listObj.completeStatusIds)
        ? listObj.completeStatusIds
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim())
        : undefined;

      let maxId = 0;
      const usedIds = new Set<number>();
      const items: ListItem[] = rawItems.map((itemRaw) => {
        const itemObj = (itemRaw && typeof itemRaw === "object") ? itemRaw as Record<string, unknown> : {};

        let numericId: number | null = null;
        if (typeof itemObj.id === "number" && Number.isInteger(itemObj.id) && itemObj.id > 0) {
          numericId = itemObj.id;
        } else if (typeof itemObj.id === "string" && /^\d+$/.test(itemObj.id.trim())) {
          numericId = Number.parseInt(itemObj.id.trim(), 10);
        }
        if (!numericId || usedIds.has(numericId)) {
          numericId = Math.max(maxId + 1, 1);
        }
        usedIds.add(numericId);
        maxId = Math.max(maxId, numericId);

        const legacyText = typeof itemObj.text === "string" ? itemObj.text.trim() : "";
        const title = typeof itemObj.title === "string" && itemObj.title.trim()
          ? itemObj.title.trim()
          : (legacyText || `Item ${numericId}`);
        const body = typeof itemObj.body === "string" ? itemObj.body : "";
        const parsedStatusId = ListStatusIdSchema.safeParse(itemObj.statusId);
        if (!parsedStatusId.success) {
          throw new Error(`List "${id}" item ${numericId} is missing a valid "statusId"`);
        }
        const statusId = this.resolveStatusIdForList(statusIds, parsedStatusId.data, `list ${id} item ${numericId}`);

        const createdAt = typeof itemObj.createdAt === "string" ? itemObj.createdAt : null;
        const updatedAt = typeof itemObj.updatedAt === "string" ? itemObj.updatedAt : null;
        if (!createdAt || !updatedAt) {
          throw new Error(`List "${id}" item ${numericId} is missing required "createdAt" and "updatedAt"`);
        }

        return ListItemSchema.parse({
          id: numericId,
          title,
          body,
          statusId,
          createdAt,
          updatedAt,
        });
      });

      return ListSchema.parse({
        id,
        name,
        includeInSystemPrompt,
        view,
        columns,
        items,
        completeStatusIds: completeStatusIds && completeStatusIds.length > 0 ? completeStatusIds : undefined,
      });
    });

    return ListsFileSchema.parse({ lists });
  }

  private parseColumnsPatch(columns: Array<{ id: string; name: string; collapsed?: boolean; icon?: string }>): ListColumn[] {
    const parsed = z.array(ListColumnSchema).min(1).parse(columns);
    const deduped: ListColumn[] = [];
    const seen = new Set<string>();
    for (const column of parsed) {
      if (seen.has(column.id)) continue;
      deduped.push(column);
      seen.add(column.id);
    }
    if (deduped.length === 0) {
      throw new Error("List must define at least one column");
    }
    return deduped;
  }

  private parseColumnsFromRawList(listObj: Record<string, unknown>, listId: string): ListColumn[] {
    if (Array.isArray(listObj.columns)) {
      return this.parseColumnsPatch(listObj.columns as ListColumn[]);
    }
    throw new Error(`List "${listId}" is missing required "columns" array`);
  }

  private getColumnStatusIds(columns: ListColumn[]): string[] {
    return columns.map((column) => column.id);
  }

  private resolveStatusId(list: List, statusId: string | undefined, context?: string): string {
    return this.resolveStatusIdForList(this.getColumnStatusIds(list.columns), statusId, context);
  }

  private resolveStatusIdForList(statusIds: string[], statusId: string | undefined, context?: string): string {
    if (statusId === undefined) {
      return statusIds.includes("todo") ? "todo" : statusIds[0];
    }
    if (statusIds.includes(statusId)) return statusId;
    throw new Error(`Invalid statusId "${statusId}"${context ? ` for ${context}` : ""}`);
  }
}
