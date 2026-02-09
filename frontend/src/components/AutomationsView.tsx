import { useState, useMemo, useCallback } from "react";
import {
  Trash2, Plus, ChevronDown, Save, X,
  Radio, Zap, Shield,
} from "lucide-react";
import { useAutomations, useUpdateAutomation, useDeleteAutomation, useDevices } from "../api.js";
import type { DeviceData } from "../types.js";
import type { Automation, Trigger, Condition, Action } from "@minhome/server/automations";

// ── Defaults ──────────────────────────────────────────────

const TRIGGER_TYPES = ["device_state", "device_event", "mqtt", "cron", "time", "datetime", "interval"] as const;
const CONDITION_TYPES = ["time_range", "day_of_week", "device_state", "and", "or", "xor"] as const;
const ACTION_TYPES = ["device_set", "mqtt_publish", "delay", "conditional", "tool"] as const;

const TOOL_NAMES = [
  "list_devices", "get_device", "control_entity", "control_device",
  "rename_device", "rename_entity",
  "get_room_config", "set_room_dimensions", "set_room_lights",
  "update_room_furniture", "upsert_furniture_item", "remove_furniture_item",
  "set_voice", "announce",
] as const;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function defaultTrigger(type: string = "device_state"): Trigger {
  switch (type) {
    case "device_event": return { type: "device_event", device: "", property: "action" };
    case "mqtt":         return { type: "mqtt", topic: "" };
    case "cron":         return { type: "cron", expression: "0 * * * *" };
    case "time":         return { type: "time", at: "08:00" };
    case "datetime":     return { type: "datetime", at: new Date(Date.now() + 3600_000).toISOString().slice(0, 16) };
    case "interval":     return { type: "interval", every: 300 };
    default:             return { type: "device_state", device: "", entity: "main", property: "state" };
  }
}

function defaultCondition(type: string = "time_range"): Condition {
  switch (type) {
    case "day_of_week":  return { type: "day_of_week", days: [] };
    case "device_state": return { type: "device_state", device: "", entity: "main", property: "state", equals: "ON" };
    case "and":          return { type: "and", conditions: [defaultCondition("time_range")] };
    case "or":           return { type: "or", conditions: [defaultCondition("time_range")] };
    case "xor":          return { type: "xor", conditions: [defaultCondition("time_range")] };
    default:             return { type: "time_range", after: "08:00", before: "22:00" };
  }
}

function defaultAction(type: string = "device_set"): Action {
  switch (type) {
    case "mqtt_publish": return { type: "mqtt_publish", topic: "", payload: "" };
    case "delay":        return { type: "delay", seconds: 5 };
    case "conditional":  return { type: "conditional", condition: defaultCondition(), then: [defaultAction("device_set")] };
    case "tool":         return { type: "tool", tool: "control_entity", params: {} } as any;
    default:             return { type: "device_set", device: "", entity: "main", payload: {} };
  }
}

// ── Shared styling ────────────────────────────────────────

const fieldCls = "w-full rounded-lg bg-sand-100 border border-sand-300 px-3 py-1.5 text-sm text-sand-900 focus:outline-none focus:ring-2 focus:ring-teal-300/50";
const selectCls = fieldCls + " appearance-none cursor-pointer";
const labelCls = "text-[11px] font-mono text-sand-500 uppercase tracking-wider mb-1";
const removeBtnCls = "h-6 w-6 inline-flex items-center justify-center rounded text-sand-400 hover:text-blood-500 hover:bg-sand-200 transition-colors cursor-pointer shrink-0";
const addBtnCls = "inline-flex items-center gap-1.5 text-xs font-medium text-teal-600 hover:text-teal-700 cursor-pointer transition-colors py-1";

// ── Shared field components ───────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function DeviceSelect({ value, onChange, devices }: { value: string; onChange: (v: string) => void; devices: DeviceData[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      <option value="">Select device…</option>
      {devices.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  );
}

function EntitySelect({ value, onChange, device, devices }: { value: string; onChange: (v: string) => void; device: string; devices: DeviceData[] }) {
  const entities = useMemo(() => {
    const d = devices.find(d => d.id === device);
    return d?.entities ?? [];
  }, [device, devices]);

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      {entities.length === 0 && <option value="main">main</option>}
      {entities.map((e) => (
        <option key={e.key} value={e.key}>{e.name} ({e.key})</option>
      ))}
    </select>
  );
}

function SmartInput({ value, onChange, placeholder }: { value: unknown; onChange: (v: unknown) => void; placeholder?: string }) {
  const [text, setText] = useState(() => value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));

  const handleBlur = () => {
    if (text === "") { onChange(undefined); return; }
    try { onChange(JSON.parse(text)); } catch { onChange(text); }
  };

  return (
    <input
      className={fieldCls}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
      placeholder={placeholder}
    />
  );
}

function TypeSelect<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={selectCls}>
      {options.map((t) => (
        <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
      ))}
    </select>
  );
}

function SectionHeader({ icon: Icon, label, onAdd }: { icon: React.ComponentType<{ className?: string }>; label: string; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-sand-500" />
        <span className="text-xs font-semibold text-sand-700 uppercase tracking-wider">{label}</span>
      </div>
      <button type="button" onClick={onAdd} className={addBtnCls}>
        <Plus className="h-3 w-3" /> Add
      </button>
    </div>
  );
}

function ItemCard({ children, onRemove, accent = "sand" }: { children: React.ReactNode; onRemove: () => void; accent?: string }) {
  const accentColors: Record<string, string> = {
    teal: "border-l-teal-400",
    amber: "border-l-amber-400",
    sand: "border-l-sand-400",
    blood: "border-l-blood-300",
  };
  return (
    <div className={`relative rounded-lg border border-sand-200 bg-sand-50/50 p-3 pl-4 border-l-[3px] ${accentColors[accent] ?? accentColors.sand}`}>
      <button type="button" onClick={onRemove} className={`${removeBtnCls} absolute top-2 right-2`} title="Remove">
        <X className="h-3 w-3" />
      </button>
      <div className="pr-6">{children}</div>
    </div>
  );
}

// ── Trigger editor ────────────────────────────────────────

function TriggerEditor({ trigger, onChange, onRemove, devices }: {
  trigger: Trigger;
  onChange: (t: Trigger) => void;
  onRemove: () => void;
  devices: DeviceData[];
}) {
  const changeType = (type: string) => onChange(defaultTrigger(type));

  return (
    <ItemCard onRemove={onRemove} accent="teal">
      <div className="flex flex-col gap-3">
        <Field label="Type">
          <TypeSelect value={trigger.type} options={TRIGGER_TYPES} onChange={changeType} />
        </Field>

        {trigger.type === "device_state" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Device">
                <DeviceSelect value={trigger.device} onChange={(v) => onChange({ ...trigger, device: v })} devices={devices} />
              </Field>
              <Field label="Entity">
                <EntitySelect value={trigger.entity} onChange={(v) => onChange({ ...trigger, entity: v })} device={trigger.device} devices={devices} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Property">
                <input className={fieldCls} value={trigger.property} onChange={(e) => onChange({ ...trigger, property: e.target.value })} />
              </Field>
              <Field label="From (opt)">
                <SmartInput value={trigger.from} onChange={(v) => onChange({ ...trigger, from: v })} placeholder="any" />
              </Field>
              <Field label="To (opt)">
                <SmartInput value={trigger.to} onChange={(v) => onChange({ ...trigger, to: v })} placeholder="any" />
              </Field>
            </div>
          </>
        )}

        {trigger.type === "device_event" && (
          <>
            <Field label="Device">
              <DeviceSelect value={trigger.device} onChange={(v) => onChange({ ...trigger, device: v })} devices={devices} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Property">
                <input className={fieldCls} value={trigger.property} onChange={(e) => onChange({ ...trigger, property: e.target.value })} placeholder="action" />
              </Field>
              <Field label="Value (opt)">
                <SmartInput value={trigger.value} onChange={(v) => onChange({ ...trigger, value: v })} placeholder="any" />
              </Field>
            </div>
          </>
        )}

        {trigger.type === "mqtt" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Topic">
              <input className={fieldCls} value={trigger.topic} onChange={(e) => onChange({ ...trigger, topic: e.target.value })} />
            </Field>
            <Field label="Payload contains (opt)">
              <input className={fieldCls} value={trigger.payload_contains ?? ""} onChange={(e) => onChange({ ...trigger, payload_contains: e.target.value || undefined })} />
            </Field>
          </div>
        )}

        {trigger.type === "cron" && (
          <Field label="Expression">
            <input className={fieldCls} value={trigger.expression} onChange={(e) => onChange({ ...trigger, expression: e.target.value })} placeholder="0 * * * *" />
          </Field>
        )}

        {trigger.type === "time" && (
          <Field label="At (HH:MM:SS)">
            <input className={fieldCls} type="time" step="1" value={trigger.at} onChange={(e) => onChange({ ...trigger, at: e.target.value })} />
          </Field>
        )}

        {trigger.type === "datetime" && (
          <Field label="Date & Time">
            <input className={fieldCls} type="datetime-local" step="1" value={trigger.at} onChange={(e) => onChange({ ...trigger, at: e.target.value })} />
          </Field>
        )}

        {trigger.type === "interval" && (
          <Field label="Every (seconds)">
            <input className={fieldCls} type="number" min={1} value={trigger.every} onChange={(e) => onChange({ ...trigger, every: Number(e.target.value) || 1 })} />
          </Field>
        )}
      </div>
    </ItemCard>
  );
}

// ── Condition editor ──────────────────────────────────────

function ConditionEditor({ condition, onChange, onRemove, devices }: {
  condition: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
  devices: DeviceData[];
}) {
  const changeType = (type: string) => onChange(defaultCondition(type));

  return (
    <ItemCard onRemove={onRemove} accent="amber">
      <div className="flex flex-col gap-3">
        <Field label="Type">
          <TypeSelect value={condition.type} options={CONDITION_TYPES} onChange={changeType} />
        </Field>

        {condition.type === "time_range" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="After">
              <input className={fieldCls} type="time" value={condition.after} onChange={(e) => onChange({ ...condition, after: e.target.value })} />
            </Field>
            <Field label="Before">
              <input className={fieldCls} type="time" value={condition.before} onChange={(e) => onChange({ ...condition, before: e.target.value })} />
            </Field>
          </div>
        )}

        {condition.type === "day_of_week" && (
          <Field label="Days">
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((day) => {
                const active = condition.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => onChange({
                      ...condition,
                      days: active ? condition.days.filter((d) => d !== day) : [...condition.days, day],
                    })}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono uppercase cursor-pointer transition-colors ${
                      active
                        ? "bg-teal-400 text-teal-900"
                        : "bg-sand-200 text-sand-500 hover:bg-sand-300"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {condition.type === "device_state" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Device">
                <DeviceSelect value={condition.device} onChange={(v) => onChange({ ...condition, device: v })} devices={devices} />
              </Field>
              <Field label="Entity">
                <EntitySelect value={condition.entity} onChange={(v) => onChange({ ...condition, entity: v })} device={condition.device} devices={devices} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Property">
                <input className={fieldCls} value={condition.property} onChange={(e) => onChange({ ...condition, property: e.target.value })} />
              </Field>
              <Field label="Equals">
                <SmartInput value={condition.equals} onChange={(v) => onChange({ ...condition, equals: v })} />
              </Field>
            </div>
          </>
        )}

        {(condition.type === "and" || condition.type === "or" || condition.type === "xor") && (
          <div className="flex flex-col gap-2">
            <SectionHeader
              icon={Shield}
              label={`${condition.type.toUpperCase()} sub-conditions`}
              onAdd={() => onChange({ ...condition, conditions: [...condition.conditions, defaultCondition("time_range")] })}
            />
            {condition.conditions.map((sub, i) => (
              <ConditionEditor
                key={i}
                condition={sub}
                onChange={(updated) => {
                  const copy = [...condition.conditions];
                  copy[i] = updated;
                  onChange({ ...condition, conditions: copy });
                }}
                onRemove={() => onChange({ ...condition, conditions: condition.conditions.filter((_, j) => j !== i) })}
                devices={devices}
              />
            ))}
          </div>
        )}
      </div>
    </ItemCard>
  );
}

// ── Action editor ─────────────────────────────────────────

function PayloadEditor({ payload, onChange }: { payload: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const entries = useMemo(() => Object.entries(payload), [payload]);

  const update = (index: number, key: string, rawValue: string) => {
    const newEntries = [...entries];
    let parsed: unknown = rawValue;
    try { parsed = JSON.parse(rawValue); } catch { /* keep as string */ }
    newEntries[index] = [key, parsed];
    onChange(Object.fromEntries(newEntries));
  };

  const updateKey = (index: number, newKey: string) => {
    const newEntries = [...entries];
    newEntries[index] = [newKey, newEntries[index][1]];
    onChange(Object.fromEntries(newEntries));
  };

  const remove = (index: number) => {
    onChange(Object.fromEntries(entries.filter((_, i) => i !== index)));
  };

  const add = () => {
    onChange({ ...payload, "": "" });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([key, value], i) => (
        <div key={i} className="flex gap-2 items-center">
          <input className={fieldCls + " w-32!"} value={key} onChange={(e) => updateKey(i, e.target.value)} placeholder="key" />
          <input className={fieldCls} value={typeof value === "string" ? value : JSON.stringify(value)} onChange={(e) => update(i, key, e.target.value)} placeholder="value" />
          <button type="button" onClick={() => remove(i)} className={removeBtnCls}><X className="h-3 w-3" /></button>
        </div>
      ))}
      <button type="button" onClick={add} className={addBtnCls}>
        <Plus className="h-3 w-3" /> Add field
      </button>
    </div>
  );
}

function ActionEditor({ action, onChange, onRemove, devices, depth = 0 }: {
  action: Action;
  onChange: (a: Action) => void;
  onRemove: () => void;
  devices: DeviceData[];
  depth?: number;
}) {
  const changeType = (type: string) => onChange(defaultAction(type));

  return (
    <ItemCard onRemove={onRemove} accent={depth > 0 ? "blood" : "sand"}>
      <div className="flex flex-col gap-3">
        <Field label="Type">
          <TypeSelect value={action.type} options={ACTION_TYPES} onChange={changeType} />
        </Field>

        {action.type === "device_set" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Device">
                <DeviceSelect value={action.device} onChange={(v) => onChange({ ...action, device: v })} devices={devices} />
              </Field>
              <Field label="Entity">
                <EntitySelect value={action.entity} onChange={(v) => onChange({ ...action, entity: v })} device={action.device} devices={devices} />
              </Field>
            </div>
            <Field label="Payload">
              <PayloadEditor payload={action.payload} onChange={(p) => onChange({ ...action, payload: p })} />
            </Field>
          </>
        )}

        {action.type === "mqtt_publish" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Topic">
              <input className={fieldCls} value={action.topic} onChange={(e) => onChange({ ...action, topic: e.target.value })} />
            </Field>
            <Field label="Payload">
              <input className={fieldCls} value={action.payload} onChange={(e) => onChange({ ...action, payload: e.target.value })} />
            </Field>
          </div>
        )}

        {action.type === "delay" && (
          <Field label="Seconds">
            <input className={fieldCls} type="number" min={0} step={0.1} value={action.seconds} onChange={(e) => onChange({ ...action, seconds: Number(e.target.value) || 0 })} />
          </Field>
        )}

        {action.type === "tool" && (
          <>
            <Field label="Tool">
              <select
                value={(action as any).tool ?? ""}
                onChange={(e) => onChange({ ...action, tool: e.target.value, params: {} } as any)}
                className={selectCls}
              >
                {TOOL_NAMES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </Field>
            <Field label="Params">
              <PayloadEditor
                payload={((action as any).params && typeof (action as any).params === "object") ? (action as any).params : {}}
                onChange={(p) => onChange({ ...action, params: p } as any)}
              />
            </Field>
          </>
        )}

        {action.type === "conditional" && (
          <div className="flex flex-col gap-4 mt-1">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-3 w-3 text-amber-500" />
                <span className="text-[11px] font-semibold text-sand-600 uppercase tracking-wider">If condition</span>
              </div>
              <ConditionEditor
                condition={action.condition}
                onChange={(c) => onChange({ ...action, condition: c })}
                onRemove={() => onChange({ ...action, condition: defaultCondition() })}
                devices={devices}
              />
            </div>
            <div>
              <SectionHeader
                icon={Zap}
                label="Then"
                onAdd={() => onChange({ ...action, then: [...action.then, defaultAction()] })}
              />
              <div className="flex flex-col gap-2">
                {action.then.map((a, i) => (
                  <ActionEditor
                    key={i}
                    action={a}
                    onChange={(updated) => {
                      const newThen = [...action.then];
                      newThen[i] = updated;
                      onChange({ ...action, then: newThen });
                    }}
                    onRemove={() => onChange({ ...action, then: action.then.filter((_, j) => j !== i) })}
                    devices={devices}
                    depth={depth + 1}
                  />
                ))}
              </div>
            </div>
            <div>
              <SectionHeader
                icon={Zap}
                label="Else"
                onAdd={() => onChange({ ...action, else: [...(action.else ?? []), defaultAction()] })}
              />
              <div className="flex flex-col gap-2">
                {(action.else ?? []).map((a, i) => (
                  <ActionEditor
                    key={i}
                    action={a}
                    onChange={(updated) => {
                      const newElse = [...(action.else ?? [])];
                      newElse[i] = updated;
                      onChange({ ...action, else: newElse });
                    }}
                    onRemove={() => onChange({ ...action, else: (action.else ?? []).filter((_, j) => j !== i) })}
                    devices={devices}
                    depth={depth + 1}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </ItemCard>
  );
}

// ── Automation editor ─────────────────────────────────────

function AutomationEditor({ draft, onChange, onSave, onCancel, isSaving, devices }: {
  draft: Automation;
  onChange: (a: Automation) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  devices: DeviceData[];
}) {
  const triggers = draft.triggers ?? [];
  const conditions = draft.conditions ?? [];
  const actions = draft.actions ?? [];

  const updateTrigger = (i: number, t: Trigger) => {
    const copy = [...triggers];
    copy[i] = t;
    onChange({ ...draft, triggers: copy });
  };
  const removeTrigger = (i: number) => onChange({ ...draft, triggers: triggers.filter((_, j) => j !== i) });
  const addTrigger = () => onChange({ ...draft, triggers: [...triggers, defaultTrigger()] });

  const updateCondition = (i: number, c: Condition) => {
    const copy = [...conditions];
    copy[i] = c;
    onChange({ ...draft, conditions: copy });
  };
  const removeCondition = (i: number) => onChange({ ...draft, conditions: conditions.filter((_, j) => j !== i) });
  const addCondition = () => onChange({ ...draft, conditions: [...conditions, defaultCondition()] });

  const updateAction = (i: number, a: Action) => {
    const copy = [...actions];
    copy[i] = a;
    onChange({ ...draft, actions: copy });
  };
  const removeAction = (i: number) => onChange({ ...draft, actions: actions.filter((_, j) => j !== i) });
  const addAction = () => onChange({ ...draft, actions: [...actions, defaultAction()] });

  return (
    <div className="mt-4 flex flex-col gap-6">
      {/* Name & enabled */}
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <Field label="Name">
            <input className={fieldCls} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
          </Field>
        </div>
        <div className="shrink-0 pb-0.5">
          <button
            type="button"
            onClick={() => onChange({ ...draft, enabled: !draft.enabled })}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-wider cursor-pointer transition-colors ${
              draft.enabled
                ? "bg-teal-400 text-teal-900"
                : "bg-sand-200 text-sand-500"
            }`}
          >
            {draft.enabled ? "Enabled" : "Disabled"}
          </button>
        </div>
      </div>

      {/* ID (read-only) */}
      <div className="flex items-center gap-2">
        <span className={labelCls}>ID</span>
        <code className="text-xs font-mono text-sand-600 bg-sand-100 px-2 py-0.5 rounded">{draft.id}</code>
      </div>

      {/* Max runs */}
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <Field label="Max runs">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                className={fieldCls + " w-24"}
                placeholder="∞"
                value={(draft as any).max_runs ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ ...draft, max_runs: v === "" ? undefined : Math.max(1, parseInt(v, 10) || 1) } as any);
                }}
              />
              <span className="text-xs text-sand-500">
                {(draft as any).max_runs
                  ? `Auto-removes after ${(draft as any).max_runs} run${(draft as any).max_runs === 1 ? "" : "s"}`
                  : "Unlimited (runs forever)"}
              </span>
              {(draft as any).run_count > 0 && (
                <span className="text-xs text-sand-400 ml-2">
                  ({(draft as any).run_count} so far)
                </span>
              )}
            </div>
          </Field>
        </div>
      </div>

      {/* Triggers */}
      <section>
        <SectionHeader icon={Radio} label="Triggers" onAdd={addTrigger} />
        <div className="flex flex-col gap-2">
          {triggers.map((t, i) => (
            <TriggerEditor key={i} trigger={t} onChange={(v) => updateTrigger(i, v)} onRemove={() => removeTrigger(i)} devices={devices} />
          ))}
          {triggers.length === 0 && (
            <p className="text-xs text-sand-400 italic py-2">No triggers. Add at least one.</p>
          )}
        </div>
      </section>

      {/* Conditions */}
      <section>
        <SectionHeader icon={Shield} label="Conditions" onAdd={addCondition} />
        <div className="flex flex-col gap-2">
          {conditions.map((c, i) => (
            <ConditionEditor key={i} condition={c} onChange={(v) => updateCondition(i, v)} onRemove={() => removeCondition(i)} devices={devices} />
          ))}
          {conditions.length === 0 && (
            <p className="text-xs text-sand-400 italic py-2">No conditions — automation always runs when triggered.</p>
          )}
        </div>
      </section>

      {/* Actions */}
      <section>
        <SectionHeader icon={Zap} label="Actions" onAdd={addAction} />
        <div className="flex flex-col gap-2">
          {actions.map((a, i) => (
            <ActionEditor key={i} action={a} onChange={(v) => updateAction(i, v)} onRemove={() => removeAction(i)} devices={devices} />
          ))}
          {actions.length === 0 && (
            <p className="text-xs text-sand-400 italic py-2">No actions. Add at least one.</p>
          )}
        </div>
      </section>

      {/* Save / Cancel */}
      <div className="flex gap-2 pt-2 border-t border-sand-200">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-400 text-teal-900 text-sm font-medium hover:bg-teal-300 transition-colors cursor-pointer disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sand-200 text-sand-700 text-sm font-medium hover:bg-sand-300 transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────

export function AutomationsView() {
  const { data: automations, isLoading } = useAutomations();
  const { data: rawDevices } = useDevices();
  const updateAuto = useUpdateAutomation();
  const deleteAuto = useDeleteAutomation();

  const devices = useMemo(
    () => (rawDevices && Array.isArray(rawDevices) ? rawDevices as DeviceData[] : []),
    [rawDevices],
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Automation | null>(null);

  const expand = useCallback((a: Automation) => {
    setExpandedId(a.id);
    setDraft(structuredClone(a));
  }, []);

  const collapse = useCallback(() => {
    setExpandedId(null);
    setDraft(null);
  }, []);

  const save = useCallback(() => {
    if (!draft) return;
    const { id, ...patch } = draft;
    updateAuto.mutate({ id, patch }, { onSuccess: collapse });
  }, [draft, updateAuto, collapse]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-sand-600 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading automations…
      </div>
    );
  }

  if (!automations || !Array.isArray(automations) || automations.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-sand-700">No automations configured.</p>
        <p className="text-xs font-mono text-sand-500 mt-1">Use the AI chat or API to create one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {(automations as Automation[]).map((a) => {
        const isExpanded = expandedId === a.id;

        return (
          <div
            key={a.id}
            className={`rounded-xl bg-sand-50 px-5 py-4 transition-all ${isExpanded ? "ring-2 ring-teal-300/50" : ""}`}
          >
            {/* Header row */}
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => isExpanded ? collapse() : expand(a)}
            >
              <div className="flex items-center gap-3">
                <div className={`h-2 w-2 rounded-full ${a.enabled ? "bg-teal-400" : "bg-sand-400"}`} />
                <span className="text-sm font-medium text-sand-900">{a.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider ${
                  a.enabled ? "bg-teal-50 text-teal-600" : "bg-sand-200 text-sand-500"
                }`}>
                  {a.enabled ? "Active" : "Off"}
                </span>
                {!isExpanded && (
                  <button
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md text-blood-300 hover:text-blood-500 hover:bg-sand-200 transition-colors cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); deleteAuto.mutate(a.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <ChevronDown className={`h-4 w-4 text-sand-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </div>
            </div>

            {/* Summary (collapsed) */}
            {!isExpanded && (
              <div className="flex gap-4 mt-2 ml-5">
                <span className="text-[10px] font-mono text-sand-500 uppercase tracking-wider">
                  triggers: {a.triggers.map((t: { type: string }) => t.type).join(", ")}
                </span>
                <span className="text-[10px] font-mono text-sand-500 uppercase tracking-wider">
                  actions: {a.actions.map((act: { type: string }) => act.type).join(", ")}
                </span>
              </div>
            )}

            {/* Editor (expanded) */}
            {isExpanded && draft && (
              <AutomationEditor
                draft={draft}
                onChange={setDraft}
                onSave={save}
                onCancel={collapse}
                isSaving={updateAuto.isPending}
                devices={devices}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
