import { hc } from "hono/client";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import type { AppType } from "@minhome/server/app";
import { useEffect, useRef, useCallback } from "react";

export const api: any = hc<AppType>("/");

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
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const res = await api.api.devices[":id"].set.$post({ param: { id }, json: payload });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
  });
}

export function useSetEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ deviceId, entityKey, payload }: { deviceId: string; entityKey: string; payload: Record<string, unknown> }) => {
      const res = await api.api.devices[":id"].entities[":entityKey"].set.$post({
        param: { id: deviceId, entityKey },
        json: payload,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
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
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const res = await api.api.automations[":id"].$put({ param: { id }, json: patch });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations"] });
    },
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.api.automations[":id"].$delete({ param: { id } });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations"] });
    },
  });
}

// --- Todos ---

export type TodoStatus = string;

export interface TodoItem {
  id: number;
  title: string;
  body: string;
  status: TodoStatus;
}

export interface TodoColumn {
  status: TodoStatus;
  collapsed: boolean;
  icon?: string;
}

export interface TodoList {
  id: string;
  name: string;
  includeInSystemPrompt: boolean;
  view: "list" | "kanban";
  columns: TodoColumn[];
  items: TodoItem[];
}

export function useTodoLists() {
  return useQuery({
    queryKey: ["todos"],
    queryFn: async () => {
      const res = await api.api.todos.$get();
      if (!res.ok) throw new Error("Failed to fetch todo lists");
      return res.json() as Promise<TodoList[]>;
    },
  });
}

export function useTodoList(listId: string | null) {
  return useQuery({
    queryKey: ["todos", listId],
    enabled: Boolean(listId),
    queryFn: async () => {
      const res = await api.api.todos[":listId"].$get({
        param: { listId: listId! },
      });
      if (!res.ok) throw new Error("Failed to fetch todo list");
      return res.json() as Promise<TodoList>;
    },
  });
}

export function useCreateTodoList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; name: string; include_in_system_prompt?: boolean; view?: "list" | "kanban"; columns?: TodoColumn[] }) => {
      const res = await api.api.todos.lists.$post({
        json: payload,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to create todo list");
      return data as TodoList;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useUpdateTodoList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      listId,
      patch,
    }: {
      listId: string;
      patch: { name?: string; include_in_system_prompt?: boolean; view?: "list" | "kanban"; columns?: TodoColumn[] };
    }) => {
      const res = await api.api.todos[":listId"].$patch({
        param: { listId },
        json: patch,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to update todo list");
      return data as { ok: true; list: TodoList };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", vars.listId] });
    },
  });
}

export function useDeleteTodoList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listId: string) => {
      const res = await api.api.todos[":listId"].$delete({
        param: { listId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to delete todo list");
      return data as { ok: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useUpsertTodoItem() {
  const qc = useQueryClient();
  return useMutation({
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
        status?: TodoStatus;
        list_name?: string;
        include_in_system_prompt?: boolean;
      };
    }) => {
      const res = await api.api.todos[":listId"].items[":itemId"].$put({
        param: { listId, itemId: String(itemId) },
        json: patch,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to upsert todo item");
      return data as { ok: true; item: TodoItem };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", vars.listId] });
    },
  });
}

export function useSetTodoItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      listId,
      itemId,
      status,
    }: {
      listId: string;
      itemId: number;
      status: TodoStatus;
    }) => {
      const res = await api.api.todos[":listId"].items[":itemId"].status.$patch({
        param: { listId, itemId: String(itemId) },
        json: { status },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to set todo status");
      return data as { ok: true; item: TodoItem };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", vars.listId] });
    },
  });
}

export function useDeleteTodoItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, itemId }: { listId: string; itemId: number }) => {
      const res = await api.api.todos[":listId"].items[":itemId"].$delete({
        param: { listId, itemId: String(itemId) },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to delete todo item");
      return data as { ok: true };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", vars.listId] });
    },
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
        if (msg.type === "todos_change") {
          qc.invalidateQueries({ queryKey: ["todos"] });
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

