import { useState, useRef, useEffect } from "react";
import { useDevices, useSetEntity, useRenameEntity, useSetEntityDescription, useRefreshStates } from "../api.js";
import { Button } from "./ui/button.js";
import { LightControls } from "./LightControls.js";
import { VibeStrip } from "./vibes/VibeStrip.js";
import { EditableText } from "./ui/editable-text.js";
import { Lightbulb, Plug, Power, Radio } from "lucide-react";
import type { DeviceData, Entity } from "../types.js";
import { hslCss } from "../lib/color.js";

// ── Entities View ────────────────────────────────────────

interface FlatEntity {
  entity: Entity;
  device: DeviceData;
}

export function EntitiesView() {
  const { data: devices, isLoading } = useDevices();
  const setEntity = useSetEntity();
  const renameEntity = useRenameEntity();
  const setDescription = useSetEntityDescription();
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
    <div className="flex flex-col gap-5">
      <VibeStrip devices={devices as DeviceData[]} />
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]">
        {allEntities.map(({ entity, device }) => (
          <EntityCard
            key={`${device.id}:${entity.key}`}
            entity={entity}
            device={device}
            onSet={(payload) => setEntity.mutate({ deviceId: device.id, entityKey: entity.key, payload })}
            onRename={(name) => renameEntity.mutate({ deviceId: device.id, entityId: entity.key, name })}
            onDescribe={(description) => setDescription.mutate({ deviceId: device.id, entityId: entity.key, description })}
          />
        ))}
      </div>
    </div>
  );
}

// ── Entity Card ──────────────────────────────────────────

function EntityCard({ entity, device, onSet, onRename, onDescribe }: {
  entity: Entity;
  device: DeviceData;
  onSet: (payload: Record<string, unknown>) => void;
  onRename: (name: string) => void;
  onDescribe: (description: string) => void;
}) {
  const { features, state } = entity;
  const isSensor = entity.type === "sensor";
  const isOn = state?.[features.stateProperty] === "ON" ||
    // canonical fallback
    state?.state === "ON";

  const isLight = entity.type === "light";
  const EntityIcon = isSensor ? Radio : isLight ? Lightbulb : Plug;

  // Slider values
  const serverBrightness = features.brightnessProperty && typeof state?.[features.brightnessProperty] === "number"
    ? state[features.brightnessProperty] as number : 127;
  const serverColorTemp = features.colorTempProperty && typeof state?.[features.colorTempProperty] === "number"
    ? state[features.colorTempProperty] as number : 370;
  const [brightness, setBrightness] = useState(serverBrightness);
  const [colorTemp, setColorTemp] = useState(serverColorTemp);

  // Colour (hue / saturation) from the composite color state object
  const colorObj = features.colorProperty && state?.[features.colorProperty] as { hue?: number; saturation?: number } | undefined;
  const serverHue = typeof colorObj?.hue === "number" ? colorObj.hue : 0;
  const serverSaturation = typeof colorObj?.saturation === "number" ? colorObj.saturation : 100;
  const [hue, setHue] = useState(serverHue);
  const [saturation, setSaturation] = useState(serverSaturation);

  const handleToggle = () => {
    if (isOn) {
      onSet({ [features.stateProperty]: "OFF" });
    } else {
      onSet({
        [features.stateProperty]: "ON",
        ...(features.brightnessProperty && { [features.brightnessProperty]: brightness }),
        ...(features.colorTempProperty && { [features.colorTempProperty]: colorTemp }),
        ...(features.colorProperty && { [features.colorProperty]: { hue, saturation } }),
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
          <div>
            <EditableText
              value={entity.name}
              onSave={onRename}
              textClassName={`text-sm font-semibold transition-colors ${
                isOn && !isSensor ? "hover:text-teal-700" : "hover:text-sand-900"
              }`}
            />
            <div className="text-[10px] font-mono truncate text-sand-500">
              {device.name}{entity.key !== "main" ? ` · ${entity.key}` : ""}
            </div>
            <EditableText
              value={entity.description ?? ""}
              onSave={onDescribe}
              allowEmpty
              placeholder="Add description…"
              textClassName="mt-0.5 text-[11px] leading-snug text-sand-600 hover:text-sand-800"
            />
          </div>
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
              {features.colorProperty && isOn ? (
                <div
                  className="h-3 w-3 rounded-full border border-sand-400/60 transition-colors"
                  style={{ background: hslCss(hue, saturation) }}
                />
              ) : (
                <div className={`h-1.5 w-1.5 rounded-full transition-colors ${isOn ? "bg-teal-400" : "bg-sand-400"}`} />
              )}
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

      {!isSensor && (
        <LightControls
          show={{
            brightness: !!features.brightnessProperty,
            colorTemp: !!features.colorTempProperty,
            color: !!features.colorProperty,
          }}
          values={{ brightness, colorTemp, hue, saturation }}
          serverValues={{ brightness: serverBrightness, colorTemp: serverColorTemp, hue: serverHue, saturation: serverSaturation }}
          active={isOn}
          onChange={(next) => {
            if (next.brightness !== undefined) setBrightness(next.brightness);
            if (next.colorTemp !== undefined) setColorTemp(next.colorTemp);
            if (next.hue !== undefined) setHue(next.hue);
            if (next.saturation !== undefined) setSaturation(next.saturation);
          }}
          onCommit={(commit) => {
            if ("brightness" in commit) onSet({ [features.brightnessProperty!]: commit.brightness });
            else if ("color_temp" in commit) onSet({ [features.colorTempProperty!]: commit.color_temp });
            else onSet({ [features.colorProperty!]: commit.color });
          }}
        />
      )}
    </div>
  );
}

