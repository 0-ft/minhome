import { hc } from "hono/client";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import type { AppType } from "@minhome/server/app";
import { useEffect, useRef, useCallback } from "react";

export const api = hc<AppType>("/");

// --- Auth ---

export function useAuthCheck() {
  return useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const res = await fetch("/api/auth/check");
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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
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
      await fetch("/api/auth/logout", { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth"] });
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
      const res = await fetch("/api/todos");
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
      const res = await fetch(`/api/todos/${encodeURIComponent(listId!)}`);
      if (!res.ok) throw new Error("Failed to fetch todo list");
      return res.json() as Promise<TodoList>;
    },
  });
}

export function useCreateTodoList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; name: string; include_in_system_prompt?: boolean; view?: "list" | "kanban"; columns?: TodoColumn[] }) => {
      const res = await fetch("/api/todos/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      const res = await fetch(`/api/todos/${encodeURIComponent(listId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
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
      const res = await fetch(`/api/todos/${encodeURIComponent(listId)}`, {
        method: "DELETE",
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
      const res = await fetch(`/api/todos/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
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
      const res = await fetch(`/api/todos/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
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
      const res = await fetch(`/api/todos/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
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
      const params = new URLSearchParams();
      params.set("limit", String(DEBUG_LOG_PAGE_SIZE));
      if (pageParam != null) {
        params.set("before", String(pageParam));
      }
      const res = await fetch(`/api/debug/logs?${params.toString()}`);
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
      await fetch("/api/debug/logs", { method: "DELETE" });
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

