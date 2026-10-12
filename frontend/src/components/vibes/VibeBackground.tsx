import { useMemo } from "react";
import { renderVibeArt } from "@minhome/server/vibe-art";
import { useDevices } from "../../api.js";
import type { DeviceData, Vibe } from "../../types.js";
import { fixedColorMap } from "../../lib/vibes.js";
import { cn } from "../../lib/utils.js";

/**
 * A vibe's procedural artwork, rendered with the same generator the server
 * uses for GET /api/vibes/:id/art.svg, so unsaved drafts preview identically.
 * A bottom scrim keeps overlaid text legible.
 */
export function VibeBackground({ vibe, className }: {
  vibe: Pick<Vibe, "id" | "entities">;
  className?: string;
}) {
  const { data: devices } = useDevices();
  const fixedColors = useMemo(
    () => fixedColorMap(Array.isArray(devices) ? devices as DeviceData[] : []),
    [devices],
  );
  const key = vibe.id + JSON.stringify(vibe.entities) + JSON.stringify(fixedColors);
  const src = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderVibeArt({ ...vibe, fixedColors }))}`,
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div aria-hidden className={cn("absolute inset-0 overflow-hidden", className)}>
      <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
    </div>
  );
}
