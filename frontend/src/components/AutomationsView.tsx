import { useAutomations, useDeleteAutomation } from "../api.js";
import { Trash2 } from "lucide-react";

export function AutomationsView() {
  const { data: automations, isLoading } = useAutomations();
  const deleteAuto = useDeleteAutomation();

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
        <p className="text-xs font-mono text-sand-500 mt-1">Use the CLI or API to create one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {automations.map((a) => (
        <div
          key={a.id}
          className={`rounded-xl bg-sand-50 px-5 py-4 transition-opacity ${a.enabled ? "" : "opacity-40"}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Status dot */}
              <div className={`h-2 w-2 rounded-full ${a.enabled ? "bg-teal-400" : "bg-sand-400"}`} />
              <span className="text-sm font-medium text-sand-900">{a.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider ${
                a.enabled ? "bg-teal-50 text-teal-600" : "bg-sand-200 text-sand-500"
              }`}>
                {a.enabled ? "Active" : "Off"}
              </span>
              <button
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-blood-300 hover:text-blood-500 hover:bg-sand-200 transition-colors cursor-pointer"
                onClick={() => deleteAuto.mutate(a.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex gap-4 mt-2 ml-5">
            <span className="text-[10px] font-mono text-sand-500 uppercase tracking-wider">
              triggers: {a.triggers.map((t: { type: string }) => t.type).join(", ")}
            </span>
            <span className="text-[10px] font-mono text-sand-500 uppercase tracking-wider">
              actions: {a.actions.map((act: { type: string }) => act.type).join(", ")}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

