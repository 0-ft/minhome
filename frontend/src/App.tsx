import { useState, useCallback, useRef, type ComponentType } from "react";
import { useLocation, useNavigate, Routes, Route, Navigate, Link } from "react-router-dom";
import { useRealtimeUpdates, useAuthCheck, useLogout } from "./api.js";
import { DevicesView } from "./components/DevicesView.js";
import { EntitiesView } from "./components/EntitiesView.js";
import { AutomationsView } from "./components/AutomationsView.js";
import { RoomView } from "./components/RoomView.js";
import { RoomFullView } from "./components/RoomFullView.js";
import { ListsView } from "./components/lists/ListsView.js";
import { DebugView } from "./components/DebugView.js";
import { ChatPane } from "./components/ChatPane.js";
import { LoginPage } from "./components/LoginPage.js";
import {
  Boxes,
  LampDesk,
  ListChecks,
  MessageSquare,
  Bot,
  LogOut,
  Plug,
} from "lucide-react";
import { Logo } from "./components/Logo.js";

const DESKTOP_TABS = ["entities", "devices", "automations", "room", "lists"] as const;
const MOBILE_TABS = [...DESKTOP_TABS, "chat"] as const;
type Tab = (typeof MOBILE_TABS)[number];
const TAB_META: Record<Tab, { label: string; Icon: ComponentType<{ className?: string }> }> = {
  entities: { label: "Entities", Icon: Boxes },
  devices: { label: "Devices", Icon: Plug },
  automations: { label: "Automations", Icon: Bot },
  room: { label: "Room", Icon: LampDesk },
  lists: { label: "Lists", Icon: ListChecks },
  chat: { label: "Chat", Icon: MessageSquare },
};

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
      <Route path="/log" element={<DebugLayout showLogout={showLogout} />} />
      <Route path="/404" element={<NotFoundPage showLogout={showLogout} />} />
      <Route path="/" element={<Navigate to="/entities" replace />} />
      <Route path="/*" element={<MainLayout showLogout={showLogout} />} />
    </Routes>
  );
}

function MainLayout({ showLogout }: { showLogout: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = (MOBILE_TABS.find((t) => location.pathname === `/${t}` || location.pathname.startsWith(`/${t}/`)) ?? "entities") as Tab;
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
      setChatWidth(Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, startWidth - delta)));
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
    <div className="h-screen flex bg-sand-100 md:bg-sand-50">
      <aside className="hidden md:flex w-56 shrink-0 border-r border-sand-300 bg-blood-300/80 backdrop-blur-lg p-4 flex-col gap-4">
        <div className="px-1">
          <Logo />
        </div>
        <nav className="flex flex-col gap-1 bg-blood-400/60 rounded-lg p-1">
          {DESKTOP_TABS.map((t) => {
            const { Icon, label } = TAB_META[t];
            return (
              <button
                key={t}
                onClick={() => navigate(`/${t}`)}
                className={`w-full text-left px-3 py-2 rounded-md text-xs uppercase tracking-wider transition-all cursor-pointer ${
                  tab === t
                    ? "bg-sand-50/90 text-blood-600"
                    : "text-blood-100 hover:text-sand-50 hover:bg-blood-400/40"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2">
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`h-9 w-9 inline-flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              chatOpen
                ? "bg-teal-400 text-teal-900"
                : "bg-blood-400/60 text-blood-100 hover:text-sand-50 hover:bg-blood-400/80"
            }`}
            title={chatOpen ? "Close AI chat" : "Open AI chat"}
            aria-label={chatOpen ? "Close AI chat" : "Open AI chat"}
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          {showLogout && (
            <button
              onClick={() => logout.mutate(undefined, { onSuccess: () => window.location.reload() })}
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-blood-400/60 text-blood-100 hover:text-sand-50 hover:bg-blood-400/80 transition-all cursor-pointer"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex">
        <div className="flex-1 min-w-0 overflow-hidden pb-14 md:pb-0">
          <main className="h-full overflow-hidden p-0 md:p-4">
            <div className="w-full h-full overflow-hidden md:min-h-[500px] md:rounded-xl md:bg-sand-100 md:border md:border-sand-300">
              <Routes>
                <Route
                  path="entities"
                  element={<div className="h-full overflow-y-auto"><div className="max-w-5xl mx-auto px-6 py-8"><EntitiesView /></div></div>}
                />
                <Route
                  path="devices"
                  element={<div className="h-full overflow-y-auto"><div className="max-w-5xl mx-auto px-6 py-8"><DevicesView /></div></div>}
                />
                <Route
                  path="automations"
                  element={<div className="h-full overflow-y-auto"><div className="max-w-5xl mx-auto px-6 py-8"><AutomationsView /></div></div>}
                />
                <Route path="room" element={<div className="h-full"><RoomView /></div>} />
                <Route path="lists/*" element={<div className="h-full"><ListsView /></div>} />
                <Route path="chat" element={<div className="h-full"><ChatPane onClose={() => navigate("/entities")} showCloseButton={false} /></div>} />
                <Route path="*" element={<Navigate to="/404" replace />} />
              </Routes>
            </div>
          </main>
        </div>

        {chatOpen && (
          <aside className="hidden md:block shrink-0 relative border-l border-sand-300 shadow-lg bg-sand-100" style={{ width: chatWidth }}>
            <div
              onMouseDown={onResizeStart}
              className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-teal-300/40 active:bg-teal-300/60 transition-colors z-10"
            />
            <ChatPane onClose={() => setChatOpen(false)} />
          </aside>
        )}
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-sand-300 bg-sand-100/95 backdrop-blur px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1">
        <div className="grid grid-cols-6 gap-1">
          {MOBILE_TABS.map((t) => {
            const { Icon, label } = TAB_META[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => navigate(`/${t}`)}
                className={`h-10 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer ${
                  tab === t
                    ? "bg-blood-100 text-blood-700"
                    : "text-sand-600 hover:bg-sand-200"
                }`}
                title={label}
                aria-label={label}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function DebugLayout({ showLogout }: { showLogout: boolean }) {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <div className="h-screen flex flex-col bg-sand-100">
      {/* Header */}
      <header className="shrink-0 bg-blood-300/80 backdrop-blur-lg">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-end justify-between">
          <Logo />

          <div className="flex items-center gap-2">
            <nav className="flex gap-0.5 bg-blood-400/60 rounded-lg p-0.5">
              {DESKTOP_TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => navigate(`/${t}`)}
                  className="px-3.5 py-1.5 rounded-md text-xs uppercase tracking-wider transition-all cursor-pointer text-blood-100 hover:text-sand-50 hover:bg-blood-400/40"
                >
                  {t}
                </button>
              ))}
            </nav>

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

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <DebugView />
        </div>
      </main>
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

function NotFoundPage({ showLogout }: { showLogout: boolean }) {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <div className="h-screen flex flex-col bg-sand-100">
      <header className="shrink-0 bg-blood-300/80 backdrop-blur-lg">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-end justify-between">
          <Logo />

          <div className="flex items-center gap-2">
            <nav className="flex gap-0.5 bg-blood-400/60 rounded-lg p-0.5">
              {DESKTOP_TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => navigate(`/${t}`)}
                  className="px-3.5 py-1.5 rounded-md text-xs uppercase tracking-wider transition-all cursor-pointer text-blood-100 hover:text-sand-50 hover:bg-blood-400/40"
                >
                  {t}
                </button>
              ))}
            </nav>

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

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <NotFound />
        </div>
      </main>
    </div>
  );
}
