import { useState } from "react";
import { useRealtimeUpdates } from "./api.js";
import { DevicesView } from "./components/DevicesView.js";
import { AutomationsView } from "./components/AutomationsView.js";

export function App() {
  useRealtimeUpdates();
  const [tab, setTab] = useState<"devices" | "automations">("devices");

  return (
    <div className="min-h-screen bg-sand-100">
      {/* Header — fixed, frosted blood-300 */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-blood-300/80 backdrop-blur-lg">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-sand-50">
              minhome
            </h1>
            <p className="text-[11px] font-mono text-blood-100 mt-0.5">smart room control</p>
          </div>

          <nav className="flex gap-0.5 bg-blood-400/60 rounded-lg p-0.5">
            {(["devices", "automations"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition-all cursor-pointer ${
                  tab === t
                    ? "bg-sand-50/90 text-blood-600"
                    : "text-blood-100 hover:text-sand-50 hover:bg-blood-400/40"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content — top padding to clear fixed header */}
      <main className="max-w-5xl mx-auto px-6 pt-24 pb-8">
        {tab === "devices" ? <DevicesView /> : <AutomationsView />}
      </main>
    </div>
  );
}
