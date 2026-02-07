import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../../lib/utils.js";

interface SliderProps {
  min: number;
  max: number;
  serverValue: number;
  onCommit: (val: number) => void;
  /** Controlled local value (parent owns state) */
  value?: number;
  /** Called on every drag tick so parent can track the local value */
  onValueChange?: (val: number) => void;
  label?: React.ReactNode;
  className?: string;
}

/** Debounced range slider — local state for smooth dragging, debounced commits */
export function DebouncedSlider({ min, max, serverValue, onCommit, value, onValueChange, label, className }: SliderProps) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(serverValue);
  const displayValue = controlled ? value : internalValue;

  const isDragging = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!isDragging.current) {
      if (!controlled) setInternalValue(serverValue);
      onValueChange?.(serverValue);
    }
  }, [serverValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (!controlled) setInternalValue(val);
    onValueChange?.(val);
    isDragging.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCommit(val), 150);
  }, [onCommit, controlled, onValueChange]);

  const handlePointerUp = useCallback(() => {
    clearTimeout(timerRef.current);
    onCommit(displayValue);
    setTimeout(() => { isDragging.current = false; }, 500);
  }, [displayValue, onCommit]);

  return (
    <div className={cn("flex items-center gap-2.5 flex-1", className)}>
      {label && <span className="shrink-0 flex items-center">{label}</span>}
      <input
        type="range" min={min} max={max}
        value={displayValue}
        onChange={handleChange}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex-1 cursor-pointer"
      />
      <span className="text-[10px] font-mono tabular-nums w-7 text-right opacity-60">{displayValue}</span>
    </div>
  );
}
