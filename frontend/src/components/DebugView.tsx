import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ChevronDown,
  Trash2,
  Pause,
  Play,
  Search,
  ArrowUp,
  MessageSquare,
  Mic,
  Wrench,
  Radio,
  Zap,
  AlertCircle,
  Filter,
} from "lucide-react";
import { useDebugLogs, useDebugLogStream, useClearDebugLogs, type DebugLogEntry } from "../api.js";

// ── Type metadata ──────────────────────────────────────

interface TypeMeta {
  label: string;
  color: string;     // tailwind bg color
  textColor: string;  // tailwind text color
  icon: React.ComponentType<{ className?: string }>;
  group: string;
}

const TYPE_META: Record<string, TypeMeta> = {
  chat_request:        { label: "Chat Request",       color: "bg-blue-100",    textColor: "text-blue-700",    icon: MessageSquare, group: "chat" },
  chat_response:       { label: "Chat Response",      color: "bg-blue-50",     textColor: "text-blue-600",    icon: MessageSquare, group: "chat" },
  chat_tool_call:      { label: "Chat Tool Call",     color: "bg-violet-100",  textColor: "text-violet-700",  icon: Wrench,        group: "chat" },
  chat_tool_result:    { label: "Chat Tool Result",   color: "bg-violet-50",   textColor: "text-violet-600",  icon: Wrench,        group: "chat" },
  voice_session_start: { label: "Voice Start",        color: "bg-amber-100",   textColor: "text-amber-700",   icon: Mic,           group: "voice" },
  voice_session_end:   { label: "Voice End",          color: "bg-amber-50",    textColor: "text-amber-600",   icon: Mic,           group: "voice" },
  voice_speech:        { label: "Voice Speech",       color: "bg-amber-50",    textColor: "text-amber-600",   icon: Mic,           group: "voice" },
  voice_transcript:    { label: "Voice Transcript",   color: "bg-amber-100",   textColor: "text-amber-700",   icon: Mic,           group: "voice" },
  voice_tool_call:     { label: "Voice Tool Call",    color: "bg-violet-100",  textColor: "text-violet-700",  icon: Wrench,        group: "voice" },
  voice_tool_result:   { label: "Voice Tool Result",  color: "bg-violet-50",   textColor: "text-violet-600",  icon: Wrench,        group: "voice" },
  voice_audio:         { label: "Voice Audio",        color: "bg-amber-50",    textColor: "text-amber-500",   icon: Mic,           group: "voice" },
  voice_error:         { label: "Voice Error",        color: "bg-red-100",     textColor: "text-red-700",     icon: AlertCircle,   group: "voice" },
  mqtt_state_change:   { label: "State Change",       color: "bg-teal-50",     textColor: "text-teal-700",    icon: Radio,         group: "mqtt" },
  mqtt_message:        { label: "MQTT Message",       color: "bg-teal-100",    textColor: "text-teal-700",    icon: Radio,         group: "mqtt" },
  automation_fired:    { label: "Automation Fired",   color: "bg-yellow-100",  textColor: "text-yellow-700",  icon: Zap,           group: "automation" },
  automation_created:  { label: "Automation Created", color: "bg-green-100",   textColor: "text-green-700",   icon: Zap,           group: "automation" },
  automation_updated:  { label: "Automation Updated", color: "bg-yellow-50",   textColor: "text-yellow-600",  icon: Zap,           group: "automation" },
  automation_deleted:  { label: "Automation Deleted", color: "bg-red-100",     textColor: "text-red-700",     icon: Zap,           group: "automation" },
  api_request:         { label: "API Request",        color: "bg-sand-200",    textColor: "text-sand-700",    icon: Zap,           group: "api" },
  device_control:      { label: "Device Control",     color: "bg-teal-100",    textColor: "text-teal-700",    icon: Radio,         group: "mqtt" },
  error:               { label: "Error",              color: "bg-red-100",     textColor: "text-red-700",     icon: AlertCircle,   group: "error" },
};

const GROUPS = [
  { id: "all",        label: "All" },
  { id: "chat",       label: "Chat" },
  { id: "voice",      label: "Voice" },
  { id: "mqtt",       label: "MQTT" },
  { id: "automation", label: "Automations" },
];

function getMeta(type: string): TypeMeta {
  return TYPE_META[type] ?? {
    label: type,
    color: "bg-sand-200",
    textColor: "text-sand-700",
    icon: Zap,
    group: "other",
  };
}

// ── JSON viewer ────────────────────────────────────────

function JsonView({ data }: { data: unknown }) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  return (
    <pre className="text-xs font-mono text-sand-800 bg-sand-100 rounded-lg p-3 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all border border-sand-200">
      {text}
    </pre>
  );
}

// ── Log row ────────────────────────────────────────────

function LogRow({ entry, isExpanded, onToggle }: {
  entry: DebugLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const meta = getMeta(entry.type);
  const Icon = meta.icon;
  const ts = new Date(entry.timestamp);
  const timeStr = ts.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const msStr = `.${String(ts.getMilliseconds()).padStart(3, "0")}`;

  return (
    <div className={`border-b border-sand-200 last:border-b-0 transition-colors ${isExpanded ? "bg-sand-50" : "hover:bg-sand-50/60"}`}>
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer group"
      >
        {/* Timestamp */}
        <span className="shrink-0 text-[11px] font-mono text-sand-500 tabular-nums w-[90px]">
          {timeStr}<span className="text-sand-400">{msStr}</span>
        </span>

        {/* Type badge */}
        <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider ${meta.color} ${meta.textColor}`}>
          <Icon className="h-3 w-3" />
          {meta.label}
        </span>

        {/* Summary */}
        <span className="flex-1 text-sm text-sand-800 truncate">
          {entry.summary}
        </span>

        {/* Entry ID */}
        <span className="shrink-0 text-[10px] font-mono text-sand-400">
          #{entry.id}
        </span>

        {/* Expand chevron */}
        <ChevronDown className={`shrink-0 h-3.5 w-3.5 text-sand-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded detail */}
      {isExpanded && entry.data != null && (
        <div className="px-4 pb-3 pt-0">
          <JsonView data={entry.data} />
        </div>
      )}
      {isExpanded && entry.data == null && (
        <div className="px-4 pb-3 pt-0">
          <p className="text-xs text-sand-400 italic">No additional data.</p>
        </div>
      )}
    </div>
  );
}

// ── Main view ──────────────────────────────────────────

export function DebugView() {
  const { data: initialLogs, isLoading } = useDebugLogs();
  const clearLogs = useClearDebugLogs();

  // Local state for streaming logs (stored in chronological order internally)
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");

  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Initialize from REST when loaded
  useEffect(() => {
    if (initialLogs) {
      setLogs(initialLogs);
    }
  }, [initialLogs]);

  // Stream new entries via WebSocket — append to end (newest last internally)
  useDebugLogStream(
    useCallback(
      (entry: DebugLogEntry) => {
        if (paused) return;
        setLogs((prev) => {
          // Avoid duplicates
          if (prev.length > 0 && prev[prev.length - 1].id >= entry.id) return prev;
          const next = [...prev, entry];
          // Trim to 2000 client-side (drop oldest)
          return next.length > 2000 ? next.slice(-2000) : next;
        });
      },
      [paused],
    ),
  );

  // Auto-scroll to top when new entries arrive (since display is reverse chronological)
  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [logs]);

  // Detect manual scroll — auto-scroll is active when user is at the top
  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    autoScrollRef.current = listRef.current.scrollTop < 40;
  }, []);

  const scrollToTop = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
      autoScrollRef.current = true;
    }
  }, []);

  const toggleExpanded = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    clearLogs.mutate();
    setLogs([]);
    setExpandedIds(new Set());
  }, [clearLogs]);

  // Filter then reverse for display (newest first)
  const filteredLogs = useMemo(() => {
    let result = logs;

    if (activeGroup !== "all") {
      result = result.filter((e) => getMeta(e.type).group === activeGroup);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.summary.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q) ||
          (e.data && JSON.stringify(e.data).toLowerCase().includes(q)),
      );
    }

    // Reverse: newest first
    return [...result].reverse();
  }, [logs, activeGroup, searchQuery]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-sand-600 py-12 justify-center">
        <div className="h-3 w-3 rounded-full bg-teal-300 animate-pulse" />
        Loading debug logs...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-sand-900">Debug Log</h2>
            <p className="text-xs text-sand-500 font-mono mt-0.5">
              {logs.length} entries{filteredLogs.length !== logs.length && ` (${filteredLogs.length} shown)`}
              {paused && " \u00b7 paused"}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPaused(!paused)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                paused
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                  : "bg-sand-200 text-sand-600 hover:bg-sand-300"
              }`}
              title={paused ? "Resume streaming" : "Pause streaming"}
            >
              {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {paused ? "Resume" : "Pause"}
            </button>

            <button
              onClick={scrollToTop}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sand-200 text-sand-600 hover:bg-sand-300 text-xs font-medium transition-colors cursor-pointer"
              title="Scroll to newest"
            >
              <ArrowUp className="h-3 w-3" />
            </button>

            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blood-100 text-blood-600 hover:bg-blood-200 text-xs font-medium transition-colors cursor-pointer"
              title="Clear all logs"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          {/* Group filter */}
          <div className="flex gap-0.5 bg-sand-200 rounded-lg p-0.5">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                onClick={() => setActiveGroup(g.id)}
                className={`px-3 py-1 rounded-md text-[11px] font-mono uppercase tracking-wider transition-all cursor-pointer ${
                  activeGroup === g.id
                    ? "bg-sand-50 text-sand-900 shadow-sm"
                    : "text-sand-500 hover:text-sand-700 hover:bg-sand-100/60"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sand-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-sand-50 border border-sand-300 text-sm text-sand-800 placeholder:text-sand-400 focus:outline-none focus:ring-2 focus:ring-teal-300/50"
            />
          </div>
        </div>
      </div>

      {/* Log list — reverse chronological (newest at top) */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="rounded-xl bg-white border border-sand-200 shadow-sm overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 280px)" }}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Filter className="h-6 w-6 text-sand-300" />
            <p className="text-sm text-sand-500">
              {logs.length === 0
                ? "No events recorded yet. Interact with the system to see logs."
                : "No matching events."}
            </p>
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <LogRow
              key={entry.id}
              entry={entry}
              isExpanded={expandedIds.has(entry.id)}
              onToggle={() => toggleExpanded(entry.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
