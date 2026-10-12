import { useState, useRef, useEffect, useCallback } from "react";
import { useThrottledCommit } from "../../lib/useThrottledCommit.js";
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
  /** Optional CSS background for the slider track (e.g. a gradient for hue/saturation). */
  trackBackground?: string;
}

/**
 * Range slider with local state for smooth dragging. While dragging it
 * commits at most every 100ms (always the latest value), so a light follows
 * the slider instead of jumping when you pause; the final value is sent on
 * release.
 */
export function ThrottledSlider({ min, max, serverValue, onCommit, value, onValueChange, label, className, trackBackground }: SliderProps) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(serverValue);
  const displayValue = controlled ? value : internalValue;

  const isDragging = useRef(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commits = useThrottledCommit(onCommit, 100);

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
    clearTimeout(releaseTimer.current);
    commits.push(val);
  }, [commits, controlled, onValueChange]);

  const handlePointerUp = useCallback(() => {
    commits.flush();
    // Keep ignoring server echoes briefly so the thumb doesn't snap back while the light catches up
    releaseTimer.current = setTimeout(() => { isDragging.current = false; }, 500);
  }, [commits]);

  return (
    <div className={cn("flex items-center gap-2.5 flex-1", className)}>
      {label && <span className="shrink-0 flex items-center">{label}</span>}
      <input
        type="range" min={min} max={max}
        value={displayValue}
        onChange={handleChange}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn("flex-1 cursor-pointer", trackBackground && "color-track")}
        style={trackBackground ? { "--track-bg": trackBackground } as React.CSSProperties : undefined}
      />
      <span className="text-[10px] font-mono tabular-nums w-7 text-right opacity-60">{displayValue}</span>
    </div>
  );
}
