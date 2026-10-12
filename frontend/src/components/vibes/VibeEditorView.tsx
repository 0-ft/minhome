import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Camera, Play, Power, Sparkles, Trash2, X } from "lucide-react";
import { useApplyVibe, useDeleteVibe, useDevices, useUpdateVibe, useVibes } from "../../api.js";
import type { DeviceData, Entity, Vibe, VibeEntitySetting } from "../../types.js";
import { listControllableEntities, readCanonicalState, settingKey } from "../../lib/vibes.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Toggle } from "../ui/toggle.js";
import { IconPicker } from "../ui/icon-picker.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";
import { LightControls, type LightValues } from "../LightControls.js";
import { LucideIcon } from "../lists/LucideIcon.js";
import { EntityIcon } from "../entities/EntityIcon.js";
import { VibeBackground } from "./VibeBackground.js";

interface Draft {
  name: string;
  icon?: string;
  offUnspecified: boolean;
  entities: VibeEntitySetting[];
}

const draftFromVibe = (vibe: Vibe): Draft => ({
  name: vibe.name,
  icon: vibe.icon,
  offUnspecified: vibe.offUnspecified,
  entities: vibe.entities,
});

const DEFAULT_LIGHT: LightValues = { brightness: 200, colorTemp: 370, hue: 30, saturation: 80 };

/** Editor for one vibe at /entities/vibes/:vibeId. Changes autosave. */
export function VibeEditorView() {
  const { vibeId = "" } = useParams();
  const navigate = useNavigate();
  const { data: vibes, isLoading } = useVibes();
  const { data: devicesData } = useDevices();
  const devices = useMemo(() => (Array.isArray(devicesData) ? devicesData as DeviceData[] : []), [devicesData]);
  const vibe = vibes?.find((v) => v.id === vibeId);

  useEffect(() => {
    if (!isLoading && vibes && !vibe) navigate("/entities", { replace: true });
  }, [isLoading, vibes, vibe, navigate]);

  if (!vibe) {
    return (
      <div className="flex items-center gap-2 text-sm text-grey-600 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading vibe…
      </div>
    );
  }
  return <VibeEditor key={vibe.id} vibe={vibe} devices={devices} />;
}

function VibeEditor({ vibe, devices }: { vibe: Vibe; devices: DeviceData[] }) {
  const navigate = useNavigate();
  const updateVibe = useUpdateVibe();
  const deleteVibe = useDeleteVibe();
  const applyVibe = useApplyVibe();
  const [draft, setDraft] = useState<Draft>(() => draftFromVibe(vibe));
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Local edits bump editVersion; savedVersion catches up once saved. While
  // they match there are no unsaved edits, so outside changes (e.g. an agent
  // tweaking the vibe) re-seed the draft.
  const [editVersion, setEditVersion] = useState(0);
  const savedVersion = useRef(0);
  const edit = (update: (draft: Draft) => Draft) => {
    setDraft(update);
    setEditVersion((v) => v + 1);
  };

  const serverSignature = JSON.stringify(draftFromVibe(vibe));
  useEffect(() => {
    if (editVersion === savedVersion.current) setDraft(draftFromVibe(vibe));
  }, [serverSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editVersion === savedVersion.current) return;
    const name = draft.name.trim();
    if (!name) return;
    const version = editVersion;
    const t = setTimeout(() => {
      updateVibe.mutate(
        { id: vibe.id, patch: { name, icon: draft.icon ?? "", off_unspecified: draft.offUnspecified, entities: draft.entities } },
        { onSuccess: () => { if (savedVersion.current < version) savedVersion.current = version; } },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [editVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const controllable = useMemo(() => listControllableEntities(devices), [devices]);
  const settingsByKey = new Map(draft.entities.map((s) => [settingKey(s.device, s.entity), s]));
  const knownKeys = new Set(controllable.map((c) => settingKey(c.device.id, c.entity.key)));
  const orphans = draft.entities.filter((s) => !knownKeys.has(settingKey(s.device, s.entity)));
  const byDevice = groupByDevice(controllable);
  const active = !!vibe.active;

  const setSetting = (key: string, next: VibeEntitySetting | null) => edit((d) => {
    const rest = d.entities.filter((s) => settingKey(s.device, s.entity) !== key);
    return { ...d, entities: next ? [...rest, next] : rest };
  });

  const recapture = () => {
    updateVibe.mutate(
      { id: vibe.id, patch: { recapture: true } },
      {
        onSuccess: (updated) => {
          savedVersion.current = editVersion;
          setDraft(draftFromVibe(updated));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={() => navigate("/entities")}
        className="self-start inline-flex items-center gap-1.5 text-sm text-grey-600 hover:text-grey-900"
      >
        <ArrowLeft className="h-4 w-4" /> Entities
      </button>

      {/* Preview header */}
      <div className="relative h-44 rounded-2xl overflow-hidden shadow-md">
        <VibeBackground vibe={{ id: vibe.id, entities: draft.entities }} />
        <div className="absolute inset-x-0 bottom-0 p-4 flex items-end gap-3 text-white">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/25 backdrop-blur-sm">
            {draft.icon ? <LucideIcon name={draft.icon} className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          </span>
          <input
            value={draft.name}
            onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
            aria-label="Vibe name"
            className="min-w-0 flex-1 bg-transparent text-2xl font-semibold drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)] placeholder:text-white/60 focus:outline-none border-b border-transparent focus:border-white/60"
            placeholder="Vibe name"
          />
          {active && <span className="shrink-0 rounded-full bg-black/25 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider backdrop-blur-sm">Active</span>}
        </div>
      </div>

      {/* Settings + actions */}
      <div className="rounded-xl border border-grey-300 bg-grey-50 px-5 py-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="w-56">
            <IconPicker value={draft.icon} onChange={(icon) => edit((d) => ({ ...d, icon }))} placeholder="Icon" />
          </div>
          <label className="flex items-center gap-2.5 text-sm text-grey-800">
            <Toggle
              checked={draft.offUnspecified}
              onCheckedChange={(offUnspecified) => edit((d) => ({ ...d, offUnspecified }))}
            />
            Turn off everything else
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="success" className="gap-1.5" onClick={() => applyVibe.mutate(vibe.id)} disabled={applyVibe.isPending}>
            <Play className="h-3.5 w-3.5" /> Apply
          </Button>
          <Button size="sm" variant="secondary" className="gap-1.5" onClick={recapture} disabled={updateVibe.isPending}>
            <Camera className="h-3.5 w-3.5" /> Update from current state
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5 text-blood-500 hover:text-blood-600 ml-auto" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Entities */}
      <div className="flex flex-col gap-4">
        {byDevice.map(({ device, entities }) => (
          <section key={device.id} className="flex flex-col gap-2">
            {entities.length > 1 && (
              <h3 className="text-[11px] uppercase tracking-wider text-grey-500 px-1">{device.name}</h3>
            )}
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]">
              {entities.map((entity) => {
                const key = settingKey(device.id, entity.key);
                return (
                  <EntitySettingCard
                    key={key}
                    device={device}
                    entity={entity}
                    setting={settingsByKey.get(key)}
                    offUnspecified={draft.offUnspecified}
                    onChange={(next) => setSetting(key, next)}
                  />
                );
              })}
            </div>
          </section>
        ))}

        {orphans.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] uppercase tracking-wider text-grey-500 px-1">Missing devices</h3>
            {orphans.map((s) => (
              <div key={settingKey(s.device, s.entity)} className="flex items-center gap-2 rounded-lg bg-grey-300/60 px-3 py-2 text-xs font-mono text-grey-700">
                <span className="flex-1 truncate">{s.device} · {s.entity} · {s.state}</span>
                <Button size="icon" variant="ghost" aria-label="Remove setting" onClick={() => setSetting(settingKey(s.device, s.entity), null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete vibe"
        message={`Delete "${vibe.name}"? This can't be undone.`}
        confirmLabel="Delete"
        pending={deleteVibe.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => deleteVibe.mutate(vibe.id, { onSuccess: () => navigate("/entities", { replace: true }) })}
      />
    </div>
  );
}

function groupByDevice(controllable: ReturnType<typeof listControllableEntities>) {
  const groups = new Map<string, { device: DeviceData; entities: Entity[] }>();
  for (const { device, entity } of controllable) {
    const group = groups.get(device.id) ?? { device, entities: [] };
    group.entities.push(entity);
    groups.set(device.id, group);
  }
  return [...groups.values()];
}

/** A new setting for an entity, seeded from its live state. */
function settingFromLive(device: DeviceData, entity: Entity): VibeEntitySetting {
  const live = readCanonicalState(entity);
  return {
    device: device.id,
    entity: entity.key,
    state: live.state ?? "ON",
    ...(live.state !== "OFF" && {
      ...(entity.features.brightnessProperty && { brightness: Math.max(1, live.brightness ?? DEFAULT_LIGHT.brightness) }),
      ...(live.color ? { color: live.color } : live.color_temp !== undefined ? { color_temp: live.color_temp } : {}),
    }),
  };
}

function EntitySettingCard({ device, entity, setting, offUnspecified, onChange }: {
  device: DeviceData;
  entity: Entity;
  setting: VibeEntitySetting | undefined;
  offUnspecified: boolean;
  onChange: (next: VibeEntitySetting | null) => void;
}) {
  const { features } = entity;
  const included = !!setting;
  const isOn = setting?.state === "ON";
  const hasColor = !!features.colorProperty;
  const hasTemp = !!features.colorTempProperty;
  const mode: "color" | "white" = setting?.color ? "color" : setting?.color_temp !== undefined ? "white" : hasColor && !hasTemp ? "color" : "white";

  const values: LightValues = {
    brightness: setting?.brightness ?? DEFAULT_LIGHT.brightness,
    colorTemp: setting?.color_temp ?? DEFAULT_LIGHT.colorTemp,
    hue: setting?.color?.hue ?? DEFAULT_LIGHT.hue,
    saturation: setting?.color?.saturation ?? DEFAULT_LIGHT.saturation,
  };

  const update = (patch: Partial<VibeEntitySetting>) => {
    if (setting) onChange({ ...setting, ...patch });
  };

  const turnOn = () => onChange({
    device: device.id,
    entity: entity.key,
    state: "ON",
    ...(features.brightnessProperty && { brightness: values.brightness }),
    ...(mode === "color" && hasColor ? { color: { hue: values.hue, saturation: values.saturation } } : hasTemp ? { color_temp: values.colorTemp } : {}),
  });

  const setMode = (next: "color" | "white") => {
    if (!setting) return;
    const { color: _color, color_temp: _temp, ...rest } = setting;
    onChange(next === "color"
      ? { ...rest, color: { hue: values.hue, saturation: values.saturation } }
      : { ...rest, color_temp: values.colorTemp });
  };

  return (
    <div className={cn(
      "flex flex-col gap-2.5 rounded-lg p-3 transition-colors",
      !included ? "bg-grey-300/40 text-grey-600" : isOn ? "bg-grey-200 text-grey-800" : "bg-grey-300/60 text-grey-700",
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={included}
          onChange={(e) => onChange(e.target.checked ? settingFromLive(device, entity) : null)}
          aria-label={`Include ${entity.name} in vibe`}
          className="mt-2 h-4 w-4 shrink-0 accent-teal-500 cursor-pointer"
        />
        <div className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          included && isOn ? "bg-teal-200/60 text-teal-700" : "bg-grey-400/50 text-grey-600",
        )}>
          <EntityIcon entity={entity} className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="truncate">{entity.name}</span>
            {entity.fixedColor && (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-grey-400/60"
                style={{ background: entity.fixedColor }}
                title={`Gives off ${entity.fixedColor}`}
              />
            )}
          </div>
          {entity.description
            ? <div className="text-[11px] leading-snug text-grey-600">{entity.description}</div>
            : <div className="text-[10px] font-mono truncate text-grey-500">{device.name}{entity.key !== "main" ? ` · ${entity.key}` : ""}</div>}
        </div>
        {included ? (
          <Button
            variant={isOn ? "success" : "secondary"}
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => (isOn ? onChange({ device: device.id, entity: entity.key, state: "OFF" }) : turnOn())}
          >
            <Power className="h-3 w-3" />
            <span className="font-mono text-[10px] uppercase">{isOn ? "on" : "off"}</span>
          </Button>
        ) : (
          <span className="shrink-0 pt-1.5 text-[10px] font-mono uppercase text-grey-500">
            {offUnspecified ? "turns off" : "untouched"}
          </span>
        )}
      </div>

      {included && isOn && hasColor && hasTemp && (
        <ToggleGroup type="single" value={mode} onValueChange={(v) => setMode(v as "color" | "white")} className="self-start">
          <ToggleGroupItem value="color">Colour</ToggleGroupItem>
          <ToggleGroupItem value="white">White</ToggleGroupItem>
        </ToggleGroup>
      )}

      {included && isOn && (
        <LightControls
          show={{
            brightness: !!features.brightnessProperty,
            colorTemp: hasTemp && mode === "white",
            color: hasColor && mode === "color",
          }}
          values={values}
          serverValues={values}
          onChange={(next) => {
            // Sliders echo their synced value back on mount; only real changes count as edits
            if (next.brightness !== undefined && next.brightness !== values.brightness) update({ brightness: next.brightness });
            if (next.colorTemp !== undefined && next.colorTemp !== values.colorTemp) update({ color_temp: next.colorTemp });
            if (next.hue !== undefined && next.hue !== values.hue) update({ color: { hue: next.hue, saturation: values.saturation } });
            if (next.saturation !== undefined && next.saturation !== values.saturation) update({ color: { hue: values.hue, saturation: next.saturation } });
          }}
          onCommit={() => { /* edits apply on change; the draft autosaves */ }}
        />
      )}
    </div>
  );
}
