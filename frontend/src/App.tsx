import { useState, useCallback, useRef } from "react";
import { useLocation, useNavigate, Routes, Route, Navigate, Link } from "react-router-dom";
import { useRealtimeUpdates, useAuthCheck, useLogout } from "./api.js";
import { DevicesView } from "./components/DevicesView.js";
import { EntitiesView } from "./components/EntitiesView.js";
import { AutomationsView } from "./components/AutomationsView.js";
import { RoomView } from "./components/RoomView.js";
import { RoomFullView } from "./components/RoomFullView.js";
import { ChatPane } from "./components/ChatPane.js";
import { LoginPage } from "./components/LoginPage.js";
import { MessageSquare, LogOut } from "lucide-react";
import { Logo } from "./components/Logo.js";

const TABS = ["entities", "devices", "automations", "room"] as const;
type Tab = (typeof TABS)[number];

const MIN_CHAT_WIDTH = 300;
const MAX_CHAT_WIDTH = 700;
const DEFAULT_CHAT_WIDTH = 440;

export function App() {
  const { data: auth, isLoading } = useAuthCheck();

  // Still checking auth status
  if (isLoading) return null;

  // Auth required but not authenticated — show login
  if (auth?.required && !auth.authenticated) {
    return <LoginPage onSuccess={() => window.location.reload()} />;
  }

  return <AuthenticatedApp showLogout={auth?.required ?? false} />;
}

function AuthenticatedApp({ showLogout }: { showLogout: boolean }) {
  useRealtimeUpdates();

  return (
    <Routes>
      <Route path="/room-full" element={<RoomFullView />} />
      <Route path="/" element={<Navigate to="/entities" replace />} />
      <Route path="/*" element={<MainLayout showLogout={showLogout} />} />
    </Routes>
  );
}

function MainLayout({ showLogout }: { showLogout: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = (TABS.find((t) => location.pathname === `/${t}`) ?? "entities") as Tab;
  const logout = useLogout();
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
          <Logo />

          <div className="flex items-center gap-2">
            <nav className="flex gap-0.5 bg-blood-400/60 rounded-lg p-0.5">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => navigate(`/${t}`)}
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

            {showLogout && (
              <button
                onClick={() => logout.mutate(undefined, { onSuccess: () => window.location.reload() })}
                className="p-2 rounded-lg bg-blood-400/60 text-blood-100 hover:text-sand-50 hover:bg-blood-400/80 transition-all cursor-pointer"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
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
          <Routes>
            <Route path="/entities" element={<div className="max-w-5xl mx-auto px-6 py-8"><EntitiesView /></div>} />
            <Route path="/devices" element={<div className="max-w-5xl mx-auto px-6 py-8"><DevicesView /></div>} />
            <Route path="/automations" element={<div className="max-w-5xl mx-auto px-6 py-8"><AutomationsView /></div>} />
            <Route path="/room" element={<div className="h-full p-4"><RoomView /></div>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <span className="text-5xl font-bold font-mono text-sand-400">404</span>
      <p className="text-sm text-sand-600">Page not found.</p>
      <Link to="/entities" className="text-sm text-teal-500 hover:text-teal-400 underline underline-offset-2">
        Go home
      </Link>
    </div>
  );
}
