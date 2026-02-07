import { cn } from "../../lib/utils.js";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-8 w-full rounded-md bg-sand-100 px-2.5 py-1 text-sm text-sand-900 transition-colors",
        "placeholder:text-sand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blood-600/25 focus-visible:bg-sand-50",
        className,
      )}
      {...props}
    />
  );
}
