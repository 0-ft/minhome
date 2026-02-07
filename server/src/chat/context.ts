import type { MqttBridge } from "../mqtt.js";
import type { ConfigStore } from "../config.js";
import type { AutomationEngine } from "../automations.js";

export function buildSystemPrompt(bridge: MqttBridge, config: ConfigStore, automations: AutomationEngine): string {
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

  const allAutomations = automations.getAll().map((a) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled,
  }));

  return `You are a smart home assistant for minhome, a Zigbee-based room control system.
You can view and control smart home devices and automations using the tools available to you.

Current devices and their state:
${JSON.stringify(devices, null, 2)}

Current automations:
${JSON.stringify(allAutomations, null, 2)}

Guidelines:
- Be concise and helpful.
- When asked to control devices, use the appropriate tool calls.
- Refer to devices by their friendly name, not their IEEE address.
- If a device has named entities (e.g. individual sockets on a multi-plug), refer to them by their entity name.
- After performing an action, briefly confirm what you did.
- If you're unsure about a device or action, ask for clarification.

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

