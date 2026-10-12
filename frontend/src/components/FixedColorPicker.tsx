import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils.js";

/**
 * Status dot that doubles as a picker for the fixed colour of a light that
 * can't be colour-controlled (e.g. a pink lamp on a plug).
 */
export function FixedColorPicker({ value, isOn, onChange }: {
  value?: string;
  isOn: boolean;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "#ff8fb1");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setDraft(value ?? "#ff8fb1");
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={value ? "Light colour" : "Set light colour"}
        aria-label={value ? "Change light colour" : "Set light colour"}
        className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-sand-300/70 transition-colors"
      >
        {value ? (
          <span
            className={cn("h-3 w-3 rounded-full border border-sand-400/60 transition-opacity", !isOn && "opacity-40")}
            style={{ background: value }}
          />
        ) : (
          <span className={cn("h-1.5 w-1.5 rounded-full transition-colors", isOn ? "bg-teal-400" : "bg-sand-400")} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-48 rounded-lg border border-sand-300 bg-sand-50 p-3 shadow-lg flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-wider text-sand-500">Light colour</div>
          <p className="text-[11px] leading-snug text-sand-600">
            The colour this light gives off, for the dashboard and vibes.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-sand-300 bg-transparent p-0.5"
              aria-label="Pick light colour"
            />
            <span className="font-mono text-xs text-sand-700">{draft}</span>
          </div>
          <div className="flex justify-between gap-2">
            <button
              type="button"
              className="text-xs text-sand-600 hover:text-sand-900 disabled:opacity-40"
              disabled={!value}
              onClick={() => { onChange(""); setOpen(false); }}
            >
              No colour
            </button>
            <button
              type="button"
              className="rounded-md bg-teal-400 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-500"
              onClick={() => { onChange(draft.toLowerCase()); setOpen(false); }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
