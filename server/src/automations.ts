import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { z } from "zod";
import { Cron } from "croner";
import type { MqttBridge, DeviceState } from "./mqtt.js";
import { extractEntitiesFromExposes, resolveCanonicalProperty, resolveEntityPayload } from "./config/devices.js";
import { toolSchemas } from "./tools.js";
import { debugLog } from "./debug-log.js";

// --- Zod schemas ---

const TriggerDeviceState = z.object({
  type: z.literal("device_state").describe("Trigger type: fires when a device's state property changes"),
  device: z.string().describe("IEEE address of the device to watch, e.g. '0xa4c138d2b1cf1389'"),
  entity: z.string().describe("Entity key, e.g. 'main' for single-entity devices, 'l1'/'l2'/'l3' for multi-entity"),
  property: z.string().describe("Canonical property name to monitor, e.g. 'state', 'brightness', 'color_temp'"),
  to: z.unknown().optional().describe("Value the property must change TO for the trigger to fire (omit to match any new value)"),
  from: z.unknown().optional().describe("Value the property must change FROM for the trigger to fire (omit to match any previous value)"),
}).describe("Trigger that fires when a device entity's state property changes");

const TriggerMqtt = z.object({
  type: z.literal("mqtt").describe("Trigger type: fires on a raw MQTT message"),
  topic: z.string().describe("MQTT topic to subscribe to; supports '+' (single-level) and '#' (multi-level) wildcards"),
  payload_contains: z.string().optional().describe("Optional substring the MQTT payload must contain for the trigger to fire"),
}).describe("Trigger that fires when an MQTT message matching the topic (and optional payload filter) is received");

const TriggerCron = z.object({
  type: z.literal("cron").describe("Trigger type: fires on a cron schedule"),
  expression: z.string().describe("Cron expression, e.g. '0 8 * * *' for every day at 08:00, '*/5 * * * *' for every 5 minutes"),
}).describe("Trigger that fires on a cron schedule");

const TriggerTime = z.object({
  type: z.literal("time").describe("Trigger type: fires at a specific time of day"),
  at: z.iso.time().describe("Time of day in HH:MM or HH:MM:SS 24-hour format, e.g. '08:30', '22:00', '06:15:30'"),
}).describe("Trigger that fires once per day at a specific time");

const TriggerDatetime = z.object({
  type: z.literal("datetime").describe("Trigger type: fires at a specific date and time (one-shot)"),
  at: z.iso.datetime({ local: true }).describe("ISO 8601 local datetime, e.g. '2026-02-09T08:00' or '2026-02-09T08:00:00'. No timezone offset — uses server local time (Europe/London)."),
}).describe("Trigger that fires once at a specific date and time. Ideal for one-off scheduled events like 'turn on lights at 8am tomorrow'. Typically paired with max_runs:1.");

const TriggerInterval = z.object({
  type: z.literal("interval").describe("Trigger type: fires at a recurring interval"),
  every: z.number().positive().describe("Interval in seconds between each firing, e.g. 300 for every 5 minutes"),
}).describe("Trigger that fires repeatedly at a fixed interval");

const TriggerDeviceEvent = z.object({
  type: z.literal("device_event").describe("Trigger type: fires when a device emits an event (e.g. button press, sensor update)"),
  device: z.string().describe("IEEE address of the device, e.g. '0xa4c138f959e3ad1b'"),
  property: z.string().describe("Raw MQTT property name to match, e.g. 'action' for buttons, 'contact' for door sensors, 'occupancy' for motion sensors"),
  value: z.unknown().optional().describe("Value the property must equal for the trigger to fire (omit to match any value). Examples: 'single', 'double', 'hold' for buttons; true/false for contact/occupancy sensors"),
}).describe("Trigger that fires when a device emits an event. Use for input-only devices like buttons, contact sensors, and motion sensors. Operates on raw MQTT properties without entity resolution.");

export const TriggerSchema = z.discriminatedUnion("type", [
  TriggerDeviceState,
  TriggerDeviceEvent,
  TriggerMqtt,
  TriggerCron,
  TriggerTime,
  TriggerDatetime,
  TriggerInterval,
]).describe("A trigger that causes the automation to fire. Set 'type' to one of: 'device_state', 'device_event', 'mqtt', 'cron', 'time', 'datetime', 'interval'. Use 'device_event' for buttons/sensors, 'device_state' for controllable devices, 'datetime' for one-off scheduled events.");

const ConditionTimeRange = z.object({
  type: z.literal("time_range").describe("Condition type: passes only during a time-of-day window"),
  after: z.iso.time().describe("Start of the allowed time window in HH:MM or HH:MM:SS 24-hour format"),
  before: z.iso.time().describe("End of the allowed time window in HH:MM or HH:MM:SS 24-hour format (supports midnight wrap-around)"),
}).describe("Condition that passes only if the current time is within the given range");

const ConditionDayOfWeek = z.object({
  type: z.literal("day_of_week").describe("Condition type: passes only on certain days of the week"),
  days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).describe("List of days when the automation is allowed to fire, e.g. ['mon','tue','wed','thu','fri'] for weekdays"),
}).describe("Condition that passes only on the specified days of the week");

const ConditionDeviceState = z.object({
  type: z.literal("device_state").describe("Condition type: passes only when a device entity property has a specific value"),
  device: z.string().describe("IEEE address of the device to check"),
  entity: z.string().describe("Entity key, e.g. 'main' or 'l3'"),
  property: z.string().describe("Canonical property name to check, e.g. 'state', 'brightness'"),
  equals: z.unknown().describe("Required value of the property for the condition to pass, e.g. 'ON', 255"),
}).describe("Condition that passes only when a device entity's state property equals a specific value");

type Condition = z.infer<typeof ConditionTimeRange> | z.infer<typeof ConditionDayOfWeek> | z.infer<typeof ConditionDeviceState> | LogicCondition;

interface LogicCondition {
  type: "and" | "or" | "xor";
  conditions: Condition[];
}

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("type", [
    ConditionTimeRange,
    ConditionDayOfWeek,
    ConditionDeviceState,
    z.object({
      type: z.literal("and").describe("Condition type: passes only when ALL sub-conditions pass"),
      conditions: z.array(ConditionSchema).min(1).describe("Sub-conditions that must ALL be true"),
    }).describe("Logical AND — passes when every sub-condition is true"),
    z.object({
      type: z.literal("or").describe("Condition type: passes when ANY sub-condition passes"),
      conditions: z.array(ConditionSchema).min(1).describe("Sub-conditions where at least one must be true"),
    }).describe("Logical OR — passes when at least one sub-condition is true"),
    z.object({
      type: z.literal("xor").describe("Condition type: passes when exactly one sub-condition passes"),
      conditions: z.array(ConditionSchema).min(1).describe("Sub-conditions where exactly one must be true"),
    }).describe("Logical XOR — passes when exactly one sub-condition is true"),
  ])
).describe("A condition that must be true for the automation to proceed. Set 'type' to one of: 'time_range', 'day_of_week', 'device_state', 'and', 'or', 'xor'");

const ActionDeviceSet = z.object({
  type: z.literal("device_set").describe("Action type: send a state command to a device entity"),
  device: z.string().describe("IEEE address of the target device"),
  entity: z.string().describe("Entity key, e.g. 'main' or 'l3'"),
  payload: z.looseObject({}).describe("Key-value payload with canonical property names, e.g. {\"state\":\"ON\",\"brightness\":200,\"color_temp\":350}"),
}).describe("Action that sends a state command to a Zigbee device entity");

const ActionMqttPublish = z.object({
  type: z.literal("mqtt_publish").describe("Action type: publish a raw MQTT message"),
  topic: z.string().describe("MQTT topic to publish to"),
  payload: z.string().describe("String payload to publish"),
}).describe("Action that publishes a raw MQTT message");

const ActionDelay = z.object({
  type: z.literal("delay").describe("Action type: pause before the next action"),
  seconds: z.number().positive().describe("Number of seconds to wait before executing the next action"),
}).describe("Action that introduces a delay between subsequent actions");

// ── Tool action variants (one per tool, discriminated on 'tool' field) ──

const toolActionVariants = Object.entries(toolSchemas).map(
  ([name, { description, parameters }]) =>
    z.object({
      type: z.literal("tool"),
      tool: z.literal(name).describe("Tool to invoke"),
      params: parameters.describe(`Parameters for ${name}`),
    }).describe(`Tool action: ${description}`)
) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]];

const ActionTool = z.discriminatedUnion("tool", toolActionVariants as any)
  .describe("Action that invokes an AI tool. Set 'tool' to the tool name and provide its parameters in 'params'.");

type ToolAction = { type: "tool"; tool: string; params: unknown };
type Action = z.infer<typeof ActionDeviceSet> | z.infer<typeof ActionMqttPublish> | z.infer<typeof ActionDelay> | ToolAction | ConditionalAction;

interface ConditionalAction {
  type: "conditional";
  condition: Condition;
  then: Action[];
  else?: Action[];
}

export const ActionSchema: z.ZodType<Action> = z.lazy(() =>
  z.union([
    z.discriminatedUnion("type", [
      ActionDeviceSet,
      ActionMqttPublish,
      ActionDelay,
      z.object({
        type: z.literal("conditional").describe("Action type: conditionally execute different action branches"),
        condition: ConditionSchema.describe("Condition to evaluate at runtime"),
        then: z.array(ActionSchema).describe("Actions to execute if the condition is true"),
        else: z.array(ActionSchema).optional().describe("Actions to execute if the condition is false (optional)"),
      }).describe("Action that branches based on a runtime condition"),
    ]),
    ActionTool,
  ])
).describe("An action to execute. Set 'type' to one of: 'device_set', 'mqtt_publish', 'delay', 'conditional', 'tool'");

export const AutomationSchema = z.object({
  id: z.string().describe("Unique identifier for this automation (use a short slug, e.g. 'morning-lights')"),
  name: z.string().describe("Human-readable name for this automation, e.g. 'Turn on morning lights'"),
  enabled: z.boolean().default(true).describe("Whether this automation is active (defaults to true)"),
  max_runs: z.number().int().positive().optional().describe("Maximum number of times this automation can fire before being auto-removed. Omit for unlimited runs. Set to 1 for single-shot automations."),
  run_count: z.number().int().default(0).describe("Number of times this automation has fired (managed by the engine, do not set manually)"),
  triggers: z.array(TriggerSchema).min(1).describe("One or more triggers that can cause this automation to fire (OR logic: any trigger can fire it)"),
  conditions: z.array(ConditionSchema).default([]).describe("Optional conditions that must ALL be true for the automation to proceed (AND logic). Defaults to no conditions."),
  actions: z.array(ActionSchema).min(1).describe("Ordered list of actions to execute when the automation fires"),
}).describe("A complete automation rule with triggers, conditions, and actions");

export const AutomationsFileSchema = z.object({
  automations: z.array(AutomationSchema),
});

export type Automation = z.infer<typeof AutomationSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type { Condition, Action };

// --- Helpers ---

/** Resolve canonical property name to actual MQTT property name for a device entity */
function resolveProperty(bridge: MqttBridge, deviceId: string, entityKey: string, canonical: string): string | null {
  const device = bridge.devices.get(deviceId);
  const exposes = device?.definition?.exposes ?? [];
  const extracted = extractEntitiesFromExposes(exposes);
  const entityDef = extracted.find(e => e.key === entityKey);
  if (!entityDef) return null;
  return resolveCanonicalProperty(entityDef, canonical);
}

// --- Engine ---

export class AutomationEngine {
  private automations: Automation[] = [];
  private cronJobs: Cron[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private bridge: MqttBridge;
  private filePath: string;
  private onFire?: (automationId: string, triggeredBy: string) => void;
  private changeListeners = new Set<() => void>();

  private executeTool?: (name: string, params: unknown) => Promise<unknown>;

  constructor(filePath: string, bridge: MqttBridge, opts?: {
    onFire?: (id: string, trigger: string) => void;
    executeTool?: (name: string, params: unknown) => Promise<unknown>;
  }) {
    this.filePath = filePath;
    this.bridge = bridge;
    this.onFire = opts?.onFire;
    this.executeTool = opts?.executeTool;
    this.load();
    this.setupMqttListeners();
  }

  // --- Change listeners ---

  onChanged(fn: () => void): void { this.changeListeners.add(fn); }
  offChanged(fn: () => void): void { this.changeListeners.delete(fn); }
  private emitChange(): void { this.changeListeners.forEach(fn => fn()); }

  // --- Public API ---

  getAll(): Automation[] {
    return this.automations;
  }

  get(id: string): Automation | undefined {
    return this.automations.find(a => a.id === id);
  }

  create(automation: Automation): Automation {
    if (this.automations.some(a => a.id === automation.id)) {
      throw new Error(`Automation '${automation.id}' already exists`);
    }
    this.automations.push(automation);
    this.save();
    this.reload();
    this.emitChange();
    debugLog.add("automation_created", `Created automation '${automation.name}'`, { id: automation.id, name: automation.name, triggers: automation.triggers.length, actions: automation.actions.length });
    return automation;
  }

  update(id: string, patch: Partial<Automation>): Automation {
    const idx = this.automations.findIndex(a => a.id === id);
    if (idx === -1) throw new Error(`Automation '${id}' not found`);
    this.automations[idx] = { ...this.automations[idx], ...patch, id };
    this.save();
    this.reload();
    this.emitChange();
    debugLog.add("automation_updated", `Updated automation '${this.automations[idx].name}'`, { id, patch: Object.keys(patch) });
    return this.automations[idx];
  }

  remove(id: string): void {
    const existing = this.automations.find(a => a.id === id);
    this.automations = this.automations.filter(a => a.id !== id);
    this.save();
    this.reload();
    this.emitChange();
    debugLog.add("automation_deleted", `Deleted automation '${existing?.name ?? id}'`, { id });
  }

  destroy(): void {
    this.teardownScheduled();
  }

  // --- Internals ---

  private load(): void {
    try {
      if (existsSync(this.filePath) && statSync(this.filePath).isFile()) {
        const raw = readFileSync(this.filePath, "utf-8");
        const parsed = AutomationsFileSchema.parse(JSON.parse(raw));
        this.automations = parsed.automations;
      } else {
        this.automations = [];
        this.save(); // create the file so it exists for future writes
      }
    } catch (err) {
      console.error(`[auto] Failed to load automations from ${this.filePath}, starting empty:`, err);
      this.automations = [];
      this.save();
    }
    this.setupScheduled();
  }

  private reload(): void {
    this.teardownScheduled();
    this.setupScheduled();
  }

  private save(): void {
    const data: z.infer<typeof AutomationsFileSchema> = { automations: this.automations };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2) + "\n");
  }

  private setupScheduled(): void {
    for (const auto of this.automations) {
      if (!auto.enabled) continue;
      for (const trigger of auto.triggers) {
        if (trigger.type === "cron") {
          const job = new Cron(trigger.expression, () => this.fire(auto, "cron"));
          this.cronJobs.push(job);
        } else if (trigger.type === "time") {
          const parts = trigger.at.split(":").map(Number);
          const [h, m] = parts;
          const s = parts[2] ?? 0;
          const job = new Cron(`${s} ${m} ${h} * * *`, () => this.fire(auto, `time:${trigger.at}`));
          this.cronJobs.push(job);
        } else if (trigger.type === "datetime") {
          const d = new Date(trigger.at);
          if (isNaN(d.getTime())) {
            console.warn(`[auto] Invalid datetime '${trigger.at}' in automation '${auto.name}', skipping`);
            continue;
          }
          // Croner supports scheduling at a specific Date
          const job = new Cron(d, () => this.fire(auto, `datetime:${trigger.at}`));
          this.cronJobs.push(job);
        } else if (trigger.type === "interval") {
          const iv = setInterval(() => this.fire(auto, `interval:${trigger.every}s`), trigger.every * 1000);
          this.intervals.push(iv);
        }
      }
    }
  }

  private teardownScheduled(): void {
    for (const job of this.cronJobs) job.stop();
    for (const iv of this.intervals) clearInterval(iv);
    this.cronJobs = [];
    this.intervals = [];
  }

  private setupMqttListeners(): void {
    this.bridge.on("state_change", ({ deviceId, state, prev }: { deviceId: string; friendlyName: string; state: DeviceState; prev?: DeviceState }) => {
      for (const auto of this.automations) {
        if (!auto.enabled) continue;
        for (const trigger of auto.triggers) {
          if (trigger.type === "device_state") {
            if (trigger.device !== deviceId) continue;

            // Resolve canonical property → actual MQTT property
            const actualProp = resolveProperty(this.bridge, deviceId, trigger.entity, trigger.property);
            if (!actualProp) continue;

            const val = state[actualProp];
            if (val === undefined) continue;
            if (trigger.to !== undefined && val !== trigger.to) continue;
            if (trigger.from !== undefined && (!prev || prev[actualProp] !== trigger.from)) continue;
            this.fire(auto, `device_state:${deviceId}:${trigger.entity}:${trigger.property}`);
          } else if (trigger.type === "device_event") {
            if (trigger.device !== deviceId) continue;

            // Direct raw property match — no entity resolution
            const val = state[trigger.property];
            if (val === undefined) continue;
            if (trigger.value !== undefined && val !== trigger.value) continue;
            this.fire(auto, `device_event:${deviceId}:${trigger.property}=${String(val)}`);
          }
        }
      }
    });

    this.bridge.on("mqtt_message", ({ topic, payload }: { topic: string; payload: string }) => {
      for (const auto of this.automations) {
        if (!auto.enabled) continue;
        for (const trigger of auto.triggers) {
          if (trigger.type !== "mqtt") continue;
          if (!mqttTopicMatch(trigger.topic, topic)) continue;
          if (trigger.payload_contains && !payload.includes(trigger.payload_contains)) continue;
          this.fire(auto, `mqtt:${topic}`);
        }
      }
    });
  }

  private async fire(automation: Automation, triggeredBy: string): Promise<void> {
    // Evaluate conditions (AND)
    for (const cond of automation.conditions ?? []) {
      if (!this.evaluateCondition(cond)) return;
    }

    console.log(`[auto] Firing '${automation.name}' (trigger: ${triggeredBy})`);
    this.onFire?.(automation.id, triggeredBy);

    // Increment run count and persist
    automation.run_count = (automation.run_count ?? 0) + 1;
    this.save();
    this.emitChange();

    await this.executeActions(automation.actions);

    // Auto-remove if max_runs reached
    if (automation.max_runs && automation.run_count >= automation.max_runs) {
      console.log(`[auto] '${automation.name}' reached max_runs (${automation.max_runs}), removing`);
      this.remove(automation.id);
    }
  }

  private evaluateCondition(cond: Condition): boolean {
    const now = new Date();

    switch (cond.type) {
      case "time_range": {
        const toSecs = (t: string) => { const p = t.split(":").map(Number); return p[0] * 3600 + p[1] * 60 + (p[2] ?? 0); };
        const current = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const after = toSecs(cond.after);
        const before = toSecs(cond.before);
        // Handle wrap-around midnight
        if (after <= before) return current >= after && current < before;
        return current >= after || current < before;
      }
      case "day_of_week": {
        const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
        return cond.days.includes(days[now.getDay()]);
      }
      case "device_state": {
        const actualProp = resolveProperty(this.bridge, cond.device, cond.entity, cond.property);
        if (!actualProp) return false;
        const state = this.bridge.states.get(cond.device);
        return state?.[actualProp] === cond.equals;
      }
      case "and":
        return cond.conditions.every(c => this.evaluateCondition(c));
      case "or":
        return cond.conditions.some(c => this.evaluateCondition(c));
      case "xor": {
        const trueCount = cond.conditions.filter(c => this.evaluateCondition(c)).length;
        return trueCount === 1;
      }
    }
  }

  private async executeActions(actions: Action[]): Promise<void> {
    for (const action of actions) {
      switch (action.type) {
        case "device_set": {
          const device = this.bridge.devices.get(action.device);
          const exposes = device?.definition?.exposes ?? [];
          const extracted = extractEntitiesFromExposes(exposes);
          const entityDef = extracted.find(e => e.key === action.entity);
          if (entityDef) {
            const resolved = resolveEntityPayload(entityDef, action.payload as Record<string, unknown>);
            this.bridge.setDeviceState(action.device, resolved);
          } else {
            // Fallback: send payload as-is
            this.bridge.setDeviceState(action.device, action.payload as Record<string, unknown>);
          }
          break;
        }
        case "mqtt_publish":
          this.bridge.publish(action.topic, action.payload);
          break;
        case "delay":
          await new Promise(r => setTimeout(r, action.seconds * 1000));
          break;
        case "conditional":
          if (this.evaluateCondition(action.condition)) {
            await this.executeActions(action.then);
          } else if (action.else) {
            await this.executeActions(action.else);
          }
          break;
        case "tool":
          if (this.executeTool) {
            try {
              await this.executeTool(action.tool, action.params);
            } catch (err) {
              console.error(`[auto] Tool action '${action.tool}' failed:`, err);
            }
          } else {
            console.warn(`[auto] Tool action '${action.tool}' skipped — no executeTool callback`);
          }
          break;
      }
    }
  }
}

/** Match MQTT topic with wildcards (+ for single level, # for multi-level) */
function mqttTopicMatch(pattern: string, topic: string): boolean {
  const patParts = pattern.split("/");
  const topParts = topic.split("/");

  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i] === "#") return true;
    if (patParts[i] === "+") continue;
    if (i >= topParts.length || patParts[i] !== topParts[i]) return false;
  }
  return patParts.length === topParts.length;
}
