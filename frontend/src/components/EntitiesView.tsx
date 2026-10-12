import { useRef, useEffect } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { useDevices, useSetEntity, useRefreshStates, useEntitiesView, useUpdateEntitiesView } from "../api.js";
import { SortableItem, useCardSensors } from "./ui/sortable.js";
import { applyOrder } from "../lib/order.js";
import { VibeStrip } from "./vibes/VibeStrip.js";
import { EntityCard } from "./entities/EntityCard.js";
import type { DeviceData, Entity } from "../types.js";

// ── Entities View ────────────────────────────────────────

interface FlatEntity {
  entity: Entity;
  device: DeviceData;
}

const cardKey = ({ device, entity }: FlatEntity) => `${device.id}:${entity.key}`;

export function EntitiesView() {
  const { data: devices, isLoading } = useDevices();
  const setEntity = useSetEntity();
  const refreshStates = useRefreshStates();
  const { data: layout } = useEntitiesView();
  const updateLayout = useUpdateEntitiesView();
  const sensors = useCardSensors();

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

  // Flatten all entities across all devices, in the saved card order
  const allEntities: FlatEntity[] = applyOrder(
    (devices as DeviceData[]).flatMap((d) => (d.entities ?? []).map((entity) => ({ entity, device: d }))),
    cardKey,
    layout?.entityOrder,
  );
  const keys = allEntities.map(cardKey);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    updateLayout.mutate({ entityOrder: arrayMove(keys, from, to) });
  };

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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={keys} strategy={rectSortingStrategy}>
          <div className="grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
            {allEntities.map((item) => (
              <SortableItem key={cardKey(item)} id={cardKey(item)}>
                <EntityCard
                  entity={item.entity}
                  device={item.device}
                  onSet={(payload) => setEntity.mutate({ deviceId: item.device.id, entityKey: item.entity.key, payload })}
                />
              </SortableItem>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
