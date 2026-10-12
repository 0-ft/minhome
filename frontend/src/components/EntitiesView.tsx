import { useRef, useEffect } from "react";
import { useDevices, useSetEntity, useRefreshStates } from "../api.js";
import { VibeStrip } from "./vibes/VibeStrip.js";
import { EntityCard } from "./entities/EntityCard.js";
import type { DeviceData, Entity } from "../types.js";

// ── Entities View ────────────────────────────────────────

interface FlatEntity {
  entity: Entity;
  device: DeviceData;
}

export function EntitiesView() {
  const { data: devices, isLoading } = useDevices();
  const setEntity = useSetEntity();
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
      <div className="flex items-center gap-2 text-sm text-grey-600 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading entities…
      </div>
    );
  }

  if (!devices || !Array.isArray(devices) || devices.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-grey-700">No devices found.</p>
        <p className="text-xs font-mono text-grey-500 mt-1">Pair Zigbee devices via Z2M to get started.</p>
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
        <p className="text-sm text-grey-700">No controllable entities found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <VibeStrip />
      <div className="grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
        {allEntities.map(({ entity, device }) => (
          <EntityCard
            key={`${device.id}:${entity.key}`}
            entity={entity}
            device={device}
            onSet={(payload) => setEntity.mutate({ deviceId: device.id, entityKey: entity.key, payload })}
          />
        ))}
      </div>
    </div>
  );
}
