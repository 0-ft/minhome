import { useState, useRef, useEffect } from "react";
import { useDevices, useSetDevice, useRenameDevice, useRenameEntity, useAutomations, useDeleteAutomation, useRealtimeUpdates, useRefreshStates } from "./api.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card.js";
import { Button } from "./components/ui/button.js";
import { Badge } from "./components/ui/badge.js";
import { DebouncedSlider } from "./components/ui/slider.js";
import { Input } from "./components/ui/input.js";
import { Lightbulb, Plug, Power, Pencil, Check, Trash2, Thermometer, Sun, ChevronDown, Zap, Clock } from "lucide-react";

// --- Types for Z2M exposes ---

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

// --- App ---

export function App() {
  useRealtimeUpdates();
  const [tab, setTab] = useState<"devices" | "automations">("devices");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Minhome</h1>
          </div>
          <p className="text-xs text-muted-foreground ml-11">Smart room control</p>

          <nav className="flex gap-1 mt-5 bg-secondary/50 rounded-lg p-1 w-fit">
            <button
              onClick={() => setTab("devices")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                tab === "devices" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Devices
            </button>
            <button
              onClick={() => setTab("automations")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                tab === "automations" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Automations
            </button>
          </nav>
        </header>

        {tab === "devices" ? <DevicesView /> : <AutomationsView />}
      </div>
    </div>
  );
}

// --- Devices ---

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

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading devices...</p>;
  if (!devices || !Array.isArray(devices) || devices.length === 0) {
    return <p className="text-sm text-muted-foreground">No devices found.</p>;
  }

  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
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
    <Card className={`transition-all ${anyOn ? "border-primary/30 shadow-primary/5 shadow-lg" : ""}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
              anyOn ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
            }`}>
              <DeviceIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              {editing ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); onRename(nameInput); setEditing(false); }}
                  className="flex gap-1.5"
                >
                  <Input
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    className="h-6 text-xs w-28"
                    autoFocus
                  />
                  <Button type="submit" size="icon" variant="ghost" className="h-6 w-6">
                    <Check className="h-3 w-3" />
                  </Button>
                </form>
              ) : (
                <CardTitle
                  className="cursor-pointer hover:text-primary transition-colors truncate"
                  onClick={() => { setEditing(true); setNameInput(device.name); }}
                  title="Click to rename"
                >
                  {device.name}
                  <Pencil className="inline ml-1.5 h-2.5 w-2.5 opacity-0 group-hover:opacity-100 text-muted-foreground" />
                </CardTitle>
              )}
              <CardDescription className="truncate">
                {device.vendor && device.model ? `${device.vendor} ${device.model}` : device.id}
              </CardDescription>
            </div>
          </div>
          <Badge variant={anyOn ? "success" : "muted"} className="shrink-0 text-[10px]">
            {device.type}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
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
          <p className="text-xs text-muted-foreground">No controls available</p>
        )}

        {/* Raw state collapsible */}
        {device.state && Object.keys(device.state).length > 0 && (
          <div className="mt-3 pt-2 border-t border-border/50">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${showRaw ? "rotate-180" : ""}`} />
              Raw state
            </button>
            {showRaw && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                {Object.entries(device.state).map(([k, v]) => (
                  <span key={k} className="text-[10px] text-muted-foreground">
                    {k}: <span className="text-foreground/80 font-medium">{String(v)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
    <div className="flex flex-col gap-1.5 rounded-lg bg-secondary/40 p-2.5">
      <div className="flex items-center gap-2">
        {endpoint && (
          editingEntity ? (
            <form
              onSubmit={(e) => { e.preventDefault(); onRenameEntity(endpoint, entityInput); setEditingEntity(false); }}
              className="flex gap-1 items-center"
            >
              <Input
                value={entityInput}
                onChange={e => setEntityInput(e.target.value)}
                className="h-5 text-[10px] w-20 px-1"
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
              className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider min-w-8 cursor-pointer hover:text-foreground transition-colors"
              onClick={() => { setEntityInput(entityLabel ?? endpoint); setEditingEntity(true); }}
              title="Click to rename"
            >
              {entityLabel}
            </span>
          )
        )}
        <Button
          variant={isOn ? "success" : "secondary"}
          size="sm"
          onClick={() => onSet({ [ctrl.stateProperty]: isOn ? "OFF" : "ON" })}
          className="gap-1.5"
        >
          <Power className="h-3 w-3" />
          {isOn ? "ON" : "OFF"}
        </Button>
      </div>

      {ctrl.brightnessProperty && (
        <DebouncedSlider
          min={1} max={254}
          serverValue={typeof device.state?.[ctrl.brightnessProperty] === "number" ? device.state[ctrl.brightnessProperty] as number : 127}
          onCommit={(val) => onSet({ [ctrl.brightnessProperty!]: val })}
          label={<Sun className="h-3 w-3 text-muted-foreground" />}
        />
      )}

      {ctrl.colorTempProperty && (
        <DebouncedSlider
          min={142} max={500}
          serverValue={typeof device.state?.[ctrl.colorTempProperty] === "number" ? device.state[ctrl.colorTempProperty] as number : 370}
          onCommit={(val) => onSet({ [ctrl.colorTempProperty!]: val })}
          label={<Thermometer className="h-3 w-3 text-muted-foreground" />}
        />
      )}
    </div>
  );
}

// --- Automations ---

function AutomationsView() {
  const { data: automations, isLoading } = useAutomations();
  const deleteAuto = useDeleteAutomation();

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading automations...</p>;
  if (!automations || !Array.isArray(automations) || automations.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Clock className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No automations configured.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Use the CLI or API to create one.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {automations.map((a) => (
        <Card key={a.id} className={a.enabled ? "" : "opacity-50"}>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`h-2 w-2 rounded-full ${a.enabled ? "bg-success" : "bg-muted-foreground"}`} />
                <span className="text-sm font-medium">{a.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={a.enabled ? "success" : "muted"}>
                  {a.enabled ? "Active" : "Disabled"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => deleteAuto.mutate(a.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex gap-3 mt-2 ml-4.5">
              <span className="text-[11px] text-muted-foreground">
                Triggers: {a.triggers.map((t: { type: string }) => t.type).join(", ")}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Actions: {a.actions.map((act: { type: string }) => act.type).join(", ")}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
