import { useState } from "react";
import { useDevices, useSetDevice, useRenameDevice, useAutomations, useDeleteAutomation, useRealtimeUpdates } from "./api.js";

export function App() {
  useRealtimeUpdates();
  const [tab, setTab] = useState<"devices" | "automations">("devices");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Minhome</h1>
        <nav style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <TabBtn active={tab === "devices"} onClick={() => setTab("devices")}>Devices</TabBtn>
          <TabBtn active={tab === "automations"} onClick={() => setTab("automations")}>Automations</TabBtn>
        </nav>
      </header>
      {tab === "devices" ? <DevicesView /> : <AutomationsView />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 16px", border: "1px solid #333", borderRadius: 6,
        background: active ? "#2563eb" : "#1a1a1a", color: "#e0e0e0",
        cursor: "pointer", fontSize: 14,
      }}
    >
      {children}
    </button>
  );
}

// --- Devices ---

function DevicesView() {
  const { data: devices, isLoading } = useDevices();
  const setDevice = useSetDevice();
  const renameDevice = useRenameDevice();

  if (isLoading) return <p>Loading...</p>;
  if (!devices || !Array.isArray(devices) || devices.length === 0) return <p>No devices found.</p>;

  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {devices.map((d) => (
        <DeviceCard
          key={d.id}
          device={d}
          onToggle={() => {
            const current = d.state && typeof d.state === "object" && "state" in d.state ? d.state.state : undefined;
            setDevice.mutate({ id: d.id, payload: { state: current === "ON" ? "OFF" : "ON" } });
          }}
          onRename={(name) => renameDevice.mutate({ id: d.id, name })}
          onBrightness={(val) => setDevice.mutate({ id: d.id, payload: { brightness: val } })}
        />
      ))}
    </div>
  );
}

interface DeviceCardProps {
  device: {
    id: string; name: string; type: string;
    vendor: string | null; model: string | null;
    state: Record<string, unknown>; exposes: unknown[];
  };
  onToggle: () => void;
  onRename: (name: string) => void;
  onBrightness: (val: number) => void;
}

function DeviceCard({ device, onToggle, onRename, onBrightness }: DeviceCardProps) {
  const isOn = device.state?.state === "ON";
  const hasBrightness = device.exposes?.some(
    (e: unknown) => typeof e === "object" && e !== null && "name" in e && (e as { name: string }).name === "brightness"
  );
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(device.name);

  return (
    <div style={{
      background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 10,
      padding: 16, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); onRename(nameInput); setEditing(false); }}
            style={{ display: "flex", gap: 6 }}>
            <input value={nameInput} onChange={e => setNameInput(e.target.value)}
              style={{ background: "#111", border: "1px solid #444", color: "#e0e0e0", borderRadius: 4, padding: "2px 6px", width: 140 }} />
            <button type="submit" style={{ background: "#2563eb", border: "none", color: "#fff", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>Save</button>
          </form>
        ) : (
          <span onClick={() => setEditing(true)} style={{ cursor: "pointer", fontWeight: 500 }} title="Click to rename">
            {device.name}
          </span>
        )}
        <span style={{ fontSize: 11, color: "#888" }}>{device.type}</span>
      </div>
      <div style={{ fontSize: 12, color: "#888" }}>
        {device.vendor && device.model ? `${device.vendor} ${device.model}` : device.id}
      </div>

      {/* State display */}
      {device.state && Object.keys(device.state).length > 0 && (
        <div style={{ fontSize: 12, color: "#aaa", display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {Object.entries(device.state).slice(0, 6).map(([k, v]) => (
            <span key={k}>{k}: <strong>{String(v)}</strong></span>
          ))}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <button onClick={onToggle} style={{
          padding: "6px 16px", border: "none", borderRadius: 6, cursor: "pointer",
          background: isOn ? "#16a34a" : "#333", color: "#fff", fontWeight: 500,
        }}>
          {isOn ? "ON" : "OFF"}
        </button>

        {hasBrightness && (
          <input
            type="range" min={0} max={254}
            value={typeof device.state?.brightness === "number" ? device.state.brightness : 127}
            onChange={(e) => onBrightness(Number(e.target.value))}
            style={{ flex: 1 }}
          />
        )}
      </div>
    </div>
  );
}

// --- Automations ---

function AutomationsView() {
  const { data: automations, isLoading } = useAutomations();
  const deleteAuto = useDeleteAutomation();

  if (isLoading) return <p>Loading...</p>;
  if (!automations || !Array.isArray(automations) || automations.length === 0)
    return <p>No automations configured. Use the CLI or API to create one.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {automations.map((a) => (
        <div key={a.id} style={{
          background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 10, padding: 16,
          opacity: a.enabled ? 1 : 0.5,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 500 }}>{a.name}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ fontSize: 11, color: a.enabled ? "#16a34a" : "#888" }}>
                {a.enabled ? "Enabled" : "Disabled"}
              </span>
              <button onClick={() => deleteAuto.mutate(a.id)} style={{
                background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 12,
              }}>Delete</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
            Triggers: {a.triggers.map((t: { type: string }) => t.type).join(", ")}
            {" | "}Actions: {a.actions.map((act: { type: string }) => act.type).join(", ")}
          </div>
        </div>
      ))}
    </div>
  );
}

