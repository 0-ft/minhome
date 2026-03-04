import type { ComponentType } from "react";
import { Boxes, LampDesk, ListChecks, MessageSquare, Bot, Plug } from "lucide-react";

export const DESKTOP_TABS = ["entities", "devices", "automations", "room", "lists"] as const;
export const MOBILE_TABS = [...DESKTOP_TABS, "chat"] as const;

export type DesktopTab = (typeof DESKTOP_TABS)[number];
export type Tab = (typeof MOBILE_TABS)[number];

export const TAB_META: Record<Tab, { label: string; Icon: ComponentType<{ className?: string }> }> = {
  entities: { label: "Entities", Icon: Boxes },
  devices: { label: "Devices", Icon: Plug },
  automations: { label: "Automations", Icon: Bot },
  room: { label: "Room", Icon: LampDesk },
  lists: { label: "Lists", Icon: ListChecks },
  chat: { label: "Chat", Icon: MessageSquare },
};

export function getActiveTab(pathname: string): Tab {
  return MOBILE_TABS.find((tab) => pathname === `/${tab}` || pathname.startsWith(`/${tab}/`)) ?? "entities";
}
