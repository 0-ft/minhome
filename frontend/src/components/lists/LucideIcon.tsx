import * as LucideIcons from "lucide-react";
import { cn } from "../../lib/utils.js";

const KEBAB_ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function kebabToPascalCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

export function LucideIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  if (!name || !KEBAB_ICON_NAME_RE.test(name)) return null;
  const iconsByName = LucideIcons as Record<string, React.ComponentType<{ className?: string }>>;
  const Icon = iconsByName[kebabToPascalCase(name)];
  if (!Icon) return null;
  return <Icon className={cn("h-3.5 w-3.5", className)} />;
}

