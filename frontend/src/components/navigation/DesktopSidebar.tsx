import { LogOut, MessageSquare } from "lucide-react";
import { Logo } from "../Logo.js";
import { DESKTOP_TABS, TAB_META, type DesktopTab, type Tab } from "./appTabs.js";

export function DesktopSidebar({
  activeTab,
  showLogout,
  chatOpen,
  onNavigate,
  onToggleChat,
  onLogout,
}: {
  activeTab: Tab;
  showLogout: boolean;
  chatOpen: boolean;
  onNavigate: (tab: DesktopTab) => void;
  onToggleChat: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className="hidden md:flex w-56 shrink-0 border-r border-sand-300 bg-blood-300/80 backdrop-blur-lg p-4 flex-col gap-4">
      <div className="px-1">
        <Logo />
      </div>

      <nav className="flex flex-col gap-1 bg-blood-400/60 rounded-lg p-1">
        {DESKTOP_TABS.map((tab) => {
          const { Icon, label } = TAB_META[tab];
          return (
            <button
              key={tab}
              onClick={() => onNavigate(tab)}
              className={`w-full text-left px-3 py-2 rounded-md text-xs uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === tab
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
          onClick={onToggleChat}
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
            onClick={onLogout}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-blood-400/60 text-blood-100 hover:text-sand-50 hover:bg-blood-400/80 transition-all cursor-pointer"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
