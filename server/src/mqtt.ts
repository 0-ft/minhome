import mqtt from "mqtt";
import { EventEmitter } from "events";

export interface Z2MDevice {
  ieee_address: string;
  friendly_name: string;
  type: "Coordinator" | "Router" | "EndDevice";
  definition?: {
    model: string;
    vendor: string;
    description: string;
    exposes?: unknown[];
  } | null;
  model_id?: string;
  supported?: boolean;
  disabled?: boolean;
  endpoints?: Record<string, unknown>;
}

export interface DeviceState {
  [key: string]: unknown;
}

export interface MqttBridge extends EventEmitter {
  devices: Map<string, Z2MDevice>;
  states: Map<string, DeviceState>;
  publish(topic: string, payload: string): void;
  setDeviceState(deviceId: string, payload: Record<string, unknown>): void;
  refreshStates(): void;
  destroy(): Promise<void>;
}

export function createMqttBridge(mqttUrl: string, baseTopic = "zigbee2mqtt"): MqttBridge {
  const devices = new Map<string, Z2MDevice>();
  const states = new Map<string, DeviceState>();
  const emitter = new EventEmitter() as MqttBridge;

  const client = mqtt.connect(mqttUrl);

  client.on("connect", () => {
    console.log(`[mqtt] Connected to ${mqttUrl}`);
    client.subscribe([
      `${baseTopic}/bridge/devices`,
      `${baseTopic}/bridge/state`,
      `${baseTopic}/+`,
    ]);
  });

  client.on("message", (topic, payload) => {
    const msg = payload.toString();

    if (topic === `${baseTopic}/bridge/devices`) {
      try {
        const list: Z2MDevice[] = JSON.parse(msg);
        devices.clear();
        for (const d of list) {
          devices.set(d.ieee_address, d);
        }
        emitter.emit("devices", list);

        // Request current state for all non-coordinator devices
        for (const d of list) {
          if (d.type !== "Coordinator") {
            client.publish(`${baseTopic}/${d.friendly_name}/get`, JSON.stringify({ state: "" }));
          }
        }
      } catch { /* ignore bad json */ }
      return;
    }

    if (topic === `${baseTopic}/bridge/state`) {
      emitter.emit("bridge_state", msg);
      return;
    }

    // Skip other bridge topics
    if (topic.startsWith(`${baseTopic}/bridge/`)) return;

    // Device state update: zigbee2mqtt/<friendly_name>
    const friendlyName = topic.slice(baseTopic.length + 1);
    if (!friendlyName || friendlyName.includes("/")) return;

    try {
      const state: DeviceState = JSON.parse(msg);
      // Find device by friendly_name
      const device = [...devices.values()].find(d => d.friendly_name === friendlyName);
      const id = device?.ieee_address ?? friendlyName;

      const prev = states.get(id);
      states.set(id, { ...prev, ...state });

      emitter.emit("state_change", { deviceId: id, friendlyName, state, prev });
    } catch { /* ignore non-json payloads */ }

    // Also emit raw mqtt for automation triggers
    emitter.emit("mqtt_message", { topic, payload: msg });
  });

  client.on("error", (err) => {
    console.error("[mqtt] Error:", err.message);
  });

  emitter.devices = devices;
  emitter.states = states;

  emitter.publish = (topic: string, payload: string) => {
    client.publish(topic, payload);
  };

  emitter.refreshStates = () => {
    for (const d of devices.values()) {
      if (d.type !== "Coordinator") {
        client.publish(`${baseTopic}/${d.friendly_name}/get`, JSON.stringify({ state: "" }));
      }
    }
  };

  emitter.setDeviceState = (deviceId: string, payload: Record<string, unknown>) => {
    // Resolve friendly name from ieee
    const device = devices.get(deviceId);
    const name = device?.friendly_name ?? deviceId;
    client.publish(`${baseTopic}/${name}/set`, JSON.stringify(payload));
  };

  emitter.destroy = async () => {
    await client.endAsync();
  };

  return emitter;
}

