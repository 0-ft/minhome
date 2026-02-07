import { useState, useRef, useEffect } from "react";
import { useDevices, useSetDevice, useRenameDevice, useRenameEntity, useRefreshStates } from "../api.js";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";
import { DebouncedSlider } from "./ui/slider.js";
import { Input } from "./ui/input.js";
import { Lightbulb, Plug, Power, Check, Thermometer, Sun, ChevronRight, X } from "lucide-react";
import type { DeviceData, Control } from "../types.js";
import { extractControls } from "../types.js";

// ── Devices View ────────────────────────────────────────

export function DevicesView() {
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
      <div className="flex items-center gap-2 text-sm text-sand-600 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading devices…
      </div>
    );
  }

  if (!devices || !Array.isArray(devices) || devices.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-sand-700">No devices found.</p>
        <p className="text-xs font-mono text-sand-500 mt-1">Pair Zigbee devices via Z2M to get started.</p>
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

// ── Device Card ─────────────────────────────────────────

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

  const isLight = controls.some(c => c.type === "light");
  const DeviceIcon = isLight ? Lightbulb : Plug;

  return (
    <Card className="transition-all duration-200">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Icon */}
            <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-blood-500/50 text-blood-200">
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
                  className="cursor-pointer hover:text-teal-200 transition-colors truncate"
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

          <Badge variant="muted">
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
          <p className="text-xs font-mono text-blood-200">No controls</p>
        )}

        {/* Raw state */}
        {device.state && Object.keys(device.state).length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="flex items-center gap-1 text-[10px] font-mono text-blood-200 hover:text-blood-100 transition-colors cursor-pointer uppercase tracking-wider"
            >
              <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${showRaw ? "rotate-90" : ""}`} />
              raw state
            </button>
            {showRaw && (
              <div className="mt-2 p-3 rounded-lg bg-blood-600/40 font-mono text-[10px] leading-relaxed">
                {Object.entries(device.state).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="text-blood-200">{k}</span>
                    <span className="text-sand-50 font-medium">{String(v)}</span>
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

  // Lift slider values so we can bundle them into the ON command
  const serverBrightness = ctrl.brightnessProperty && typeof device.state?.[ctrl.brightnessProperty] === "number"
    ? device.state[ctrl.brightnessProperty] as number : 127;
  const serverColorTemp = ctrl.colorTempProperty && typeof device.state?.[ctrl.colorTempProperty] === "number"
    ? device.state[ctrl.colorTempProperty] as number : 370;
  const [brightness, setBrightness] = useState(serverBrightness);
  const [colorTemp, setColorTemp] = useState(serverColorTemp);

  const handleToggle = () => {
    if (isOn) {
      onSet({ [ctrl.stateProperty]: "OFF" });
    } else {
      // Bundle current slider values so the device turns on at the visible position
      onSet({
        [ctrl.stateProperty]: "ON",
        ...(ctrl.brightnessProperty && { [ctrl.brightnessProperty]: brightness }),
        ...(ctrl.colorTempProperty && { [ctrl.colorTempProperty]: colorTemp }),
      });
    }
  };

  return (
    <div className={`flex flex-col gap-2 rounded-lg p-3 transition-colors ${
      isOn ? "bg-sand-200 text-sand-800" : "bg-blood-500/40 text-blood-100"
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
                className={`h-5 text-[10px] w-20 px-1 font-mono ${isOn ? "bg-sand-300 text-sand-800 placeholder:text-sand-500" : ""}`}
                autoFocus
                onBlur={() => setEditingEntity(false)}
                onKeyDown={(e) => { if (e.key === "Escape") setEditingEntity(false); }}
              />
              <Button type="submit" size="icon" variant="ghost" className={`h-5 w-5 ${isOn ? "text-sand-600 hover:bg-sand-300" : ""}`}>
                <Check className="h-2.5 w-2.5" />
              </Button>
            </form>
          ) : (
            <span
              className={`text-[10px] font-mono font-medium uppercase tracking-wider min-w-8 cursor-pointer transition-colors ${
                isOn ? "text-teal-600 hover:text-teal-700" : "text-blood-200 hover:text-sand-50"
              }`}
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
          onClick={handleToggle}
          className="gap-1.5"
        >
          <Power className="h-3 w-3" />
          <span className="font-mono text-[10px] uppercase">{isOn ? "on" : "off"}</span>
        </Button>

        {/* Status dot */}
        <div className={`h-1.5 w-1.5 rounded-full transition-colors ${isOn ? "bg-teal-400" : "bg-blood-300"}`} />
      </div>

      {/* Sliders */}
      {ctrl.brightnessProperty && (
        <DebouncedSlider
          min={1} max={254}
          serverValue={serverBrightness}
          value={brightness}
          onValueChange={setBrightness}
          onCommit={(val) => onSet({ [ctrl.brightnessProperty!]: val })}
          label={<Sun className={`h-3.5 w-3.5 ${isOn ? "text-teal-600" : "text-blood-200"}`} />}
        />
      )}

      {ctrl.colorTempProperty && (
        <DebouncedSlider
          min={142} max={500}
          serverValue={serverColorTemp}
          value={colorTemp}
          onValueChange={setColorTemp}
          onCommit={(val) => onSet({ [ctrl.colorTempProperty!]: val })}
          label={<Thermometer className={`h-3.5 w-3.5 ${isOn ? "text-teal-600" : "text-blood-200"}`} />}
        />
      )}
    </div>
  );
}

