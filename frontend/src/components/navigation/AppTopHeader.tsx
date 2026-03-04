import { LogOut } from "lucide-react";
import { Logo } from "../Logo.js";
import { DESKTOP_TABS, type DesktopTab } from "./appTabs.js";

export function AppTopHeader({
  showLogout,
  onNavigate,
  onLogout,
}: {
  showLogout: boolean;
  onNavigate: (tab: DesktopTab) => void;
  onLogout: () => void;
}) {
  return (
    <header className="shrink-0 bg-blood-300/80 backdrop-blur-lg">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-end justify-between">
        <Logo />

        <div className="flex items-center gap-2">
          <nav className="flex gap-0.5 bg-blood-400/60 rounded-lg p-0.5">
            {DESKTOP_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => onNavigate(tab)}
                className="px-3.5 py-1.5 rounded-md text-xs uppercase tracking-wider transition-all cursor-pointer text-blood-100 hover:text-sand-50 hover:bg-blood-400/40"
              >
                {tab}
              </button>
            ))}
          </nav>

          {showLogout && (
            <button
              onClick={onLogout}
              className="p-2 rounded-lg bg-blood-400/60 text-blood-100 hover:text-sand-50 hover:bg-blood-400/80 transition-all cursor-pointer"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
