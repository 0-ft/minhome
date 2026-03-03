import { useEffect, useRef, useState } from "react";
import { statusPillClass } from "./helpers.js";
import { LucideIcon } from "./LucideIcon.js";

export interface StatusOption {
  id: string;
  label: string;
  icon?: string;
}

export function StatusPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: StatusOption[];
  onChange: (statusId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const active = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!rootRef.current || !target) return;
      if (!rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`text-[10px] uppercase font-mono px-2 py-1 rounded cursor-pointer inline-flex items-center gap-1 ${statusPillClass(value)}`}
        onClick={() => setOpen((v) => !v)}
      >
        <LucideIcon name={active?.icon} className="h-3 w-3" />
        {active?.label ?? value}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 min-w-28 rounded-md border border-sand-300 bg-sand-50 shadow-lg p-1">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`w-full text-left px-2 py-1 rounded text-xs font-mono cursor-pointer inline-flex items-center gap-1.5 ${
                option.id === value ? "bg-sand-200 text-sand-900" : "text-sand-700 hover:bg-sand-100"
              }`}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              <LucideIcon name={option.icon} className="h-3 w-3" />
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

