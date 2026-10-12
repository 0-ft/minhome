import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Power, Sparkles } from "lucide-react";
import {
  useDevices,
  useRenameEntity,
  useSetEntity,
  useUpdateEntityConfig,
  useVibes,
} from "../../api.js";
import type { DeviceData, Entity, Vibe, VibeEntitySetting } from "../../types.js";
import { cn } from "../../lib/utils.js";
import { hslCss, miredToCss } from "../../lib/color.js";
import { EditableText } from "../ui/editable-text.js";
import { LightControls } from "../LightControls.js";
import { LucideIcon } from "../lists/LucideIcon.js";
import { vibeEditorPath } from "../vibes/VibeStrip.js";
import { EntityIcon } from "./EntityIcon.js";
import { IconPicker } from "../ui/icon-picker.js";
import { useEntityControls } from "./useEntityControls.js";

/** Full page for one entity at /entities/:deviceId/:entityKey. */
export function EntityDetailView() {
  const { deviceId = "", entityKey = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useDevices();
  const devices = Array.isArray(data) ? data as DeviceData[] : undefined;
  const device = devices?.find((d) => d.id === deviceId);
  const entity = device?.entities.find((e) => e.key === entityKey);

  useEffect(() => {
    if (!isLoading && devices && !entity) navigate("/entities", { replace: true });
  }, [isLoading, devices, entity, navigate]);

  if (!device || !entity) {
    return (
      <div className="flex items-center gap-2 text-sm text-grey-600 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading…
      </div>
    );
  }
  return <EntityDetail key={`${device.id}:${entity.key}`} device={device} entity={entity} />;
}

function EntityDetail({ device, entity }: { device: DeviceData; entity: Entity }) {
  const setEntity = useSetEntity();
  const rename = useRenameEntity();
  const updateConfig = useUpdateEntityConfig();
  const update = (patch: { description?: string; fixedColor?: string; icon?: string }) =>
    updateConfig.mutate({ deviceId: device.id, entityId: entity.key, patch });
  const { data: vibes } = useVibes();

  const isSensor = entity.type === "sensor";
  const controls = useEntityControls(entity, (payload) =>
    setEntity.mutate({ deviceId: device.id, entityKey: entity.key, payload }),
  );
  const surface = isSensor ? null : controls.surface;
  const hasSliders = !isSensor && Object.values(controls.lightControls.show).some(Boolean);
  const canHaveFixedColor = !isSensor && !entity.features.colorProperty;
  const capabilities = [
    entity.features.brightnessProperty && "Brightness",
    entity.features.colorProperty && "Colour",
    entity.features.colorTempProperty && "White temperature",
  ].filter(Boolean) as string[];
  const usedIn = (vibes ?? []).flatMap((vibe) => {
    const setting = vibe.entities.find((s) => s.device === device.id && s.entity === entity.key);
    return setting || vibe.offUnspecified ? [{ vibe, setting }] : [];
  });

  return (
    <div className="flex flex-col gap-5">
      <Link to="/entities" className="self-start inline-flex items-center gap-1.5 text-sm text-grey-600 hover:text-grey-900">
        <ArrowLeft className="h-4 w-4" /> Entities
      </Link>

      {/* Hero: coloured like the light */}
      <section
        className={cn(
          "flex flex-col gap-5 rounded-3xl p-6 transition-[background-color,color] duration-300",
          surface ? "shadow-lg" : "bg-grey-200 text-grey-800",
        )}
        style={surface ?? undefined}
      >
        <div className="flex items-start gap-4">
          <span className={cn(
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl",
            surface ? "bg-white/25" : "bg-grey-300/80 text-grey-600",
          )}>
            <EntityIcon entity={entity} className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <EditableText
              value={entity.name}
              onSave={(name) => rename.mutate({ deviceId: device.id, entityId: entity.key, name })}
              textClassName="text-2xl font-semibold leading-tight"
            />
            <div className="mt-1 text-sm opacity-70">{device.name}</div>
          </div>
          {!isSensor && (
            <button
              type="button"
              onClick={controls.toggle}
              aria-pressed={controls.isOn}
              className={cn(
                "flex h-12 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
                surface ? "bg-white/30 hover:bg-white/45 shadow-sm" : "bg-grey-300/80 text-grey-700 hover:bg-grey-400/60",
              )}
            >
              <Power className="h-4 w-4" strokeWidth={2.5} />
              {controls.isOn ? "On" : "Off"}
            </button>
          )}
        </div>

        {hasSliders && (
          <div className="flex flex-col gap-1.5 rounded-2xl bg-black/5 p-4">
            <LightControls
              show={controls.lightControls.show}
              values={controls.values}
              serverValues={controls.serverValues}
              onChange={controls.change}
              onCommit={controls.commit}
            />
          </div>
        )}

        {isSensor && entity.sensorProperties && (
          <div className="flex flex-wrap gap-2">
            {entity.sensorProperties.map((sp) => entity.state?.[sp.property] !== undefined && (
              <span key={sp.property} className="flex flex-col rounded-2xl bg-white/70 px-4 py-2.5">
                <span className="text-[11px] uppercase tracking-wider text-grey-500">{sp.name}</span>
                <span className="text-xl font-semibold tabular-nums">
                  {String(entity.state[sp.property])}{sp.unit ? ` ${sp.unit}` : ""}
                </span>
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="grid items-start gap-5 md:grid-cols-2">
        <Panel title="About">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-grey-500">Description</span>
            <EditableText
              value={entity.description ?? ""}
              onSave={(description) => update({ description })}
              allowEmpty
              placeholder="What is this? e.g. the lamp behind the sofa"
              textClassName="text-sm text-grey-800"
            />
            <span className="text-[11px] text-grey-500">Agents use this to understand what the entity is.</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-grey-500">Icon</span>
            <IconPicker
              value={entity.icon}
              onChange={(icon) => update({ icon: icon ?? "" })}
              placeholder="Default icon"
            />
          </div>
          {canHaveFixedColor && (
            <FixedColorField
              value={entity.fixedColor}
              onChange={(fixedColor) => update({ fixedColor })}
            />
          )}
        </Panel>

        <Panel title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <Detail label="Type">{entity.type}</Detail>
            {capabilities.length > 0 && <Detail label="Controls">{capabilities.join(", ")}</Detail>}
            <Detail label="Device">{device.name}</Detail>
            {(device.vendor || device.model) && <Detail label="Model">{[device.vendor, device.model].filter(Boolean).join(" ")}</Detail>}
            {device.description && <Detail label="Hardware">{device.description}</Detail>}
            <Detail label="Address" mono>{device.id}</Detail>
            <Detail label="Entity key" mono>{entity.key}</Detail>
          </dl>
        </Panel>

        {!isSensor && (
          <Panel title="In vibes">
            {usedIn.length === 0 ? (
              <p className="text-sm text-grey-500">Not part of any vibe yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {usedIn.map(({ vibe, setting }) => (
                  <li key={vibe.id}>
                    <VibeUsage vibe={vibe} setting={setting} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <Panel title="Raw state">
          <pre className="overflow-x-auto rounded-xl bg-grey-100 p-3 text-[11px] leading-relaxed text-grey-700">
            {JSON.stringify(entity.state, null, 2)}
          </pre>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-grey-900">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-grey-500">{label}</dt>
      <dd className={cn("min-w-0 break-words text-grey-800", mono && "font-mono text-xs leading-5")}>{children}</dd>
    </>
  );
}

/** One vibe this entity is part of, with what the vibe sets it to. */
function VibeUsage({ vibe, setting }: { vibe: Vibe; setting?: VibeEntitySetting }) {
  const swatch = setting?.state === "ON"
    ? setting.color ? hslCss(setting.color.hue, setting.color.saturation, 55)
      : setting.color_temp !== undefined ? miredToCss(setting.color_temp) : undefined
    : undefined;
  const summary = !setting ? "Turned off"
    : setting.state === "OFF" ? "Off"
    : setting.brightness !== undefined ? `On · ${Math.round((setting.brightness / 254) * 100)}%` : "On";

  return (
    <Link to={vibeEditorPath(vibe.id)} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-grey-100 transition-colors">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-grey-200 text-grey-700">
        {vibe.icon ? <LucideIcon name={vibe.icon} className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </span>
      <span className="flex-1 truncate text-sm font-medium text-grey-800">{vibe.name}</span>
      {swatch && <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: swatch }} />}
      <span className="text-xs text-grey-500">{summary}</span>
    </Link>
  );
}

/** Colour a light gives off when it can't be colour-controlled. */
function FixedColorField({ value, onChange }: { value?: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  // Save shortly after the picker stops moving
  useEffect(() => {
    if (draft === null || draft === value) return;
    const t = setTimeout(() => onChange(draft), 400);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-grey-500">Light colour</span>
      <div className="flex items-center gap-2.5">
        <input
          type="color"
          value={draft ?? value ?? "#ff8fb1"}
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          className="h-9 w-12 cursor-pointer rounded-lg border border-grey-300 bg-transparent p-0.5"
          aria-label="Light colour"
        />
        <span className="font-mono text-xs text-grey-700">{value ?? "Not set"}</span>
        {value && (
          <button type="button" className="ml-auto text-xs text-grey-500 hover:text-grey-800" onClick={() => { setDraft(null); onChange(""); }}>
            Clear
          </button>
        )}
      </div>
      <span className="text-[11px] text-grey-500">
        For lights that can't change colour, e.g. a pink lamp. Colours its card and vibe artwork.
      </span>
    </div>
  );
}
