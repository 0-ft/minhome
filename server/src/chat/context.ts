import type { MqttBridge } from "../mqtt.js";
import type { ConfigStore } from "../config/config.js";
import type { TodoStore } from "../config/todos.js";
import type { AutomationEngine } from "../automations.js";
import type { VoiceDeviceInfo } from "../tools.js";
import { extractEntitiesFromExposes, buildEntityResponses } from "../config/devices.js";

export function buildSystemPrompt(
  bridge: MqttBridge,
  config: ConfigStore,
  todos: TodoStore,
  automations: AutomationEngine,
  voiceDevices?: Map<string, VoiceDeviceInfo>,
): string {
  const devices = [...bridge.devices.values()]
    .filter((d) => d.type !== "Coordinator")
    .map((d) => {
      const custom = config.getDevice(d.ieee_address);
      const state = bridge.states.get(d.ieee_address) ?? {};
      const exposes = d.definition?.exposes ?? [];
      const extracted = extractEntitiesFromExposes(exposes);
      const deviceName = custom?.name ?? d.friendly_name;
      const entities = buildEntityResponses(extracted, deviceName, custom?.entities, state);

      return {
        id: d.ieee_address,
        name: deviceName,
        entities: entities.map(e => ({
          key: e.key,
          name: e.name,
          type: e.type,
          state: e.state,
          ...(e.sensorProperties ? { sensorProperties: e.sensorProperties } : {}),
        })),
        type: d.type,
        vendor: d.definition?.vendor ?? null,
        model: d.definition?.model ?? null,
        description: d.definition?.description ?? null,
      };
    });

  const allAutomations = automations.getAll().map((a) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled,
  }));
  const promptTodoLists = todos.getPromptLists().map((list) => ({
    id: list.id,
    name: list.name,
    items: list.items.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      status: item.status,
    })),
  }));

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/London" });
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

  return `You are a smart home assistant for minhome, a Zigbee-based room control system.
You can view and control smart home devices and automations using the tools available to you.

Current date and time: ${dateStr}, ${timeStr} (Europe/London).

Current devices and their entities:
${JSON.stringify(devices, null, 2)}

Current automations:
${JSON.stringify(allAutomations, null, 2)}
${promptTodoLists.length > 0 ? `
Current todo lists (outstanding items only):
${JSON.stringify(promptTodoLists, null, 2)}
` : ""}
${voiceDevices && voiceDevices.size > 0 ? `
Connected voice devices:
${JSON.stringify([...voiceDevices.entries()].map(([id, info]) => ({ id, name: info.name, model: info.model })), null, 2)}
You can send spoken announcements to these devices using the announce tool. Omit device_id to announce on all devices, or provide a specific device_id to target one.
` : ""}
Guidelines:
- Be concise and helpful.
- When controlling devices, ALWAYS use control_entity with the entity key and canonical property names (state, brightness, color_temp, color). The server resolves actual MQTT property names automatically. For colour-changing lights, set colour with: {"color":{"hue":N,"saturation":N}} (hue 0-360, saturation 0-100) or {"color":{"hex":"#RRGGBB"}}.
- For single-entity devices, use entity key "main".
- Only use control_device for device-level properties that don't belong to any entity (e.g. power_on_behavior).
- Refer to devices by their friendly name, not their IEEE address.
- If a device has named entities (e.g. individual sockets on a multi-plug), refer to them by their entity name.
- When creating automations for controllable devices (lights, switches), use "device_state" triggers/conditions with the "entity" field and canonical property names.
- When creating automations for input-only devices (buttons, contact sensors, motion sensors), use "device_event" triggers with the raw MQTT property name. For example, a button press trigger: {"type":"device_event","device":"<ieee>","property":"action","value":"single"}. Common properties: "action" (buttons), "contact" (door sensors), "occupancy" (motion sensors). Omit "value" to match any value.
- Automations support a "tool" action type that can invoke any non-automation tool (e.g. control_entity, set_voice). However, automation actions cannot create, update, or delete other automations — only the AI chat tools can manage automations directly.
- Automations support an optional "max_runs" field (positive integer). When set, the automation auto-removes itself after firing that many times. Use max_runs:1 for single-shot automations. Omit for unlimited runs.
- For one-off scheduled events (e.g. "turn on the lights at 8am tomorrow", "remind me in 20 minutes"), use a "datetime" trigger with the specific ISO local datetime (e.g. "2026-02-09T08:00") and max_runs:1 so it fires once and auto-removes. The "time" trigger fires daily and is better for recurring schedules. Both support seconds precision (HH:MM:SS).
- After performing an action, briefly confirm what you did.
- If you're unsure about a device or action, ask for clarification.
- When asked to modify the room configuration, ALWAYS call get_room_config first to read the current state. Then use the appropriate granular tool: set_room_dimensions for size/floor, set_room_lights for light placements, upsert_furniture_item to add/edit a single named piece, remove_furniture_item to delete one, or update_room_furniture to replace the entire furniture array. Never guess at the existing config.
- When modifying furniture, consider spatial dependencies: if you change a piece's position or size, check whether other objects sit on top of, attach to, or align with it and adjust them too. For example, raising a desk means monitors, lamps, and other items on the desk must also move up by the same amount. Always review the full furniture list from get_room_config for affected neighbours before making changes.

Inline references:
When you mention a device in your response, ALWAYS wrap it in a tag:
  <device id="IEEE_ADDRESS">Device Name</device>
When you mention a specific entity on a device, use:
  <entity id="ENTITY_KEY" device="IEEE_ADDRESS">Entity Name</entity>
When you mention an automation, use:
  <automation id="AUTOMATION_ID">Automation Name</automation>
For example: I turned off <device id="0xc890a81f1ffe0000">Ceiling Light</device>.
Or: The <entity id="l3" device="0xa4c138d2b1cf1389">Sunrise Lamp</entity> is now on.
Or: I created <automation id="morning-lights">Morning Lights</automation>.
Always use the exact ID and the friendly name as the text content.`;
}
