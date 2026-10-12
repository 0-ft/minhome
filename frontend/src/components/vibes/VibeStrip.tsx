import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Pencil, Plus, Sparkles } from "lucide-react";
import { useApplyVibe, useCaptureVibe, useVibes } from "../../api.js";
import type { DeviceData, Vibe } from "../../types.js";
import { vibeMatches } from "../../lib/vibes.js";
import { cn } from "../../lib/utils.js";
import { LucideIcon } from "../lists/LucideIcon.js";
import { PromptDialog } from "../ui/PromptDialog.js";
import { VibeBackground } from "./VibeBackground.js";

export const vibeEditorPath = (id: string) => `/entities/vibes/${encodeURIComponent(id)}`;

/** Horizontally scrolling row of vibe cards shown above the entities grid. */
export function VibeStrip({ devices }: { devices: DeviceData[] }) {
  const { data: vibes } = useVibes();
  const applyVibe = useApplyVibe();
  const captureVibe = useCaptureVibe();
  const navigate = useNavigate();
  const [savePromptOpen, setSavePromptOpen] = useState(false);

  return (
    <section aria-label="Vibes" className="-mx-6">
      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-6 py-1">
        {(vibes ?? []).map((vibe) => (
          <VibeCard
            key={vibe.id}
            vibe={vibe}
            active={vibeMatches(vibe, devices)}
            pending={applyVibe.isPending && applyVibe.variables === vibe.id}
            onApply={() => applyVibe.mutate(vibe.id)}
            onEdit={() => navigate(vibeEditorPath(vibe.id))}
          />
        ))}
        <button
          type="button"
          onClick={() => setSavePromptOpen(true)}
          className="shrink-0 w-36 h-28 rounded-xl border-2 border-dashed border-sand-400 text-sand-600 hover:border-teal-400 hover:text-teal-700 transition-colors flex flex-col items-center justify-center gap-1.5"
        >
          <Plus className="h-5 w-5" />
          <span className="text-xs font-medium">Save current</span>
        </button>
      </div>

      <PromptDialog
        open={savePromptOpen}
        title="Save as vibe"
        message="Saves the current state of every light and switch."
        placeholder="e.g. Cosy evening"
        confirmLabel="Save vibe"
        pending={captureVibe.isPending}
        onCancel={() => setSavePromptOpen(false)}
        onSubmit={(name) => captureVibe.mutate({ name }, { onSuccess: () => setSavePromptOpen(false) })}
      />
    </section>
  );
}

function VibeCard({ vibe, active, pending, onApply, onEdit }: {
  vibe: Vibe;
  active: boolean;
  pending: boolean;
  onApply: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative shrink-0 w-44 h-28 rounded-xl overflow-hidden shadow-sm transition-shadow",
        active ? "ring-2 ring-teal-400 ring-offset-2 ring-offset-sand-100 shadow-lg" : "hover:shadow-md",
      )}
    >
      <VibeBackground vibe={vibe} />
      <button
        type="button"
        onClick={onApply}
        aria-pressed={active}
        className={cn(
          "absolute inset-0 flex flex-col justify-between p-3 text-left text-white",
          pending && "animate-pulse",
        )}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/20 backdrop-blur-sm">
          {vibe.icon ? <LucideIcon name={vibe.icon} className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] pr-6">
          <span className="truncate">{vibe.name}</span>
          {active && <Check className="h-3.5 w-3.5 shrink-0" aria-label="Active" />}
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${vibe.name}`}
        className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/20 text-white backdrop-blur-sm opacity-80 hover:opacity-100 hover:bg-black/35 transition"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
