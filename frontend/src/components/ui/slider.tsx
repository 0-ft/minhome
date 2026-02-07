import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../../lib/utils.js";

interface SliderProps {
  min: number;
  max: number;
  serverValue: number;
  onCommit: (val: number) => void;
  label?: React.ReactNode;
  className?: string;
}

/** Debounced range slider — local state for smooth dragging, debounced commits */
export function DebouncedSlider({ min, max, serverValue, onCommit, label, className }: SliderProps) {
  const [localValue, setLocalValue] = useState(serverValue);
  const isDragging = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!isDragging.current) setLocalValue(serverValue);
  }, [serverValue]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setLocalValue(val);
    isDragging.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCommit(val), 150);
  }, [onCommit]);

  const handlePointerUp = useCallback(() => {
    clearTimeout(timerRef.current);
    onCommit(localValue);
    setTimeout(() => { isDragging.current = false; }, 500);
  }, [localValue, onCommit]);

  return (
    <div className={cn("flex items-center gap-2 flex-1", className)}>
      {label && <span className="shrink-0 flex items-center">{label}</span>}
      <input
        type="range" min={min} max={max}
        value={localValue}
        onChange={handleChange}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex-1 h-1.5 accent-primary bg-secondary rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm
          [&::-webkit-slider-thumb]:cursor-pointer"
      />
      <span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right">{localValue}</span>
    </div>
  );
}
