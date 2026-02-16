import { useEffect, useRef, useState } from "react";
import type { TodoStatus } from "../../api.js";
import { formatStatusLabel, statusPillClass } from "./helpers.js";
import { LucideIcon } from "./LucideIcon.js";

export function StatusPicker({
  value,
  options,
  iconByStatus,
  onChange,
}: {
  value: TodoStatus;
  options: TodoStatus[];
  iconByStatus?: Partial<Record<TodoStatus, string | undefined>>;
  onChange: (status: TodoStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
        <LucideIcon name={iconByStatus?.[value]} className="h-3 w-3" />
        {formatStatusLabel(value)}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 min-w-28 rounded-md border border-sand-300 bg-sand-50 shadow-lg p-1">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={`w-full text-left px-2 py-1 rounded text-xs font-mono cursor-pointer inline-flex items-center gap-1.5 ${
                option === value ? "bg-sand-200 text-sand-900" : "text-sand-700 hover:bg-sand-100"
              }`}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <LucideIcon name={iconByStatus?.[option]} className="h-3 w-3" />
              {formatStatusLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

