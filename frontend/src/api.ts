import { hc } from "hono/client";
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
  type QueryKey,
} from "@tanstack/react-query";
import type { AppType } from "@minhome/server/app";
import { useEffect, useRef, useCallback } from "react";
import type { DeviceData } from "./types.js";

export const api: any = hc<AppType>("/");

type OptimisticPatch = {
  queryKey: QueryKey;
  updater: (previous: unknown) => unknown;
};

type MutationContext = {
  snapshots: Array<{ queryKey: QueryKey; previous: unknown }>;
  invalidateQueryKeys: QueryKey[];
};

function uniqueQueryKeys(keys: QueryKey[]): QueryKey[] {
  const seen = new Set<string>();
  const result: QueryKey[] = [];
  for (const key of keys) {
    const stable = JSON.stringify(key);
    if (seen.has(stable)) continue;
    seen.add(stable);
    result.push(key);
  }
  return result;
}

function mergeStatePayload(
  base: Record<string, unknown> | undefined,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(payload)) {
    const current = next[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      next[key] = { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) };
      continue;
    }
    next[key] = value;
  }
  return next;
}

function updateDevicesCollection(
  previous: unknown,
  targetDeviceId: string,
  updater: (device: DeviceData) => DeviceData,
): unknown {
  if (!Array.isArray(previous)) return previous;
  return (previous as DeviceData[]).map((device) =>
    device.id === targetDeviceId ? updater(device) : device,
  );
}

function updateListsCollection(
  previous: unknown,
  listId: string,
  updater: (list: List) => List,
): unknown {
  if (!Array.isArray(previous)) return previous;
  return (previous as List[]).map((list) => (list.id === listId ? updater(list) : list));
}

function patchListOptimistically(list: List, patch: {
  name?: string;
  include_in_system_prompt?: boolean;
  view?: "list" | "kanban";
  columns?: ListColumn[];
  complete_status_ids?: string[];
}): List {
  return {
    ...list,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.include_in_system_prompt !== undefined
      ? { includeInSystemPrompt: patch.include_in_system_prompt }
      : {}),
    ...(patch.view !== undefined ? { view: patch.view } : {}),
    ...(patch.columns !== undefined ? { columns: patch.columns } : {}),
    ...(patch.complete_status_ids !== undefined ? { completeStatusIds: patch.complete_status_ids } : {}),
  };
}

function createOptimisticMutation<TData, TVariables>(args: {
  qc: ReturnType<typeof useQueryClient>;
  mutationFn: (variables: TVariables) => Promise<TData>;
  optimistic?: (variables: TVariables) => {
    patches: OptimisticPatch[];
    invalidateQueryKeys?: QueryKey[];
  };
  invalidateQueryKeys?: QueryKey[] | ((variables: TVariables) => QueryKey[]);
  onSuccess?: (data: TData, variables: TVariables, context: MutationContext | undefined) => void;
}) {
  const { qc, mutationFn, optimistic, invalidateQueryKeys, onSuccess } = args;
  return useMutation<TData, Error, TVariables, MutationContext>({
    mutationFn,
    onMutate: async (variables) => {
      const optimisticPlan = optimistic?.(variables);
      const patches = optimisticPlan?.patches ?? [];
      const invalidateFromOptimistic = optimisticPlan?.invalidateQueryKeys ?? [];
      const queryKeysToCancel = uniqueQueryKeys([
        ...patches.map((patch) => patch.queryKey),
        ...invalidateFromOptimistic,
      ]);

      await Promise.all(queryKeysToCancel.map((queryKey) => qc.cancelQueries({ queryKey })));

      const snapshots = patches.map((patch) => {
        const previous = qc.getQueryData(patch.queryKey);
        qc.setQueryData(patch.queryKey, patch.updater);
        return { queryKey: patch.queryKey, previous };
      });

      return {
        snapshots,
        invalidateQueryKeys: invalidateFromOptimistic,
      };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      for (const snapshot of context.snapshots) {
        qc.setQueryData(snapshot.queryKey, snapshot.previous);
      }
    },
    onSuccess: (data, variables, context) => {
      onSuccess?.(data, variables, context);
    },
    onSettled: (_data, _error, variables, context) => {
      const configuredInvalidate =
        typeof invalidateQueryKeys === "function"
          ? invalidateQueryKeys(variables)
          : (invalidateQueryKeys ?? []);
      const queryKeysToInvalidate = uniqueQueryKeys([
        ...(context?.invalidateQueryKeys ?? []),
        ...configuredInvalidate,
      ]);
      for (const queryKey of queryKeysToInvalidate) {
        qc.invalidateQueries({ queryKey });
      }
    },
  });
}

// --- Auth ---

export function useAuthCheck() {
  return useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const res = await api.api.auth.check.$get();
      return res.json() as Promise<{ required: boolean; authenticated: boolean }>;
    },
    retry: false,
    staleTime: Infinity,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (password: string) => {
      const res = await api.api.auth.login.$post({
        json: { password },
      });
      if (!res.ok) throw new Error("Invalid password");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.api.auth.logout.$post();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}

// --- Chats ---

export interface PersistedChatSummary {
  id: string;
  title?: string;
  source: "text" | "voice";
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastDeviceId?: string;
}

export interface PersistedChat {
  id: string;
  title?: string;
  source: "text" | "voice";
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    parts: Array<Record<string, unknown>>;
  }>;
  lastDeviceId?: string;
}

export function useChats() {
  return useQuery({
    queryKey: ["chats"],
    queryFn: async () => {
      const res = await api.api.chats.$get();
      if (!res.ok) throw new Error("Failed to fetch chats");
      return res.json() as Promise<PersistedChatSummary[]>;
    },
  });
}

export function useChatById(chatId: string | null) {
  return useQuery({
    queryKey: ["chat", chatId],
    enabled: Boolean(chatId),
    queryFn: async () => {
      const res = await api.api.chats[":id"].$get({ param: { id: chatId! } });
      if (!res.ok) throw new Error("Failed to fetch chat");
      return res.json() as Promise<PersistedChat>;
    },
  });
}

export function useCreateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload?: { title?: string; source?: "text" | "voice" }) => {
      const res = await api.api.chats.$post({ json: payload ?? {} });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to create chat");
      return data as PersistedChat;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatId: string) => {
      const res = await api.api.chats[":id"].$delete({ param: { id: chatId } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to delete chat");
      return data as { ok: true };
    },
    onSuccess: (_data, chatId) => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      qc.removeQueries({ queryKey: ["chat", chatId] });
    },
  });
}

// --- Hooks ---

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await api.api.devices.$get();
      return res.json();
    },
    refetchInterval: 10_000,
  });
}

/** Ask the server to query all devices for fresh state, then refetch */
export function useRefreshStates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await api.api.devices.refresh.$post();
      return res.json();
    },
    onSuccess: () => {
      // Wait a moment for Z2M responses, then refetch
      setTimeout(() => qc.invalidateQueries({ queryKey: ["devices"] }), 1000);
    },
  });
}

export function useDevice(id: string) {
  return useQuery({
    queryKey: ["device", id],
    queryFn: async () => {
      const res = await api.api.devices[":id"].$get({ param: { id } });
      return res.json();
    },
  });
}

export function useSetDevice() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const res = await api.api.devices[":id"].set.$post({ param: { id }, json: payload });
      return res.json();
    },
    optimistic: ({ id, payload }) => ({
      patches: [
        {
          queryKey: ["devices"],
          updater: (previous) =>
            updateDevicesCollection(previous, id, (device) => {
              const nextState = mergeStatePayload(device.state, payload);
              return {
                ...device,
                state: nextState,
                entities: (device.entities ?? []).map((entity) => ({
                  ...entity,
                  state: mergeStatePayload(entity.state, payload),
                })),
              };
            }),
        },
      ],
    }),
    // Device state is reconciled by websocket events and polling.
    invalidateQueryKeys: [],
  });
}

export function useSetEntity() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async ({
      deviceId,
      entityKey,
      payload,
    }: {
      deviceId: string;
      entityKey: string;
      payload: Record<string, unknown>;
    }) => {
      const res = await api.api.devices[":id"].entities[":entityKey"].set.$post({
        param: { id: deviceId, entityKey },
        json: payload,
      });
      return res.json();
    },
    optimistic: ({ deviceId, entityKey, payload }) => ({
      patches: [
        {
          queryKey: ["devices"],
          updater: (previous) =>
            updateDevicesCollection(previous, deviceId, (device) => {
              return {
                ...device,
                state: entityKey === "main"
                  ? mergeStatePayload(device.state, payload)
                  : device.state,
                entities: (device.entities ?? []).map((entity) => ({
                  ...entity,
                  state: entity.key === entityKey
                    ? mergeStatePayload(entity.state, payload)
                    : entity.state,
                })),
              };
            }),
        },
      ],
    }),
    invalidateQueryKeys: [],
  });
}

export function useRenameDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await api.api.devices[":id"].config.$put({ param: { id }, json: { name } });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
  });
}

export function useRenameEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ deviceId, entityId, name }: { deviceId: string; entityId: string; name: string }) => {
      const res = await api.api.devices[":id"].config.$put({
        param: { id: deviceId },
        json: { entities: { [entityId]: { name } } },
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const res = await api.api.config.$get();
      return res.json();
    },
  });
}

export function useSaveRoomCamera() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (camera: { position: [number, number, number]; target: [number, number, number]; zoom: number }) => {
      const res = await api.api.config.room.camera.$put({ json: camera });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });
}

export function useAutomations() {
  return useQuery({
    queryKey: ["automations"],
    queryFn: async () => {
      const res = await api.api.automations.$get();
      return res.json();
    },
  });
}

export function useUpdateAutomation() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const res = await api.api.automations[":id"].$put({ param: { id }, json: patch });
      return res.json();
    },
    optimistic: ({ id, patch }) => ({
      patches: [
        {
          queryKey: ["automations"],
          updater: (previous) => {
            if (!Array.isArray(previous)) return previous;
            return previous.map((automation) =>
              (automation as { id: string }).id === id
                ? { ...(automation as Record<string, unknown>), ...patch, id }
                : automation,
            );
          },
        },
      ],
    }),
    invalidateQueryKeys: [["automations"]],
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async (id: string) => {
      const res = await api.api.automations[":id"].$delete({ param: { id } });
      return res.json();
    },
    optimistic: (id) => ({
      patches: [
        {
          queryKey: ["automations"],
          updater: (previous) => {
            if (!Array.isArray(previous)) return previous;
            return previous.filter((automation) => (automation as { id: string }).id !== id);
          },
        },
      ],
    }),
    invalidateQueryKeys: [["automations"]],
  });
}

// --- Lists ---

export type ListStatusId = string;

export interface ListItem {
  id: number;
  title: string;
  body: string;
  statusId: ListStatusId;
  createdAt: string;
  updatedAt: string;
}

export interface ListColumn {
  id: ListStatusId;
  name: string;
  collapsed: boolean;
  icon?: string;
}

export interface List {
  id: string;
  name: string;
  includeInSystemPrompt: boolean;
  view: "list" | "kanban";
  columns: ListColumn[];
  items: ListItem[];
  completeStatusIds?: string[];
}

export function useLists() {
  return useQuery({
    queryKey: ["lists"],
    queryFn: async () => {
      const res = await api.api.lists.$get();
      if (!res.ok) throw new Error("Failed to fetch lists");
      return res.json() as Promise<List[]>;
    },
  });
}

export function useList(listId: string | null) {
  return useQuery({
    queryKey: ["lists", listId],
    enabled: Boolean(listId),
    queryFn: async () => {
      const res = await api.api.lists[":listId"].$get({
        param: { listId: listId! },
      });
      if (!res.ok) throw new Error("Failed to fetch list");
      return res.json() as Promise<List>;
    },
  });
}

export function useCreateList() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async (payload: { id: string; name: string; include_in_system_prompt?: boolean; view?: "list" | "kanban"; columns?: ListColumn[]; complete_status_ids?: string[] }) => {
      const res = await api.api.lists.$post({
        json: payload,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to create list");
      return data as List;
    },
    optimistic: (payload) => {
      const optimisticList: List = {
        id: payload.id,
        name: payload.name,
        includeInSystemPrompt: payload.include_in_system_prompt ?? false,
        view: payload.view ?? "list",
        columns: payload.columns ?? [],
        items: [],
        ...(payload.complete_status_ids ? { completeStatusIds: payload.complete_status_ids } : {}),
      };
      return {
        patches: [
          {
            queryKey: ["lists"],
            updater: (previous) => {
              if (!Array.isArray(previous)) return previous;
              const existing = (previous as List[]).some((list) => list.id === payload.id);
              if (existing) return previous;
              return [...(previous as List[]), optimisticList];
            },
          },
          {
            queryKey: ["lists", payload.id],
            updater: () => optimisticList,
          },
        ],
      };
    },
    invalidateQueryKeys: (payload) => [["lists"], ["lists", payload.id]],
  });
}

export function useUpdateList() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async ({
      listId,
      patch,
    }: {
      listId: string;
      patch: { name?: string; include_in_system_prompt?: boolean; view?: "list" | "kanban"; columns?: ListColumn[]; complete_status_ids?: string[] };
    }) => {
      const res = await api.api.lists[":listId"].$patch({
        param: { listId },
        json: patch,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to update list");
      return data as { ok: true; list: List };
    },
    optimistic: ({ listId, patch }) => ({
      patches: [
        {
          queryKey: ["lists"],
          updater: (previous) =>
            updateListsCollection(previous, listId, (list) => patchListOptimistically(list, patch)),
        },
        {
          queryKey: ["lists", listId],
          updater: (previous) => {
            if (!previous || typeof previous !== "object") return previous;
            return patchListOptimistically(previous as List, patch);
          },
        },
      ],
    }),
    invalidateQueryKeys: ({ listId }) => [["lists"], ["lists", listId]],
  });
}

export function useDeleteList() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async (listId: string) => {
      const res = await api.api.lists[":listId"].$delete({
        param: { listId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to delete list");
      return data as { ok: true };
    },
    optimistic: (listId) => ({
      patches: [
        {
          queryKey: ["lists"],
          updater: (previous) => {
            if (!Array.isArray(previous)) return previous;
            return (previous as List[]).filter((list) => list.id !== listId);
          },
        },
        {
          queryKey: ["lists", listId],
          updater: () => undefined,
        },
      ],
    }),
    invalidateQueryKeys: (listId) => [["lists"], ["lists", listId]],
  });
}

export function useUpsertListItem() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async ({
      listId,
      itemId,
      patch,
    }: {
      listId: string;
      itemId: number;
      patch: {
        title?: string;
        body?: string;
        status_id?: ListStatusId;
        list_name?: string;
        include_in_system_prompt?: boolean;
      };
    }) => {
      const res = await api.api.lists[":listId"].items[":itemId"].$put({
        param: { listId, itemId: String(itemId) },
        json: patch,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to upsert list item");
      return data as { ok: true; item: ListItem };
    },
    optimistic: ({ listId, itemId, patch }) => {
      const now = new Date().toISOString();
      const applyUpsert = (list: List): List => {
        const existingItem = list.items.find((item) => item.id === itemId);
        const statusId = patch.status_id
          ?? existingItem?.statusId
          ?? list.columns[0]?.id
          ?? "todo";
        const nextItem: ListItem = existingItem
          ? {
            ...existingItem,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.body !== undefined ? { body: patch.body } : {}),
            statusId,
            updatedAt: now,
          }
          : {
            id: itemId,
            title: patch.title ?? "New item",
            body: patch.body ?? "",
            statusId,
            createdAt: now,
            updatedAt: now,
          };
        return {
          ...list,
          ...(patch.list_name !== undefined ? { name: patch.list_name } : {}),
          ...(patch.include_in_system_prompt !== undefined
            ? { includeInSystemPrompt: patch.include_in_system_prompt }
            : {}),
          items: existingItem
            ? list.items.map((item) => (item.id === itemId ? nextItem : item))
            : [...list.items, nextItem],
        };
      };

      return {
        patches: [
          {
            queryKey: ["lists"],
            updater: (previous) => updateListsCollection(previous, listId, applyUpsert),
          },
          {
            queryKey: ["lists", listId],
            updater: (previous) => {
              if (!previous || typeof previous !== "object") return previous;
              return applyUpsert(previous as List);
            },
          },
        ],
      };
    },
    invalidateQueryKeys: ({ listId }) => [["lists"], ["lists", listId]],
  });
}

export function useSetListItemStatus() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async ({
      listId,
      itemId,
      statusId,
    }: {
      listId: string;
      itemId: number;
      statusId: ListStatusId;
    }) => {
      const res = await api.api.lists[":listId"].items[":itemId"].status.$patch({
        param: { listId, itemId: String(itemId) },
        json: { status_id: statusId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to set list item status");
      return data as { ok: true; item: ListItem };
    },
    optimistic: ({ listId, itemId, statusId }) => {
      const now = new Date().toISOString();
      const applyStatus = (list: List): List => ({
        ...list,
        items: list.items.map((item) =>
          item.id === itemId ? { ...item, statusId, updatedAt: now } : item,
        ),
      });
      return {
        patches: [
          {
            queryKey: ["lists"],
            updater: (previous) => updateListsCollection(previous, listId, applyStatus),
          },
          {
            queryKey: ["lists", listId],
            updater: (previous) => {
              if (!previous || typeof previous !== "object") return previous;
              return applyStatus(previous as List);
            },
          },
        ],
      };
    },
    invalidateQueryKeys: ({ listId }) => [["lists"], ["lists", listId]],
  });
}

export function useDeleteListItem() {
  const qc = useQueryClient();
  return createOptimisticMutation({
    qc,
    mutationFn: async ({ listId, itemId }: { listId: string; itemId: number }) => {
      const res = await api.api.lists[":listId"].items[":itemId"].$delete({
        param: { listId, itemId: String(itemId) },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to delete list item");
      return data as { ok: true };
    },
    optimistic: ({ listId, itemId }) => {
      const applyDelete = (list: List): List => ({
        ...list,
        items: list.items.filter((item) => item.id !== itemId),
      });
      return {
        patches: [
          {
            queryKey: ["lists"],
            updater: (previous) => updateListsCollection(previous, listId, applyDelete),
          },
          {
            queryKey: ["lists", listId],
            updater: (previous) => {
              if (!previous || typeof previous !== "object") return previous;
              return applyDelete(previous as List);
            },
          },
        ],
      };
    },
    invalidateQueryKeys: ({ listId }) => [["lists"], ["lists", listId]],
  });
}

// --- Debug logs ---

export interface DebugLogEntry {
  id: number;
  timestamp: string;
  type: string;
  summary: string;
  data?: unknown;
}

export interface DebugLogPage {
  entries: DebugLogEntry[];
  nextBefore: number | null;
  hasMore: boolean;
}

const DEBUG_LOG_PAGE_SIZE = 200;

export function useDebugLogsInfinite() {
  return useInfiniteQuery({
    queryKey: ["debug-logs"],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.debug.logs.$get({
        query: {
          limit: String(DEBUG_LOG_PAGE_SIZE),
          before: pageParam != null ? String(pageParam) : undefined,
        },
      });
      return res.json() as Promise<DebugLogPage>;
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextBefore ?? undefined) : undefined),
    refetchInterval: false, // we use WS for real-time updates
  });
}

export function useClearDebugLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.api.debug.logs.$delete();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debug-logs"] });
    },
  });
}

/** Subscribe to real-time debug log entries via WebSocket. */
export function useDebugLogStream(onEntry: (entry: DebugLogEntry) => void) {
  const callbackRef = useRef(onEntry);
  callbackRef.current = onEntry;

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/debug`);

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "debug_entry" && msg.data) {
          callbackRef.current(msg.data as DebugLogEntry);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      // Auto-reconnect after 3s
      setTimeout(() => {
        // The hook will re-run on next render cycle
      }, 3000);
    };

    return () => ws.close();
  }, []);
}

// --- Device event bus (fires on every raw state_change from WebSocket) ---

export const deviceEventBus = new EventTarget();

export interface DeviceStateChangeDetail {
  deviceId: string;
  state: Record<string, unknown>;
}

/** Subscribe to raw state_change events for a specific device. */
export function useDeviceEvent(deviceId: string, onEvent: (state: Record<string, unknown>) => void) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DeviceStateChangeDetail>).detail;
      if (detail.deviceId === deviceId) {
        callbackRef.current(detail.state);
      }
    };
    deviceEventBus.addEventListener("state_change", handler);
    return () => deviceEventBus.removeEventListener("state_change", handler);
  }, [deviceId]);
}

// --- WebSocket for real-time updates ---

export function useRealtimeUpdates() {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "state_change" || msg.type === "devices") {
          qc.invalidateQueries({ queryKey: ["devices"] });
        }
        if (msg.type === "state_change" && msg.data) {
          const { deviceId, state } = msg.data as { deviceId: string; state: Record<string, unknown> };
          deviceEventBus.dispatchEvent(new CustomEvent("state_change", {
            detail: { deviceId, state } satisfies DeviceStateChangeDetail,
          }));
        }
        if (msg.type === "config_change") {
          qc.invalidateQueries({ queryKey: ["config"] });
        }
        if (msg.type === "automations_change") {
          qc.invalidateQueries({ queryKey: ["automations"] });
        }
        if (msg.type === "lists_change") {
          qc.invalidateQueries({ queryKey: ["lists"] });
        }
        if (msg.type === "chats_change") {
          qc.invalidateQueries({ queryKey: ["chats"] });
          qc.invalidateQueries({ queryKey: ["chat"] });
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setTimeout(connect, 3000); // auto-reconnect
    };

    wsRef.current = ws;
  }, [qc]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);
}

