import { LogOut, MessageSquare } from "lucide-react";
import { Logo } from "../Logo.js";
import { cn } from "../../lib/utils.js";
import { VISIBLE_DESKTOP_TABS, TAB_META, type DesktopTab, type Tab } from "./appTabs.js";

const itemCls = "group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors cursor-pointer";
const activeCls = "bg-white text-grey-900 shadow-sm ring-1 ring-black/5";
const idleCls = "text-grey-600 hover:bg-grey-200/70 hover:text-grey-900";

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
    <aside className="hidden md:flex w-60 shrink-0 flex-col gap-6 border-r border-grey-200 bg-grey-50/80 px-3 py-5 backdrop-blur-lg">
      <div className="px-3">
        <Logo />
      </div>

      <nav className="flex flex-col gap-0.5">
        {VISIBLE_DESKTOP_TABS.map((tab) => {
          const { Icon, label } = TAB_META[tab];
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => onNavigate(tab)}
              aria-current={active ? "page" : undefined}
              className={cn(itemCls, active ? activeCls : idleCls)}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-grey-900" : "text-grey-500 group-hover:text-grey-700")} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-grey-200 pt-3">
        <button
          onClick={onToggleChat}
          aria-pressed={chatOpen}
          className={cn(itemCls, chatOpen ? activeCls : idleCls)}
        >
          <MessageSquare className={cn("h-4 w-4 shrink-0", chatOpen ? "text-teal-400" : "text-grey-500 group-hover:text-grey-700")} />
          <span className="flex-1 text-left">Assistant</span>
          <span className={cn("h-1.5 w-1.5 rounded-full transition-colors", chatOpen ? "bg-teal-400" : "bg-transparent")} />
        </button>

        {showLogout && (
          <button onClick={onLogout} className={cn(itemCls, idleCls)}>
            <LogOut className="h-4 w-4 shrink-0 text-grey-500 group-hover:text-grey-700" />
            <span>Sign out</span>
          </button>
        )}
      </div>
    </aside>
  );
}
