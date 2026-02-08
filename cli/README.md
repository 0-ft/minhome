# @minhome/cli

A command-line interface for managing minhome devices, entities, and automations. Built with [Commander.js](https://github.com/tj/commander.js) and the [Hono RPC client](https://hono.dev/docs/guides/rpc) for type-safe API calls.

## Usage

Run via pnpm from the monorepo root:

```bash
pnpm --filter @minhome/cli dev -- <command>
```

Or directly with tsx:

```bash
tsx cli/src/index.ts <command>
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MINHOME_URL` | `http://localhost:3111` | URL of the minhome server |

```bash
export MINHOME_URL=http://192.168.1.100:3111
```

## Commands

### `device` — Manage Zigbee devices

#### `device list`

List all devices with their status, name, IEEE address, vendor/model, and entity names.

```
$ minhome device list
●  Ceiling Light  (0xc890a81f1ffe0000)
   IKEA TRADFRI LED bulb E26/E27
●  3x USB Plug  (0xa4c138d2b1cf1389)
   TuYa TS011F_plug_3
   └─ l3 → Sunrise Lamp
○  Desk Lamp  (0x0cae5ffffe69064a)
```

`●` indicates the device has reported state; `○` means no state has been received yet. Entity names from `config.json` are shown with `→` arrows.

#### `device get <id>`

Show detailed information, full state, and entities for a device.

```
$ minhome device get 0xc890a81f1ffe0000
Ceiling Light  (0xc890a81f1ffe0000)
  Type  : Router
  Model : IKEA TRADFRI LED bulb E26/E27
  State :
    state: "ON"
    brightness: 200
    color_temp: 370
  Entities:
    main → Ceiling Light
```

#### `device rename <id> <name>`

Set a friendly display name for a device (stored in `config.json`).

```bash
minhome device rename 0xc890a81f1ffe0000 "Ceiling Light"
```

#### `device set <id> <payload>`

Send a raw JSON command payload to a device. Use this for device-level properties that don't belong to a specific entity (e.g. `power_on_behavior`). For entity state changes, prefer `entity set` or the API's entity endpoint.

```bash
minhome device set 0xc890a81f1ffe0000 '{"state":"ON","brightness":200}'
```

### `entity` — Manage entities (endpoints within a device)

Every controllable endpoint on a device is an entity. Single-endpoint devices have one entity keyed `"main"`. Multi-endpoint devices (e.g. a 3-socket smart plug) have one entity per endpoint, keyed by Z2M's endpoint name (e.g. `"l1"`, `"l2"`, `"l3"`).

#### `entity list <device_id>`

List all entities of a device and their friendly names.

```
$ minhome entity list 0xa4c138d2b1cf1389
Entities for 3x USB Plug  (0xa4c138d2b1cf1389):
  l1
  l2
  l3 → Sunrise Lamp
```

#### `entity rename <device_id> <entity_id> <name>`

Set a friendly name for a specific entity endpoint.

```bash
minhome entity rename 0xa4c138d2b1cf1389 l3 "Sunrise Lamp"
```

### `automation` — Manage automations

Automations use the entity-first model — all `device_state` triggers/conditions and `device_set` actions include an `entity` field alongside the device IEEE address.

#### `automation list`

List all automations with their enabled status, triggers, and actions.

```
$ minhome automation list
[✓] Morning Lights  (morning-lights)
    Triggers: time
    Actions : device_set
[✗] Night Mode  (night-mode)
    Triggers: time
    Actions : device_set, delay, device_set
```

#### `automation get <id>`

Show the full JSON definition of an automation.

```bash
minhome automation get morning-lights
```

#### `automation create <json>`

Create a new automation from a JSON string. Include the `entity` field in all device-related triggers, conditions, and actions.

```bash
minhome automation create '{
  "id": "morning-lights",
  "name": "Morning Lights",
  "enabled": true,
  "triggers": [{"type": "time", "at": "08:00"}],
  "conditions": [{"type": "day_of_week", "days": ["mon","tue","wed","thu","fri"]}],
  "actions": [{"type": "device_set", "device": "0xc890a81f1ffe0000", "entity": "main", "payload": {"state": "ON", "brightness": 200}}]
}'
```

#### `automation update <id> <json>`

Update an existing automation with a partial JSON patch.

```bash
minhome automation update morning-lights '{"enabled": false}'
```

#### `automation delete <id>`

Delete an automation.

```bash
minhome automation delete morning-lights
```

## Dependencies

- **[commander](https://github.com/tj/commander.js)** — CLI framework
- **[hono](https://hono.dev/)** — RPC client (shared types with `@minhome/server`)
- **[@minhome/server](../server/)** — workspace dependency for `AppType` type import
