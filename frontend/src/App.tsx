import { useState, useCallback, useRef } from "react";
import { useRealtimeUpdates } from "./api.js";
import { DevicesView } from "./components/DevicesView.js";
import { AutomationsView } from "./components/AutomationsView.js";
import { ChatPane } from "./components/ChatPane.js";
import { MessageSquare } from "lucide-react";

const MIN_CHAT_WIDTH = 300;
const MAX_CHAT_WIDTH = 700;
const DEFAULT_CHAT_WIDTH = 440;

export function App() {
  useRealtimeUpdates();
  const [tab, setTab] = useState<"devices" | "automations">("devices");
  const [chatOpen, setChatOpen] = useState(
    () => window.matchMedia("(min-width: 768px)").matches,
  );
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const dragging = useRef(false);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = chatWidth;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX;
      setChatWidth(Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, startWidth + delta)));
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [chatWidth]);

  return (
    <div className="h-screen flex flex-col bg-sand-100">
      {/* Header */}
      <header className="shrink-0 bg-blood-300/80 backdrop-blur-lg">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-sand-50">
              minhome
            </h1>
            <p className="text-[11px] font-mono text-blood-100 mt-0.5">smart room control</p>
          </div>

          <div className="flex items-center gap-2">
            <nav className="flex gap-0.5 bg-blood-400/60 rounded-lg p-0.5">
              {(["devices", "automations"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition-all cursor-pointer ${
                    tab === t
                      ? "bg-sand-50/90 text-blood-600"
                      : "text-blood-100 hover:text-sand-50 hover:bg-blood-400/40"
                  }`}
                >
                  {t}
                </button>
              ))}
            </nav>

            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`p-2 rounded-lg transition-all cursor-pointer ${
                chatOpen
                  ? "bg-teal-400 text-teal-900"
                  : "bg-blood-400/60 text-blood-100 hover:text-sand-50 hover:bg-blood-400/80"
              }`}
              title={chatOpen ? "Close AI chat" : "Open AI chat"}
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Body: optional chat pane + scrollable main content */}
      <div className="flex-1 flex min-h-0">
        {chatOpen && (
          <aside className="shrink-0 relative border-r border-sand-300 shadow-lg" style={{ width: chatWidth }}>
            <ChatPane onClose={() => setChatOpen(false)} />
            {/* Resize handle */}
            <div
              onMouseDown={onResizeStart}
              className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-teal-300/40 active:bg-teal-300/60 transition-colors z-10"
            />
          </aside>
        )}

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8">
            {tab === "devices" ? <DevicesView /> : <AutomationsView />}
          </div>
        </main>
      </div>
    </div>
  );
}
