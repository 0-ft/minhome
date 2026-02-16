import { cn } from "../../lib/utils.js";

export function Toggle({
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-blood-500",
        checked ? "bg-teal-400" : "bg-blood-700/70",
        disabled ? "opacity-60 cursor-not-allowed" : "",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block h-4.5 w-4.5 rounded-full bg-sand-50 shadow-sm transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
