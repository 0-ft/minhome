import { Lightbulb, Plug, Radio } from "lucide-react";
import type { Entity } from "../../types.js";
import { resolveLucideIcon } from "../lists/LucideIcon.js";

/** An entity's chosen icon, or the default for its type. */
export function EntityIcon({ entity, className, strokeWidth }: {
  entity: Pick<Entity, "type" | "icon">;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = resolveLucideIcon(entity.icon)
    ?? (entity.type === "sensor" ? Radio : entity.type === "light" ? Lightbulb : Plug);
  return <Icon className={className} strokeWidth={strokeWidth} />;
}
