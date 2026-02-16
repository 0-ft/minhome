import { createContext, useContext } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

type ToggleGroupType = "single" | "multiple";

type ToggleGroupContextValue = {
  type: ToggleGroupType;
  value: string | string[] | undefined;
  onValueChange?: (value: string | string[]) => void;
};

const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null);

const itemVariants = cva(
  "inline-flex items-center justify-center rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer",
  {
    variants: {
      pressed: {
        true: "bg-sand-50 text-sand-900 shadow-sm",
        false: "text-sand-500 hover:text-sand-700 hover:bg-sand-100/60",
      },
    },
    defaultVariants: {
      pressed: false,
    },
  },
);

export function ToggleGroup({
  type,
  value,
  onValueChange,
  className,
  children,
}: {
  type: ToggleGroupType;
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ToggleGroupContext.Provider value={{ type, value, onValueChange }}>
      <div className={cn("inline-flex gap-0.5 rounded-lg bg-sand-200 p-0.5", className)}>
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

export function ToggleGroupItem({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = useContext(ToggleGroupContext);
  if (!ctx) throw new Error("ToggleGroupItem must be used inside ToggleGroup");

  const pressed = ctx.type === "single"
    ? ctx.value === value
    : Array.isArray(ctx.value) && ctx.value.includes(value);

  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(itemVariants({ pressed }), className)}
      onClick={() => {
        if (!ctx.onValueChange) return;
        if (ctx.type === "single") {
          ctx.onValueChange(value);
          return;
        }
        const current = Array.isArray(ctx.value) ? ctx.value : [];
        if (current.includes(value)) {
          ctx.onValueChange(current.filter((v) => v !== value));
        } else {
          ctx.onValueChange([...current, value]);
        }
      }}
    >
      {children}
    </button>
  );
}

