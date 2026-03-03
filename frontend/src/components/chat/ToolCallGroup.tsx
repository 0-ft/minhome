import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toolPartName } from "../ToolCallDisplay.js";
import type { ToolPart } from "../ToolCallDisplay.js";

type Variant = "regular" | "roomFull";

export function ToolCallGroup({
  parts,
  variant,
}: {
  parts: ToolPart[];
  variant: Variant;
}) {
  const isRoomFull = variant === "roomFull";
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const prettyValue = (value: unknown) => {
    if (value == null) return null;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <div className="flex flex-row flex-wrap gap-2">
      {parts.map((part, idx) => {
        const key = `${part.toolCallId}-${idx}`;
        const done = part.state === "output-available";
        const errored = part.state === "output-error";
        const running = !done && !errored;
        const expanded = expandedKeys.has(key);
        const input = prettyValue(part.input);
        const output = prettyValue(part.output);
        const chipTone = isRoomFull
          ? done
            ? "border-teal-400/25 bg-teal-400/10 text-teal-200"
            : errored
              ? "border-blood-400/30 bg-blood-500/10 text-blood-300"
              : "border-white/[0.12] bg-white/[0.04] text-sand-300"
          : done
            ? "border-teal-300 bg-teal-100/70 text-teal-800"
            : errored
              ? "border-blood-300 bg-blood-100/50 text-blood-700"
              : "border-sand-300 bg-sand-50 text-sand-700";
        const chipHover = isRoomFull
          ? done
            ? "hover:bg-teal-400/16"
            : errored
              ? "hover:bg-blood-500/16"
              : "hover:bg-white/[0.08]"
          : done
            ? "hover:bg-teal-100"
            : errored
              ? "hover:bg-blood-100/70"
              : "hover:bg-sand-100";
        const seamTop = isRoomFull
          ? done
            ? "border-t-teal-400/25"
            : errored
              ? "border-t-blood-400/30"
              : "border-t-white/[0.12]"
          : done
            ? "border-t-teal-300"
            : errored
              ? "border-t-blood-300"
              : "border-t-sand-300";
        return (
          <div key={key} className={`flex flex-col min-w-0 w-fit ${expanded ? "basis-full" : ""}`}>
            <button
              type="button"
              onClick={() => toggleExpanded(key)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono cursor-pointer ${
                expanded ? "rounded-b-none border-b-0" : ""
              } ${chipTone} ${chipHover} transition-colors`}
              title={errored && part.errorText ? part.errorText : undefined}
            >
              {done ? (
                <Check className="h-3 w-3" />
              ) : errored ? (
                <X className="h-3 w-3" />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              <span>{toolPartName(part)}</span>
              {running && <span className="opacity-70">…</span>}
            </button>

            {expanded && (
              <div
                className={`w-full rounded-md rounded-t-none border ${seamTop} px-2 py-1.5 text-[10px] font-mono leading-relaxed whitespace-pre-wrap break-all ${
                  isRoomFull
                    ? "border-white/[0.12] bg-black/25 text-sand-300"
                    : "border-sand-300 bg-sand-50 text-sand-700"
                }`}
              >
                {input && (
                  <div className="mb-1">
                    <span className={isRoomFull ? "text-sand-500" : "text-sand-500"}>input </span>
                    <pre>{input}</pre>
                  </div>
                )}
                {output && (
                  <div className="mb-1">
                    <span className={isRoomFull ? "text-sand-500" : "text-sand-500"}>output </span>
                    <pre>{output}</pre>
                  </div>
                )}
                {part.errorText && (
                  <div className={isRoomFull ? "text-blood-300" : "text-blood-600"}>
                    error: {part.errorText}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
