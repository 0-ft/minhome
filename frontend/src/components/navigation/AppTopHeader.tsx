import { LogOut } from "lucide-react";
import { Logo } from "../Logo.js";
import { VISIBLE_DESKTOP_TABS, type DesktopTab } from "./appTabs.js";

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
    <header className="shrink-0 border-b border-grey-200 bg-grey-50/80 backdrop-blur-lg">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
        <Logo />

        <div className="flex items-center gap-2">
          <nav className="flex gap-0.5">
            {VISIBLE_DESKTOP_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => onNavigate(tab)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors cursor-pointer text-grey-600 hover:bg-grey-200/70 hover:text-grey-900"
              >
                {tab}
              </button>
            ))}
          </nav>

          {showLogout && (
            <button
              onClick={onLogout}
              className="p-2 rounded-lg text-grey-600 hover:bg-grey-200/70 hover:text-grey-900 transition-colors cursor-pointer"
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
