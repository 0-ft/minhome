import type { UIMessage } from "ai";
import { isToolPart } from "../ToolCallDisplay.js";
import type { ToolPart } from "../ToolCallDisplay.js";

export type ChatRenderItem
  = {
    kind: "text";
    id: string;
    role: "user" | "assistant";
    text: string;
  }
  | {
    kind: "toolGroup";
    id: string;
    tools: ToolPart[];
  };

export function buildChatRenderItems(messages: UIMessage[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let pendingTools: ToolPart[] = [];
  let pendingToolId = "";

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    items.push({
      kind: "toolGroup",
      id: pendingToolId || `tool-group-${items.length}`,
      tools: pendingTools,
    });
    pendingTools = [];
    pendingToolId = "";
  };

  for (const message of messages) {
    if (message.role === "user") {
      flushTools();
      const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      if (text.trim()) {
        items.push({
          kind: "text",
          id: `${message.id}-user`,
          role: "user",
          text,
        });
      }
      continue;
    }

    if (message.role !== "assistant") {
      continue;
    }

    message.parts.forEach((part, index) => {
      if (part.type === "text") {
        flushTools();
        if (!part.text.trim()) return;
        items.push({
          kind: "text",
          id: `${message.id}-text-${index}`,
          role: "assistant",
          text: part.text,
        });
        return;
      }

      if (isToolPart(part)) {
        if (pendingTools.length === 0) {
          pendingToolId = `${message.id}-tools-${index}`;
        }
        pendingTools.push(part as ToolPart);
      }
    });
  }

  flushTools();
  return items;
}
