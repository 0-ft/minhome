import { useState } from "react";
import {
  Power, Sun, Thermometer, Search, List, Pencil, Plus, Trash2,
  ChevronDown, Loader2, Check, X, Wrench,
} from "lucide-react";
import { useDevices } from "../api.js";
import { DeviceBadge } from "./DeviceBadge.js";
import type { DeviceData } from "../types.js";

// ── Types ────────────────────────────────────────────────

export interface ToolPart {
  type: "dynamic-tool";
  toolName: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

type ToolInput = Record<string, unknown>;

// ── Helpers ──────────────────────────────────────────────

function getInput(part: ToolPart): ToolInput {
  return (part.input && typeof part.input === "object" ? part.input : {}) as ToolInput;
}

function findDevice(devices: DeviceData[] | undefined, id: string): DeviceData | undefined {
  if (!devices || !Array.isArray(devices)) return undefined;
  return devices.find((d) => d.id === id);
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

// ── Status indicator ─────────────────────────────────────

function StatusIcon({ state }: { state: string }) {
  if (state === "output-available") return <Check className="h-3 w-3 text-teal-600" />;
  if (state === "output-error") return <X className="h-3 w-3 text-blood-500" />;
  return <Loader2 className="h-3 w-3 animate-spin text-sand-500" />;
}

// ── Per-tool summary renderers ───────────────────────────

function ControlDeviceSummary({ input, devices }: { input: ToolInput; devices?: DeviceData[] }) {
  const deviceId = input.id as string | undefined;
  const device = deviceId ? findDevice(devices, deviceId) : undefined;
  const payload = parsePayload(input.payload);
  const entries = Object.entries(payload);

  if (entries.length === 0) {
    return (
      <span className="flex items-center gap-1.5">
        <Power className="h-3 w-3" />
        <span>Control</span>
        {deviceId && <DeviceBadge id={deviceId}>{device?.name ?? deviceId}</DeviceBadge>}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-0.5">
      {entries.map(([key, value]) => (
        <span key={key} className="flex items-center gap-1.5">
          <PayloadIcon prop={key} value={value} />
          {deviceId && <DeviceBadge id={deviceId}>{device?.name ?? deviceId}</DeviceBadge>}
          <span className="text-sand-500">→</span>
          <PayloadValue prop={key} value={value} />
        </span>
      ))}
    </span>
  );
}

function PayloadIcon({ prop, value }: { prop: string; value: unknown }) {
  if (prop === "state" || prop.startsWith("state")) {
    const isOn = String(value).toUpperCase() === "ON";
    return <Power className={`h-3 w-3 ${isOn ? "text-teal-600" : "text-blood-500"}`} />;
  }
  if (prop === "brightness") return <Sun className="h-3 w-3 text-amber-500" />;
  if (prop === "color_temp") return <Thermometer className="h-3 w-3 text-orange-500" />;
  return <Wrench className="h-3 w-3 text-sand-500" />;
}

function PayloadValue({ prop, value }: { prop: string; value: unknown }) {
  if (prop === "state" || prop.startsWith("state")) {
    const isOn = String(value).toUpperCase() === "ON";
    return (
      <span className={`font-semibold ${isOn ? "text-teal-700" : "text-blood-600"}`}>
        {isOn ? "ON" : "OFF"}
      </span>
    );
  }
  if (prop === "brightness") {
    const pct = Math.round((Number(value) / 254) * 100);
    return <span className="text-sand-700">{pct}%</span>;
  }
  if (prop === "color_temp") {
    return <span className="text-sand-700">{String(value)} mireds</span>;
  }
  return <span className="text-sand-700">{String(value)}</span>;
}

function GetDeviceSummary({ input, devices }: { input: ToolInput; devices?: DeviceData[] }) {
  const deviceId = input.id as string | undefined;
  const device = deviceId ? findDevice(devices, deviceId) : undefined;
  return (
    <span className="flex items-center gap-1.5">
      <Search className="h-3 w-3 text-sand-500" />
      <span>Inspecting</span>
      {deviceId && <DeviceBadge id={deviceId}>{device?.name ?? deviceId}</DeviceBadge>}
    </span>
  );
}

function RenameDeviceSummary({ input, devices }: { input: ToolInput; devices?: DeviceData[] }) {
  const deviceId = input.id as string | undefined;
  const device = deviceId ? findDevice(devices, deviceId) : undefined;
  const newName = input.name as string | undefined;
  return (
    <span className="flex items-center gap-1.5">
      <Pencil className="h-3 w-3 text-sand-500" />
      <span>Rename</span>
      {deviceId && <DeviceBadge id={deviceId}>{device?.name ?? deviceId}</DeviceBadge>}
      {newName && <>
        <span className="text-sand-500">→</span>
        <span className="font-semibold text-sand-700">{newName}</span>
      </>}
    </span>
  );
}

function RenameEntitySummary({ input, devices }: { input: ToolInput; devices?: DeviceData[] }) {
  const deviceId = input.id as string | undefined;
  const device = deviceId ? findDevice(devices, deviceId) : undefined;
  const entityId = input.entity_id as string | undefined;
  const newName = input.name as string | undefined;
  return (
    <span className="flex items-center gap-1.5">
      <Pencil className="h-3 w-3 text-sand-500" />
      <span>Rename</span>
      <span className="font-mono text-sand-600">{entityId}</span>
      {device && <span className="text-sand-400">on</span>}
      {deviceId && <DeviceBadge id={deviceId}>{device?.name ?? deviceId}</DeviceBadge>}
      {newName && <>
        <span className="text-sand-500">→</span>
        <span className="font-semibold text-sand-700">{newName}</span>
      </>}
    </span>
  );
}

function SimpleSummary({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="h-3 w-3 text-sand-500" />
      <span>{label}</span>
    </span>
  );
}

// ── Summary router ───────────────────────────────────────

function ToolSummary({ part, devices }: { part: ToolPart; devices?: DeviceData[] }) {
  const input = getInput(part);

  switch (part.toolName) {
    case "control_device":
      return <ControlDeviceSummary input={input} devices={devices} />;
    case "get_device":
      return <GetDeviceSummary input={input} devices={devices} />;
    case "list_devices":
      return <SimpleSummary icon={List} label="Listing all devices" />;
    case "rename_device":
      return <RenameDeviceSummary input={input} devices={devices} />;
    case "rename_entity":
      return <RenameEntitySummary input={input} devices={devices} />;
    case "list_automations":
      return <SimpleSummary icon={List} label="Listing automations" />;
    case "create_automation":
      return <SimpleSummary icon={Plus} label="Creating automation" />;
    case "update_automation":
      return <SimpleSummary icon={Pencil} label="Updating automation" />;
    case "delete_automation":
      return <SimpleSummary icon={Trash2} label="Deleting automation" />;
    default:
      return (
        <span className="flex items-center gap-1.5">
          <Wrench className="h-3 w-3 text-sand-500" />
          <span className="font-mono">{part.toolName}</span>
        </span>
      );
  }
}

// ── Main component ───────────────────────────────────────

export function ToolCallPart({ part }: { part: ToolPart }) {
  const [expanded, setExpanded] = useState(false);
  const { data: devices } = useDevices();

  const borderColor =
    part.state === "output-available"
      ? "border-teal-200"
      : part.state === "output-error"
        ? "border-blood-200"
        : "border-sand-300";

  return (
    <div className={`my-1.5 rounded-lg border ${borderColor} overflow-hidden`}>
      {/* Summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-sand-100/60 transition-colors cursor-pointer"
      >
        <StatusIcon state={part.state} />
        <div className="flex-1 min-w-0">
          <ToolSummary part={part} devices={devices as DeviceData[] | undefined} />
        </div>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-sand-400 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Expandable raw details */}
      {expanded && (
        <div className="px-2.5 pb-2 pt-1 border-t border-sand-200 font-mono text-[10px] leading-relaxed overflow-auto max-h-40 space-y-1">
          {part.input != null && (
            <div>
              <span className="text-sand-400">input </span>
              <pre className="text-sand-600 whitespace-pre-wrap break-all">
                {typeof part.input === "string"
                  ? part.input
                  : JSON.stringify(part.input, null, 2)}
              </pre>
            </div>
          )}
          {part.output != null && (
            <div>
              <span className="text-sand-400">output </span>
              <pre className="text-sand-600 whitespace-pre-wrap break-all">
                {typeof part.output === "string"
                  ? part.output
                  : JSON.stringify(part.output, null, 2)}
              </pre>
            </div>
          )}
          {part.errorText && (
            <div className="text-blood-500">
              error: {part.errorText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

