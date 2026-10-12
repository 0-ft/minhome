import { useMemo, type CSSProperties } from "react";
import type { Vibe } from "../../types.js";
import { vibePalette, type PaletteColor } from "../../lib/vibes.js";
import { cn } from "../../lib/utils.js";

// ── Seeded randomness (same vibe → same artwork) ─────────

function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next: () => number;
  range: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  weighted: (colors: PaletteColor[]) => string;
}

function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (colors) => {
      const total = colors.reduce((sum, c) => sum + c.weight, 0);
      let roll = next() * total;
      for (const c of colors) {
        roll -= c.weight;
        if (roll <= 0) return c.css;
      }
      return colors[colors.length - 1].css;
    },
  };
}

// ── Composition ──────────────────────────────────────────

/** Shift a colour towards black or white so a single-colour vibe still has depth. */
const shade = (css: string, towards: "black" | "white", amount: number) =>
  `color-mix(in oklch, ${css} ${Math.round((1 - amount) * 100)}%, ${towards})`;

interface Blob {
  style: CSSProperties;
}

interface Composition {
  base: string;
  blobs: Blob[];
}

const BLEND_MODES = ["screen", "soft-light", "overlay", "normal", "normal", "screen"] as const;

function compose(vibe: Pick<Vibe, "id" | "entities">): Composition {
  const { colors, isFallback } = vibePalette(vibe);
  const rng = createRng(hashString(vibe.id + JSON.stringify(vibe.entities)));

  // Base: a gradient between the two strongest colours, or one colour and a deep shade of it
  const first = colors[0].css;
  const second = colors.length > 1 ? colors[1].css : shade(first, "black", 0.55);
  const deep = shade(rng.weighted(colors), "black", rng.range(0.45, 0.7));
  const angle = Math.round(rng.range(0, 360));
  const base = rng.pick([
    `linear-gradient(${angle}deg, ${first}, ${second} 55%, ${deep})`,
    `conic-gradient(from ${angle}deg at ${Math.round(rng.range(20, 80))}% ${Math.round(rng.range(20, 80))}%, ${first}, ${second}, ${deep}, ${first})`,
    `radial-gradient(ellipse at ${Math.round(rng.range(0, 100))}% ${Math.round(rng.range(0, 100))}%, ${first}, ${second} 50%, ${deep})`,
  ]);

  // Blobs: soft, heavily blurred shapes drifting across the base
  const count = Math.round(rng.range(3, isFallback ? 5 : 6.99));
  const blobs: Blob[] = Array.from({ length: count }, () => {
    const size = rng.range(40, 110);
    const color = rng.next() < 0.25
      ? shade(rng.weighted(colors), rng.next() < 0.5 ? "white" : "black", rng.range(0.15, 0.4))
      : rng.weighted(colors);
    const radii = Array.from({ length: 8 }, () => `${Math.round(rng.range(30, 70))}%`);
    return {
      style: {
        left: `${rng.range(-30, 90)}%`,
        top: `${rng.range(-40, 80)}%`,
        width: `${size}%`,
        height: `${size * rng.range(0.6, 1.4)}%`,
        background: color,
        borderRadius: `${radii.slice(0, 4).join(" ")} / ${radii.slice(4).join(" ")}`,
        filter: `blur(${rng.range(6, 16).toFixed(1)}cqmin)`,
        mixBlendMode: rng.pick(BLEND_MODES),
        opacity: rng.range(0.55, 0.95),
        "--vibe-rotate": `${Math.round(rng.range(0, 360))}deg`,
        "--vibe-dx": `${rng.range(-12, 12).toFixed(1)}%`,
        "--vibe-dy": `${rng.range(-12, 12).toFixed(1)}%`,
        animationDuration: `${rng.range(14, 28).toFixed(1)}s`,
        animationDelay: `${-rng.range(0, 20).toFixed(1)}s`,
      } as CSSProperties,
    };
  });

  return { base, blobs };
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * Procedural artwork for a vibe: a gradient base with blurred colour blobs
 * drawn from the vibe's light colours, plus grain and a legibility scrim.
 * Deterministic per vibe; `animate` makes the blobs drift slowly.
 */
export function VibeBackground({ vibe, animate = false, className }: {
  vibe: Pick<Vibe, "id" | "entities">;
  animate?: boolean;
  className?: string;
}) {
  const key = vibe.id + JSON.stringify(vibe.entities);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { base, blobs } = useMemo(() => compose(vibe), [key]);

  return (
    <div
      aria-hidden
      className={cn("absolute inset-0 overflow-hidden", className)}
      style={{ background: base, containerType: "size" }}
    >
      {blobs.map((blob, i) => (
        <div
          key={i}
          className={cn("vibe-blob absolute", animate && "vibe-blob-animate")}
          style={blob.style}
        />
      ))}
      <div className="absolute inset-0 opacity-[0.18] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
    </div>
  );
}
