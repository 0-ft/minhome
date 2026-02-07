import { Lightbulb, Plug, Zap } from "lucide-react";
import { useDevices, useAutomations } from "../api.js";
import { extractControls } from "../types.js";
import type { DeviceData } from "../types.js";
import type { ReactNode } from "react";

// ── Helpers ──────────────────────────────────────────────

function findDevice(devices: DeviceData[] | undefined, id: string): DeviceData | undefined {
  if (!devices || !Array.isArray(devices)) return undefined;
  return devices.find((d) => d.id === id);
}

function isLight(device: DeviceData): boolean {
  return extractControls(device.exposes).some((c) => c.type === "light");
}

// ── DeviceBadge ──────────────────────────────────────────

export function DeviceBadge({ id, children }: { id?: string; children?: ReactNode }) {
  const { data: devices } = useDevices();
  const device = id ? findDevice(devices as DeviceData[] | undefined, id) : undefined;
  const Icon = device && isLight(device) ? Lightbulb : Plug;

  return (
    <span
      className="device-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium
        bg-teal-100 text-teal-700 border border-teal-200 align-baseline whitespace-nowrap"
      title={id ?? undefined}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{children}</span>
    </span>
  );
}

// ── EntityBadge ──────────────────────────────────────────

export function EntityBadge({ id, device: deviceId, children }: { id?: string; device?: string; children?: ReactNode }) {
  const { data: devices } = useDevices();
  const device = deviceId ? findDevice(devices as DeviceData[] | undefined, deviceId) : undefined;
  const Icon = device && isLight(device) ? Lightbulb : Plug;

  return (
    <span
      className="entity-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium
        bg-sand-200 text-sand-700 border border-sand-300 align-baseline whitespace-nowrap"
      title={id && deviceId ? `${id}@${deviceId}` : undefined}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{children}</span>
    </span>
  );
}

// ── AutomationBadge ─────────────────────────────────────

export function AutomationBadge({ id, children }: { id?: string; children?: ReactNode }) {
  const { data: automations } = useAutomations();
  const automation = id && Array.isArray(automations)
    ? (automations as { id: string; name: string }[]).find((a) => a.id === id)
    : undefined;

  return (
    <span
      className="automation-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium
        bg-amber-100 text-amber-700 border border-amber-200 align-baseline whitespace-nowrap"
      title={id ?? undefined}
    >
      <Zap className="h-3 w-3 shrink-0" />
      <span>{children ?? automation?.name ?? id}</span>
    </span>
  );
}

