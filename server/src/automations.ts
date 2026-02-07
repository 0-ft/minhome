import { readFileSync, writeFileSync, existsSync } from "fs";
import { z } from "zod";
import { Cron } from "croner";
import type { MqttBridge, DeviceState } from "./mqtt.js";

// --- Zod schemas ---

const TriggerDeviceState = z.object({
  type: z.literal("device_state"),
  device: z.string(),
  property: z.string(),
  to: z.unknown().optional(),
  from: z.unknown().optional(),
});

const TriggerMqtt = z.object({
  type: z.literal("mqtt"),
  topic: z.string(),
  payload_contains: z.string().optional(),
});

const TriggerCron = z.object({
  type: z.literal("cron"),
  expression: z.string(),
});

const TriggerTime = z.object({
  type: z.literal("time"),
  at: z.string().regex(/^\d{2}:\d{2}$/),
});

const TriggerInterval = z.object({
  type: z.literal("interval"),
  every: z.number().positive(),
});

const TriggerSchema = z.discriminatedUnion("type", [
  TriggerDeviceState,
  TriggerMqtt,
  TriggerCron,
  TriggerTime,
  TriggerInterval,
]);

const ConditionTimeRange = z.object({
  type: z.literal("time_range"),
  after: z.string().regex(/^\d{2}:\d{2}$/),
  before: z.string().regex(/^\d{2}:\d{2}$/),
});

const ConditionDayOfWeek = z.object({
  type: z.literal("day_of_week"),
  days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])),
});

const ConditionDeviceState = z.object({
  type: z.literal("device_state"),
  device: z.string(),
  property: z.string(),
  equals: z.unknown(),
});

const ConditionSchema = z.discriminatedUnion("type", [
  ConditionTimeRange,
  ConditionDayOfWeek,
  ConditionDeviceState,
]);

const ActionDeviceSet = z.object({
  type: z.literal("device_set"),
  device: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const ActionMqttPublish = z.object({
  type: z.literal("mqtt_publish"),
  topic: z.string(),
  payload: z.string(),
});

const ActionDelay = z.object({
  type: z.literal("delay"),
  seconds: z.number().positive(),
});

type Action = z.infer<typeof ActionDeviceSet> | z.infer<typeof ActionMqttPublish> | z.infer<typeof ActionDelay> | ConditionalAction;

interface ConditionalAction {
  type: "conditional";
  condition: z.infer<typeof ConditionSchema>;
  then: Action[];
  else?: Action[];
}

const ActionSchema: z.ZodType<Action> = z.lazy(() =>
  z.discriminatedUnion("type", [
    ActionDeviceSet,
    ActionMqttPublish,
    ActionDelay,
    z.object({
      type: z.literal("conditional"),
      condition: ConditionSchema,
      then: z.array(ActionSchema),
      else: z.array(ActionSchema).optional(),
    }),
  ])
);

export const AutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  triggers: z.array(TriggerSchema).min(1),
  conditions: z.array(ConditionSchema).default([]),
  actions: z.array(ActionSchema).min(1),
});

export const AutomationsFileSchema = z.object({
  automations: z.array(AutomationSchema),
});

export type Automation = z.infer<typeof AutomationSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Condition = z.infer<typeof ConditionSchema>;

// --- Engine ---

export class AutomationEngine {
  private automations: Automation[] = [];
  private cronJobs: Cron[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private bridge: MqttBridge;
  private filePath: string;
  private onFire?: (automationId: string, triggeredBy: string) => void;

  constructor(filePath: string, bridge: MqttBridge, opts?: { onFire?: (id: string, trigger: string) => void }) {
    this.filePath = filePath;
    this.bridge = bridge;
    this.onFire = opts?.onFire;
    this.load();
    this.setupMqttListeners();
  }

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
    return automation;
  }

  update(id: string, patch: Partial<Automation>): Automation {
    const idx = this.automations.findIndex(a => a.id === id);
    if (idx === -1) throw new Error(`Automation '${id}' not found`);
    this.automations[idx] = { ...this.automations[idx], ...patch, id };
    this.save();
    this.reload();
    return this.automations[idx];
  }

  remove(id: string): void {
    this.automations = this.automations.filter(a => a.id !== id);
    this.save();
    this.reload();
  }

  destroy(): void {
    this.teardownScheduled();
  }

  // --- Internals ---

  private load(): void {
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = AutomationsFileSchema.parse(JSON.parse(raw));
      this.automations = parsed.automations;
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
          const [h, m] = trigger.at.split(":").map(Number);
          const job = new Cron(`${m} ${h} * * *`, () => this.fire(auto, `time:${trigger.at}`));
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
          if (trigger.type !== "device_state") continue;
          if (trigger.device !== deviceId) continue;
          const val = state[trigger.property];
          if (val === undefined) continue;
          if (trigger.to !== undefined && val !== trigger.to) continue;
          if (trigger.from !== undefined && (!prev || prev[trigger.property] !== trigger.from)) continue;
          this.fire(auto, `device_state:${deviceId}:${trigger.property}`);
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
    for (const cond of automation.conditions) {
      if (!this.evaluateCondition(cond)) return;
    }

    console.log(`[auto] Firing '${automation.name}' (trigger: ${triggeredBy})`);
    this.onFire?.(automation.id, triggeredBy);

    await this.executeActions(automation.actions);
  }

  private evaluateCondition(cond: Condition): boolean {
    const now = new Date();

    switch (cond.type) {
      case "time_range": {
        const current = now.getHours() * 60 + now.getMinutes();
        const [ah, am] = cond.after.split(":").map(Number);
        const [bh, bm] = cond.before.split(":").map(Number);
        const after = ah * 60 + am;
        const before = bh * 60 + bm;
        // Handle wrap-around midnight
        if (after <= before) return current >= after && current < before;
        return current >= after || current < before;
      }
      case "day_of_week": {
        const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
        return cond.days.includes(days[now.getDay()]);
      }
      case "device_state": {
        const state = this.bridge.states.get(cond.device);
        return state?.[cond.property] === cond.equals;
      }
    }
  }

  private async executeActions(actions: Action[]): Promise<void> {
    for (const action of actions) {
      switch (action.type) {
        case "device_set":
          this.bridge.setDeviceState(action.device, action.payload as Record<string, unknown>);
          break;
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

