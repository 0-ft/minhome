import { cn } from "../../lib/utils.js";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-8 w-full rounded-md bg-blood-600/50 px-2.5 py-1 text-sm text-sand-50 transition-colors",
        "placeholder:text-blood-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/50 focus-visible:bg-blood-600/70",
        className,
      )}
      {...props}
    />
  );
}
