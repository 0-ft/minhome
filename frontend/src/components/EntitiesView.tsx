import { useState, useRef, useEffect } from "react";
import { useDevices, useSetEntity, useRenameEntity, useRefreshStates } from "../api.js";
import { Button } from "./ui/button.js";
import { DebouncedSlider } from "./ui/slider.js";
import { Input } from "./ui/input.js";
import { Lightbulb, Plug, Power, Check, Thermometer, Sun, X, Radio } from "lucide-react";
import type { DeviceData, Entity } from "../types.js";

// ── Entities View ────────────────────────────────────────

interface FlatEntity {
  entity: Entity;
  device: DeviceData;
}

export function EntitiesView() {
  const { data: devices, isLoading } = useDevices();
  const setEntity = useSetEntity();
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
        Loading entities…
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

  // Flatten all entities across all devices
  const allEntities: FlatEntity[] = (devices as DeviceData[]).flatMap((d) =>
    (d.entities ?? []).map((entity) => ({ entity, device: d })),
  );

  if (allEntities.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-sand-700">No controllable entities found.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {allEntities.map(({ entity, device }) => (
        <EntityCard
          key={`${device.id}:${entity.key}`}
          entity={entity}
          device={device}
          onSet={(payload) => setEntity.mutate({ deviceId: device.id, entityKey: entity.key, payload })}
          onRename={(name) => renameEntity.mutate({ deviceId: device.id, entityId: entity.key, name })}
        />
      ))}
    </div>
  );
}

// ── Entity Card ──────────────────────────────────────────

function EntityCard({ entity, device, onSet, onRename }: {
  entity: Entity;
  device: DeviceData;
  onSet: (payload: Record<string, unknown>) => void;
  onRename: (name: string) => void;
}) {
  const { features, state } = entity;
  const isSensor = entity.type === "sensor";
  const isOn = state?.[features.stateProperty] === "ON" ||
    // canonical fallback
    state?.state === "ON";
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(entity.name);

  const isLight = entity.type === "light";
  const EntityIcon = isSensor ? Radio : isLight ? Lightbulb : Plug;

  // Slider values
  const serverBrightness = features.brightnessProperty && typeof state?.[features.brightnessProperty] === "number"
    ? state[features.brightnessProperty] as number : 127;
  const serverColorTemp = features.colorTempProperty && typeof state?.[features.colorTempProperty] === "number"
    ? state[features.colorTempProperty] as number : 370;
  const [brightness, setBrightness] = useState(serverBrightness);
  const [colorTemp, setColorTemp] = useState(serverColorTemp);

  const handleToggle = () => {
    if (isOn) {
      onSet({ state: "OFF" });
    } else {
      onSet({
        state: "ON",
        ...(features.brightnessProperty && { brightness }),
        ...(features.colorTempProperty && { color_temp: colorTemp }),
      });
    }
  };

  return (
    <div className={`flex flex-col gap-2.5 rounded-lg p-3 transition-colors ${
      isSensor ? "bg-sand-300/60 text-sand-700" :
      isOn ? "bg-sand-200 text-sand-800" : "bg-sand-300/60 text-sand-700"
    }`}>
      {/* Header row: icon, name, toggle */}
      <div className="flex items-center gap-2.5">
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
          isSensor ? "bg-sand-400/50 text-sand-600" :
          isOn ? "bg-teal-200/60 text-teal-700" : "bg-sand-400/50 text-sand-600"
        }`}>
          <EntityIcon className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0">
          {editing ? (
            <form
              onSubmit={(e) => { e.preventDefault(); onRename(nameInput); setEditing(false); }}
              className="flex gap-1 items-center"
            >
              <Input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                className={`h-6 text-xs w-28 px-1.5 ${isOn ? "bg-sand-300 text-sand-800" : "bg-sand-200 text-sand-800"}`}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
              />
              <Button type="submit" size="icon" variant="ghost" className="h-6 w-6 text-sand-600">
                <Check className="h-3 w-3" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-sand-600" onClick={() => setEditing(false)}>
                <X className="h-3 w-3" />
              </Button>
            </form>
          ) : (
            <div
              className="cursor-pointer"
              onClick={() => { setEditing(true); setNameInput(entity.name); }}
              title="Click to rename"
            >
                <div className={`text-sm font-semibold truncate transition-colors ${
                  isOn && !isSensor ? "hover:text-teal-700" : "hover:text-sand-900"
                }`}>
                  {entity.name}
                </div>
                <div className="text-[10px] font-mono truncate text-sand-500">
                {device.name}{entity.key !== "main" ? ` · ${entity.key}` : ""}
              </div>
            </div>
          )}
        </div>

        {!isSensor && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant={isOn ? "success" : "secondary"}
              size="sm"
              onClick={handleToggle}
              className="gap-1.5"
            >
              <Power className="h-3 w-3" />
              <span className="font-mono text-[10px] uppercase">{isOn ? "on" : "off"}</span>
            </Button>
              <div className={`h-1.5 w-1.5 rounded-full transition-colors ${isOn ? "bg-teal-400" : "bg-sand-400"}`} />
          </div>
        )}
      </div>

      {/* Sensor properties (read-only) */}
      {isSensor && entity.sensorProperties && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-0.5">
          {entity.sensorProperties.map((sp) => {
            const val = state?.[sp.property];
            if (val === undefined) return null;
            return (
              <div key={sp.property} className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-sand-500">{sp.name}</span>
                <span className="text-xs font-mono font-medium text-sand-800">
                  {String(val)}{sp.unit ? ` ${sp.unit}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Sliders */}
      {!isSensor && features.brightnessProperty && (
        <DebouncedSlider
          min={1} max={254}
          serverValue={serverBrightness}
          value={brightness}
          onValueChange={setBrightness}
          onCommit={(val) => onSet({ brightness: val })}
          label={<Sun className={`h-3.5 w-3.5 ${isOn ? "text-teal-600" : "text-sand-500"}`} />}
        />
      )}

      {!isSensor && features.colorTempProperty && (
        <DebouncedSlider
          min={142} max={500}
          serverValue={serverColorTemp}
          value={colorTemp}
          onValueChange={setColorTemp}
          onCommit={(val) => onSet({ color_temp: val })}
          label={<Thermometer className={`h-3.5 w-3.5 ${isOn ? "text-teal-600" : "text-sand-500"}`} />}
        />
      )}
    </div>
  );
}

