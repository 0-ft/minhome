import { VISIBLE_MOBILE_TABS, TAB_META, type Tab } from "./appTabs.js";

export function MobileTabBar({
  activeTab,
  onNavigate,
}: {
  activeTab: Tab;
  onNavigate: (tab: Tab) => void;
}) {
  return (
    <nav className="md:hidden shrink-0 border-t border-sand-300 bg-sand-100/95 backdrop-blur px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1">
      <div className="grid grid-cols-5 gap-1">
        {VISIBLE_MOBILE_TABS.map((tab) => {
          const { Icon, label } = TAB_META[tab];
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onNavigate(tab)}
              className={`h-10 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer ${
                activeTab === tab
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
  );
}
