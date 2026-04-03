import { useState, useCallback, useRef } from "react";
import { useLocation, useNavigate, Routes, Route, Navigate, Link } from "react-router-dom";
import { useRealtimeUpdates, useAuthCheck, useLogout, useConfig } from "./api.js";
import { DevicesView } from "./components/DevicesView.js";
import { EntitiesView } from "./components/EntitiesView.js";
import { AutomationsView } from "./components/AutomationsView.js";
import { RoomView } from "./components/RoomView.js";
import { RoomFullView } from "./components/RoomFullView.js";
import { ListsView } from "./components/lists/ListsView.js";
import { DebugView } from "./components/DebugView.js";
import { ChatPane } from "./components/ChatPane.js";
import { AppTopHeader } from "./components/navigation/AppTopHeader.js";
import { DesktopSidebar } from "./components/navigation/DesktopSidebar.js";
import { MobileTabBar } from "./components/navigation/MobileTabBar.js";
import { getActiveTab } from "./components/navigation/appTabs.js";
import { useBrowserVoiceWs } from "./components/chat/useBrowserVoiceWs.js";

const MIN_CHAT_WIDTH = 300;
const MAX_CHAT_WIDTH = 700;
const DEFAULT_CHAT_WIDTH = 440;

export function App() {
  const { data: auth } = useAuthCheck();
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
  const activeTab = getActiveTab(location.pathname);
  const logout = useLogout();
  const { data: config } = useConfig();
  const configuredVoiceChatId = String(config?.voice?.chat_id ?? "").trim() || null;
  const mobileVoice = useBrowserVoiceWs(configuredVoiceChatId);
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
    <div className="h-screen flex flex-col md:flex-row bg-sand-100 md:bg-sand-50">
      <DesktopSidebar
        activeTab={activeTab}
        showLogout={showLogout}
        chatOpen={chatOpen}
        onNavigate={(tab) => navigate(`/${tab}`)}
        onToggleChat={() => setChatOpen(!chatOpen)}
        onLogout={() => logout.mutate(undefined, { onSuccess: () => { window.location.href = "/"; } })}
      />

      <div className="flex-1 min-w-0 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
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

      <MobileTabBar
        activeTab={activeTab}
        onNavigate={(tab) => navigate(`/${tab}`)}
        chatVoiceStatus={mobileVoice.status}
        chatVoiceIsActive={mobileVoice.isActive}
        chatVoiceCanStart={Boolean(configuredVoiceChatId)}
        onChatVoiceStart={mobileVoice.start}
        onChatVoiceStop={mobileVoice.stop}
      />
    </div>
  );
}

function DebugLayout({ showLogout }: { showLogout: boolean }) {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <div className="h-screen flex flex-col bg-sand-100">
      <AppTopHeader
        showLogout={showLogout}
        onNavigate={(tab) => navigate(`/${tab}`)}
        onLogout={() => logout.mutate(undefined, { onSuccess: () => { window.location.href = "/"; } })}
      />
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
      <AppTopHeader
        showLogout={showLogout}
        onNavigate={(tab) => navigate(`/${tab}`)}
        onLogout={() => logout.mutate(undefined, { onSuccess: () => { window.location.href = "/"; } })}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <NotFound />
        </div>
      </main>
    </div>
  );
}
