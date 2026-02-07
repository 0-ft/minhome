import type { MqttBridge } from "../mqtt.js";
import type { ConfigStore } from "../config.js";

export function buildSystemPrompt(bridge: MqttBridge, config: ConfigStore): string {
  const devices = [...bridge.devices.values()]
    .filter((d) => d.type !== "Coordinator")
    .map((d) => {
      const custom = config.getDevice(d.ieee_address);
      const state = bridge.states.get(d.ieee_address);
      return {
        id: d.ieee_address,
        name: custom?.name ?? d.friendly_name,
        entities: custom?.entities ?? {},
        type: d.type,
        vendor: d.definition?.vendor ?? null,
        model: d.definition?.model ?? null,
        description: d.definition?.description ?? null,
        state: state ?? {},
      };
    });

  return `You are a smart home assistant for minhome, a Zigbee-based room control system.
You can view and control smart home devices using the tools available to you.

Current devices and their state:
${JSON.stringify(devices, null, 2)}

Guidelines:
- Be concise and helpful.
- When asked to control devices, use the appropriate tool calls.
- Refer to devices by their friendly name, not their IEEE address.
- If a device has named entities (e.g. individual sockets on a multi-plug), refer to them by their entity name.
- After performing an action, briefly confirm what you did.
- If you're unsure about a device or action, ask for clarification.`;
}

