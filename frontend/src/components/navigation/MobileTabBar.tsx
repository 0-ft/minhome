import { useEffect, useRef } from "react";
import { Loader2, MessageSquare, Mic } from "lucide-react";
import { VISIBLE_MOBILE_TABS, TAB_META, type Tab } from "./appTabs.js";

type ChatVoiceStatus = "idle" | "connecting" | "listening" | "responding" | "error";
const LONG_PRESS_MS = 380;
const POST_LONG_PRESS_CLICK_SUPPRESSION_MS = 700;

export function MobileTabBar({
  activeTab,
  onNavigate,
  chatVoiceStatus,
  chatVoiceIsActive,
  chatVoiceCanStart,
  onChatVoiceStart,
  onChatVoiceStop,
}: {
  activeTab: Tab;
  onNavigate: (tab: Tab) => void;
  chatVoiceStatus: ChatVoiceStatus;
  chatVoiceIsActive: boolean;
  chatVoiceCanStart: boolean;
  onChatVoiceStart: () => Promise<void>;
  onChatVoiceStop: () => Promise<void>;
}) {
  const longPressTimerRef = useRef<number | null>(null);
  const suppressClickUntilRef = useRef(0);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current == null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  useEffect(() => clearLongPressTimer, []);

  const handleChatLongPress = () => {
    if (!chatVoiceCanStart) return;
    suppressClickUntilRef.current = Date.now() + POST_LONG_PRESS_CLICK_SUPPRESSION_MS;
    if (chatVoiceIsActive) {
      void onChatVoiceStop();
      return;
    }
    void onChatVoiceStart();
  };

  return (
    <nav className="md:hidden shrink-0 border-t border-grey-200 bg-grey-50/90 backdrop-blur-lg px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5">
      <div className="grid grid-cols-5 gap-1">
        {VISIBLE_MOBILE_TABS.map((tab) => {
          const { Icon, label } = TAB_META[tab];
          if (tab === "chat") {
            const chatButtonClass = chatVoiceStatus === "connecting"
              ? "bg-teal-100 text-teal-600"
              : chatVoiceStatus === "responding"
                ? "bg-teal-200 text-teal-700"
                : chatVoiceIsActive
                  ? "bg-teal-400 text-white"
                  : activeTab === tab
                    ? "bg-white text-grey-900 shadow-sm ring-1 ring-black/5"
                    : "text-grey-500 hover:bg-grey-200/70";
            const chatButtonStyle = {
              transition: "background-color 220ms ease, color 220ms ease",
            } as const;
            const chatLabel = chatVoiceCanStart
              ? chatVoiceIsActive
                ? "Chat voice active. Tap to stop."
                : "Chat. Tap to open, hold to start voice."
              : "Chat. voice.chat_id is not configured.";

            return (
              <button
                key={tab}
                type="button"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  clearLongPressTimer();
                  longPressTimerRef.current = window.setTimeout(handleChatLongPress, LONG_PRESS_MS);
                }}
                onPointerUp={clearLongPressTimer}
                onPointerCancel={clearLongPressTimer}
                onPointerLeave={clearLongPressTimer}
                onClick={() => {
                  if (Date.now() < suppressClickUntilRef.current) {
                    return;
                  }
                  if (chatVoiceIsActive) {
                    void onChatVoiceStop();
                    return;
                  }
                  onNavigate(tab);
                }}
                className={`h-11 rounded-xl inline-flex items-center justify-center cursor-pointer ${chatButtonClass}`}
                style={chatButtonStyle}
                title={chatLabel}
                aria-label={chatLabel}
              >
                {chatVoiceStatus === "connecting" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : chatVoiceStatus === "responding" ? (
                  <span className="inline-flex items-center gap-0.5">
                    <span className="h-1 w-1 rounded-full bg-current animate-bounce" />
                    <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:120ms]" />
                    <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:240ms]" />
                  </span>
                ) : chatVoiceIsActive ? (
                  <Mic className="h-5 w-5 animate-pulse" />
                ) : activeTab === tab ? (
                  <MessageSquare className="h-5 w-5" />
                ) : (
                  <Icon className="h-5 w-5" />
                )}
              </button>
            );
          }

          return (
            <button
              key={tab}
              type="button"
              onClick={() => onNavigate(tab)}
              className={`h-11 rounded-xl inline-flex items-center justify-center transition-colors cursor-pointer ${
                activeTab === tab
                  ? "bg-white text-grey-900 shadow-sm ring-1 ring-black/5"
                  : "text-grey-500 hover:bg-grey-200/70"
              }`}
              title={label}
              aria-label={label}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
