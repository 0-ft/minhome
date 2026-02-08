import { hc } from "hono/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
        if (msg.type === "config_change") {
          qc.invalidateQueries({ queryKey: ["config"] });
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

