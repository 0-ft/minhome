import { Link } from "react-router-dom";
import { ChevronRight, Lightbulb, Plug, Power, Radio } from "lucide-react";
import type { DeviceData, Entity } from "../../types.js";
import { cn } from "../../lib/utils.js";
import { LightControls } from "../LightControls.js";
import { useEntityControls } from "./useEntityControls.js";

export const entityPath = (deviceId: string, entityKey: string) =>
  `/entities/${encodeURIComponent(deviceId)}/${encodeURIComponent(entityKey)}`;

export function entityIcon(entity: Entity) {
  return entity.type === "sensor" ? Radio : entity.type === "light" ? Lightbulb : Plug;
}

/**
 * Homescreen card for one entity. While a light is on the whole card takes
 * the colour it is giving off, with text in white or black for contrast.
 */
export function EntityCard({ entity, device, onSet }: {
  entity: Entity;
  device: DeviceData;
  onSet: (payload: Record<string, unknown>) => void;
}) {
  if (entity.type === "sensor") return <SensorCard entity={entity} device={device} />;
  return <ControllableCard entity={entity} device={device} onSet={onSet} />;
}

function ControllableCard({ entity, device, onSet }: {
  entity: Entity;
  device: DeviceData;
  onSet: (payload: Record<string, unknown>) => void;
}) {
  const controls = useEntityControls(entity, onSet);
  const { isOn, surface } = controls;
  const Icon = entityIcon(entity);
  const hasSliders = Object.values(controls.lightControls.show).some(Boolean);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl p-3.5 transition-[background-color,color,box-shadow] duration-300",
        surface ? "shadow-md" : "bg-grey-200 text-grey-800",
      )}
      style={surface ?? undefined}
    >
      <div className="flex items-center gap-3">
        <Link
          to={entityPath(device.id, entity.key)}
          className="group flex min-w-0 flex-1 items-center gap-3"
        >
          <span className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
            isOn ? "bg-white/25" : "bg-grey-300/80 text-grey-600",
          )}>
            <Icon className="h-5 w-5" />
          </span>
          <span className="truncate text-[15px] font-semibold">{entity.name}</span>
          <ChevronRight className="h-4 w-4 shrink-0 opacity-0 -translate-x-1 transition group-hover:opacity-60 group-hover:translate-x-0" />
        </Link>
        <button
          type="button"
          onClick={controls.toggle}
          aria-pressed={isOn}
          aria-label={isOn ? `Turn ${entity.name} off` : `Turn ${entity.name} on`}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
            isOn ? "bg-white/30 hover:bg-white/45 shadow-sm" : "bg-grey-300/80 text-grey-600 hover:bg-grey-400/60",
          )}
        >
          <Power className="h-4.5 w-4.5" strokeWidth={2.5} />
        </button>
      </div>

      {hasSliders && (
        <div className="flex flex-col gap-1">
          <LightControls
            show={controls.lightControls.show}
            values={controls.values}
            serverValues={controls.serverValues}
            onChange={controls.change}
            onCommit={controls.commit}
          />
        </div>
      )}
    </div>
  );
}

function SensorCard({ entity, device }: { entity: Entity; device: DeviceData }) {
  const Icon = entityIcon(entity);
  const readings = (entity.sensorProperties ?? []).filter((sp) => entity.state?.[sp.property] !== undefined);

  return (
    <Link
      to={entityPath(device.id, entity.key)}
      className="group flex flex-col gap-3 rounded-2xl bg-grey-200 p-3.5 text-grey-800 transition-colors hover:bg-grey-300/70"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-grey-300/80 text-grey-600">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{entity.name}</span>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-0 transition group-hover:opacity-60" />
      </div>
      {readings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {readings.map((sp) => (
            <span key={sp.property} className="inline-flex items-baseline gap-1.5 rounded-lg bg-white/70 px-2.5 py-1">
              <span className="text-[11px] text-grey-500">{sp.name}</span>
              <span className="text-sm font-semibold tabular-nums">
                {String(entity.state[sp.property])}{sp.unit ? ` ${sp.unit}` : ""}
              </span>
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
