import * as LucideIcons from "lucide-react";
import { cn } from "../../lib/utils.js";

export function LucideIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  if (!name) return null;
  const Icon = (LucideIcons as Record<string, React.ComponentType<{ className?: string }>>)[name];
  if (!Icon) return null;
  return <Icon className={cn("h-3.5 w-3.5", className)} />;
}

