import * as React from "react";
import * as LucideIcons from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";

type LucideComponent = React.ComponentType<{
  className?: string;
  strokeWidth?: number;
}>;

const KEBAB_ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function kebabToPascalCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

const ICON_NAMES = Object.keys(dynamicIconImports).sort((a, b) => a.localeCompare(b));
const ICON_NAME_SET = new Set(ICON_NAMES);

export function IconPicker({
  value,
  onChange,
  placeholder = "Icon (optional)",
  className,
  disabled,
  maxResults = 48,
}: {
  value?: string;
  onChange: (icon?: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxResults?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState(value ?? "");
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setQuery(value ?? "");
  }, [value]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!rootRef.current || !target) return;
      if (rootRef.current.contains(target)) return;
      setOpen(false);
      setQuery(value ?? "");
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, value]);

  const normalized = query.trim().toLowerCase();
  const matches = React.useMemo(() => {
    if (normalized.length === 0) {
      return ICON_NAMES.slice(0, maxResults);
    }
    const exact = ICON_NAMES.filter((name) => name.toLowerCase() === normalized);
    const prefix = ICON_NAMES.filter((name) => {
      const lower = name.toLowerCase();
      return lower !== normalized && lower.startsWith(normalized);
    });
    const contains = ICON_NAMES.filter((name) => {
      const lower = name.toLowerCase();
      return lower !== normalized && !lower.startsWith(normalized) && lower.includes(normalized);
    });
    return [...exact, ...prefix, ...contains].slice(0, maxResults);
  }, [normalized, maxResults]);

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const exact = query.trim().toLowerCase();
            if (!exact || !ICON_NAME_SET.has(exact)) return;
            e.preventDefault();
            onChange(exact);
            setQuery(exact);
            setOpen(false);
          }}
          placeholder={placeholder}
          className={cn(
            "h-8 w-full rounded-md border border-sand-300 bg-sand-50 pl-8 pr-8 text-sm text-sand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/50",
            className,
          )}
        />
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sand-500">
          <IconPreview name={value} />
        </span>
        {(value || query.length > 0) && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(undefined);
              setQuery("");
              setOpen(false);
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded text-sand-500 hover:text-sand-700 hover:bg-sand-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear icon"
            aria-label="Clear icon"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-max max-h-64 max-w-[min(32rem,calc(100vw-2rem))] overflow-x-hidden overflow-y-auto scrollbar-float rounded-md border border-sand-300 bg-sand-50 shadow-lg p-1">
          {matches.length > 0 ? (
            matches.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onChange(name);
                  setQuery(name);
                  setOpen(false);
                }}
                className={cn(
                  "w-full px-2 py-1.5 rounded text-left text-xs font-mono text-sand-800 hover:bg-sand-100 flex items-center gap-2 cursor-pointer whitespace-nowrap",
                  name === value && "bg-sand-200",
                )}
              >
                <IconPreview name={name} />
                <span>{name}</span>
              </button>
            ))
          ) : (
            <div className="px-2 py-2 text-xs text-sand-500">No matching icons</div>
          )}
        </div>
      )}
    </div>
  );
}

function IconPreview({ name }: { name?: string }) {
  if (!name || !KEBAB_ICON_NAME_RE.test(name)) {
    return <span className="inline-block h-4 w-4 rounded-sm border border-sand-300" />;
  }
  const iconsByName = LucideIcons as Record<string, LucideComponent>;
  const Icon = iconsByName[kebabToPascalCase(name)];
  if (!Icon) return <span className="inline-block h-4 w-4 rounded-sm border border-sand-300" />;
  return <Icon className="h-4 w-4" strokeWidth={2} />;
}

