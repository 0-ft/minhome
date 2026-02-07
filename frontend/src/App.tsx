import { useState, useRef, useEffect } from "react";
import { useDevices, useSetDevice, useRenameDevice, useRenameEntity, useAutomations, useDeleteAutomation, useRealtimeUpdates, useRefreshStates } from "./api.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card.js";
import { Button } from "./components/ui/button.js";
import { Badge } from "./components/ui/badge.js";
import { DebouncedSlider } from "./components/ui/slider.js";
import { Input } from "./components/ui/input.js";
import { Lightbulb, Plug, Power, Check, Trash2, Thermometer, Sun, ChevronRight, X } from "lucide-react";

// ── Types for Z2M exposes ───────────────────────────────

interface Feature {
  access: number;
  name: string;
  property: string;
  type: string;
  label?: string;
  endpoint?: string;
  value_on?: unknown;
  value_off?: unknown;
  value_min?: number;
  value_max?: number;
  features?: Feature[];
}

interface Expose {
  type: string;
  endpoint?: string;
  features?: Feature[];
  name?: string;
  property?: string;
  access?: number;
}

interface DeviceData {
  id: string; name: string; type: string;
  vendor: string | null; model: string | null;
  state: Record<string, unknown>; exposes: Expose[];
  entities: Record<string, string>;
}

interface Control {
  type: string;
  endpoint?: string;
  stateProperty: string;
  brightnessProperty?: string;
  colorTempProperty?: string;
  label: string;
}

function extractControls(exposes: Expose[]): Control[] {
  const controls: Control[] = [];
  for (const expose of exposes) {
    if ((expose.type === "switch" || expose.type === "light") && expose.features) {
      const stateFeature = expose.features.find(f => f.name === "state" && f.type === "binary");
      if (!stateFeature) continue;
      const brightnessFeature = expose.features.find(f => f.name === "brightness" && f.type === "numeric");
      const colorTempFeature = expose.features.find(f => f.name === "color_temp" && f.type === "numeric");
      controls.push({
        type: expose.type,
        endpoint: expose.endpoint,
        stateProperty: stateFeature.property,
        brightnessProperty: brightnessFeature?.property,
        colorTempProperty: colorTempFeature?.property,
        label: expose.endpoint ?? expose.type,
      });
    }
  }
  return controls;
}

// ── App ─────────────────────────────────────────────────

export function App() {
  useRealtimeUpdates();
  const [tab, setTab] = useState<"devices" | "automations">("devices");

  return (
    <div className="min-h-screen bg-sand-100">
      {/* Header */}
      <header className="bg-sand-50">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-sand-900">
              minhome
            </h1>
            <p className="text-[11px] font-mono text-sand-500 mt-0.5">smart room control</p>
          </div>

          <nav className="flex gap-0.5 bg-sand-200 rounded-lg p-0.5">
            {(["devices", "automations"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition-all cursor-pointer ${
                  tab === t
                    ? "bg-blood-600 text-sand-50"
                    : "text-sand-600 hover:text-sand-800 hover:bg-sand-300"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {tab === "devices" ? <DevicesView /> : <AutomationsView />}
      </main>
    </div>
  );
}

// ── Devices ─────────────────────────────────────────────

function DevicesView() {
  const { data: devices, isLoading } = useDevices();
  const setDevice = useSetDevice();
  const renameDevice = useRenameDevice();
  const renameEntity = useRenameEntity();
  const refreshStates = useRefreshStates();

  const hasRefreshed = useRef(false);
  useEffect(() => {
    if (!hasRefreshed.current) {
      hasRefreshed.current = true;
      refreshStates.mutate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-sand-500 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading devices…
      </div>
    );
  }

  if (!devices || !Array.isArray(devices) || devices.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-sand-600">No devices found.</p>
        <p className="text-xs font-mono text-sand-400 mt-1">Pair Zigbee devices via Z2M to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {(devices as DeviceData[]).map((d) => (
        <DeviceCard
          key={d.id}
          device={d}
          onSet={(payload) => setDevice.mutate({ id: d.id, payload })}
          onRename={(name) => renameDevice.mutate({ id: d.id, name })}
          onRenameEntity={(entityId, name) => renameEntity.mutate({ deviceId: d.id, entityId, name })}
        />
      ))}
    </div>
  );
}

function DeviceCard({ device, onSet, onRename, onRenameEntity }: {
  device: DeviceData;
  onSet: (payload: Record<string, unknown>) => void;
  onRename: (name: string) => void;
  onRenameEntity: (entityId: string, name: string) => void;
}) {
  const controls = extractControls(device.exposes);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(device.name);
  const [showRaw, setShowRaw] = useState(false);

  const anyOn = controls.some(c => device.state?.[c.stateProperty] === "ON");
  const isLight = controls.some(c => c.type === "light");
  const DeviceIcon = isLight ? Lightbulb : Plug;

  return (
    <Card className={`transition-all duration-200 ${anyOn ? "bg-sand-50 ring-2 ring-teal-200" : ""}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Icon */}
            <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
              anyOn ? "bg-teal-100 text-teal-600" : "bg-sand-200 text-sand-600"
            }`}>
              <DeviceIcon className="h-4 w-4" />
            </div>

            {/* Name */}
            <div className="min-w-0">
              {editing ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); onRename(nameInput); setEditing(false); }}
                  className="flex gap-1.5 items-center"
                >
                  <Input
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    className="h-6 text-xs w-28 px-1.5"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
                  />
                  <Button type="submit" size="icon" variant="ghost" className="h-6 w-6">
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(false)}>
                    <X className="h-3 w-3" />
                  </Button>
                </form>
              ) : (
                <CardTitle
                  className="cursor-pointer hover:text-blood-600 transition-colors truncate"
                  onClick={() => { setEditing(true); setNameInput(device.name); }}
                  title="Click to rename"
                >
                  {device.name}
                </CardTitle>
              )}
              <CardDescription>
                {device.vendor && device.model ? `${device.vendor} · ${device.model}` : device.id}
              </CardDescription>
            </div>
          </div>

          <Badge variant={anyOn ? "success" : "muted"}>
            {device.type}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {/* Controls */}
        {controls.length > 0 ? (
          <div className="flex flex-col gap-2">
            {controls.map((ctrl) => (
              <ControlRow
                key={ctrl.stateProperty}
                ctrl={ctrl}
                device={device}
                onSet={onSet}
                onRenameEntity={onRenameEntity}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs font-mono text-sand-500">No controls</p>
        )}

        {/* Raw state */}
        {device.state && Object.keys(device.state).length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="flex items-center gap-1 text-[10px] font-mono text-sand-500 hover:text-sand-700 transition-colors cursor-pointer uppercase tracking-wider"
            >
              <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${showRaw ? "rotate-90" : ""}`} />
              raw state
            </button>
            {showRaw && (
              <div className="mt-2 p-3 rounded-lg bg-sand-100 font-mono text-[10px] leading-relaxed">
                {Object.entries(device.state).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="text-sand-500">{k}</span>
                    <span className="text-sand-800 font-medium">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Control Row ─────────────────────────────────────────

function ControlRow({ ctrl, device, onSet, onRenameEntity }: {
  ctrl: Control;
  device: DeviceData;
  onSet: (payload: Record<string, unknown>) => void;
  onRenameEntity: (entityId: string, name: string) => void;
}) {
  const isOn = device.state?.[ctrl.stateProperty] === "ON";
  const endpoint = ctrl.endpoint;
  const entityLabel = endpoint ? (device.entities?.[endpoint] ?? endpoint) : undefined;
  const [editingEntity, setEditingEntity] = useState(false);
  const [entityInput, setEntityInput] = useState(entityLabel ?? "");

  return (
    <div className={`flex flex-col gap-2 rounded-lg p-3 transition-colors ${
      isOn ? "bg-teal-50" : "bg-sand-100"
    }`}>
      <div className="flex items-center gap-2.5">
        {/* Entity label */}
        {endpoint && (
          editingEntity ? (
            <form
              onSubmit={(e) => { e.preventDefault(); onRenameEntity(endpoint, entityInput); setEditingEntity(false); }}
              className="flex gap-1 items-center"
            >
              <Input
                value={entityInput}
                onChange={e => setEntityInput(e.target.value)}
                className="h-5 text-[10px] w-20 px-1 font-mono"
                autoFocus
                onBlur={() => setEditingEntity(false)}
                onKeyDown={(e) => { if (e.key === "Escape") setEditingEntity(false); }}
              />
              <Button type="submit" size="icon" variant="ghost" className="h-5 w-5">
                <Check className="h-2.5 w-2.5" />
              </Button>
            </form>
          ) : (
            <span
              className="text-[10px] font-mono font-medium text-sand-700 uppercase tracking-wider min-w-8 cursor-pointer hover:text-blood-600 transition-colors"
              onClick={() => { setEntityInput(entityLabel ?? endpoint); setEditingEntity(true); }}
              title="Click to rename"
            >
              {entityLabel}
            </span>
          )
        )}

        {/* Power toggle */}
        <Button
          variant={isOn ? "success" : "secondary"}
          size="sm"
          onClick={() => onSet({ [ctrl.stateProperty]: isOn ? "OFF" : "ON" })}
          className="gap-1.5"
        >
          <Power className="h-3 w-3" />
          <span className="font-mono text-[10px] uppercase">{isOn ? "on" : "off"}</span>
        </Button>

        {/* Status dot */}
        <div className={`h-1.5 w-1.5 rounded-full transition-colors ${isOn ? "bg-teal-400" : "bg-sand-400"}`} />
      </div>

      {/* Sliders */}
      {ctrl.brightnessProperty && (
        <DebouncedSlider
          min={1} max={254}
          serverValue={typeof device.state?.[ctrl.brightnessProperty] === "number" ? device.state[ctrl.brightnessProperty] as number : 127}
          onCommit={(val) => onSet({ [ctrl.brightnessProperty!]: val })}
          label={<Sun className="h-3.5 w-3.5 text-sand-500" />}
        />
      )}

      {ctrl.colorTempProperty && (
        <DebouncedSlider
          min={142} max={500}
          serverValue={typeof device.state?.[ctrl.colorTempProperty] === "number" ? device.state[ctrl.colorTempProperty] as number : 370}
          onCommit={(val) => onSet({ [ctrl.colorTempProperty!]: val })}
          label={<Thermometer className="h-3.5 w-3.5 text-sand-500" />}
        />
      )}
    </div>
  );
}

// ── Automations ─────────────────────────────────────────

function AutomationsView() {
  const { data: automations, isLoading } = useAutomations();
  const deleteAuto = useDeleteAutomation();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-sand-500 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading automations…
      </div>
    );
  }

  if (!automations || !Array.isArray(automations) || automations.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-sand-600">No automations configured.</p>
        <p className="text-xs font-mono text-sand-400 mt-1">Use the CLI or API to create one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {automations.map((a) => (
        <Card key={a.id} className={a.enabled ? "" : "opacity-40"}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Status dot */}
                <div className={`h-2 w-2 rounded-full ${a.enabled ? "bg-teal-400" : "bg-sand-400"}`} />
                <span className="text-sm font-medium text-sand-900">{a.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={a.enabled ? "success" : "muted"}>
                  {a.enabled ? "Active" : "Off"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-blood-300 hover:text-blood-600"
                  onClick={() => deleteAuto.mutate(a.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex gap-4 mt-2 ml-5">
              <span className="text-[10px] font-mono text-sand-500 uppercase tracking-wider">
                triggers: {a.triggers.map((t: { type: string }) => t.type).join(", ")}
              </span>
              <span className="text-[10px] font-mono text-sand-500 uppercase tracking-wider">
                actions: {a.actions.map((act: { type: string }) => act.type).join(", ")}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
