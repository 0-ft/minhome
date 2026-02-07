import { useChat } from "@ai-sdk/react";
import { useState, useRef, useEffect } from "react";
import { Send, X, Loader2, Wrench, ChevronDown } from "lucide-react";
import type { UIMessage } from "ai";

export function ChatPane({ onClose }: { onClose: () => void }) {
  const { messages, sendMessage, status, stop, error, setMessages } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage({ text });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-sand-100 border-l border-sand-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blood-300/80 backdrop-blur-lg border-b border-blood-400/50">
        <div>
          <h2 className="text-sm font-semibold text-sand-50">AI Assistant</h2>
          <p className="text-[10px] font-mono text-blood-100 mt-0.5">
            {isLoading ? "thinking…" : "ready"}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-blood-100 hover:text-sand-50 hover:bg-blood-400/40 transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-sand-600">Ask me anything about your smart home.</p>
            <p className="text-xs font-mono text-sand-500 mt-1">
              I can control devices, create automations, and more.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {isLoading && messages.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-sand-500 pl-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="font-mono">thinking…</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-blood-600/20 border border-blood-400/30 px-3 py-2 text-xs text-blood-500">
            <p className="font-medium">Error</p>
            <p className="mt-0.5 font-mono">{error.message}</p>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-sand-300 px-4 py-3 bg-sand-50"
      >
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 resize-none rounded-lg bg-sand-200 px-3 py-2 text-sm text-sand-900 placeholder:text-sand-500 focus:outline-none focus:ring-2 focus:ring-teal-300/50 min-h-[36px] max-h-[120px]"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="shrink-0 p-2 rounded-lg bg-blood-400 text-sand-50 hover:bg-blood-500 transition-colors cursor-pointer"
              title="Stop generating"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="shrink-0 p-2 rounded-lg bg-teal-400 text-teal-900 hover:bg-teal-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-teal-400 text-teal-900 rounded-br-sm"
            : "bg-sand-200 text-sand-800 rounded-bl-sm"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <span key={i} className="whitespace-pre-wrap break-words">
                {part.text}
              </span>
            );
          }

          if (part.type === "dynamic-tool") {
            return <ToolCallPart key={i} part={part} />;
          }

          return null;
        })}
      </div>
    </div>
  );
}

// ── Tool Call Part ──────────────────────────────────────

interface ToolPart {
  type: "dynamic-tool";
  toolName: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function ToolCallPart({ part }: { part: ToolPart }) {
  const [expanded, setExpanded] = useState(false);

  const stateLabel =
    part.state === "output-available"
      ? "done"
      : part.state === "output-error"
        ? "error"
        : part.state === "input-streaming"
          ? "running…"
          : "running…";

  const stateColor =
    part.state === "output-available"
      ? "bg-teal-100 text-teal-700 border-teal-200"
      : part.state === "output-error"
        ? "bg-blood-100 text-blood-600 border-blood-200"
        : "bg-sand-300 text-sand-700 border-sand-400";

  return (
    <div className="my-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider border transition-colors cursor-pointer ${stateColor}`}
      >
        <Wrench className="h-3 w-3" />
        {part.toolName}
        <span className="opacity-70">({stateLabel})</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="mt-1 ml-1 p-2 rounded-md bg-sand-50/80 border border-sand-300 font-mono text-[10px] leading-relaxed overflow-auto max-h-32">
          {part.input != null && (
            <div>
              <span className="text-sand-500">input: </span>
              <span className="text-sand-700">
                {typeof part.input === "string"
                  ? part.input
                  : JSON.stringify(part.input, null, 2)}
              </span>
            </div>
          )}
          {part.output != null && (
            <div className="mt-1">
              <span className="text-sand-500">output: </span>
              <span className="text-sand-700">
                {typeof part.output === "string"
                  ? part.output
                  : JSON.stringify(part.output, null, 2)}
              </span>
            </div>
          )}
          {part.errorText && (
            <div className="mt-1 text-blood-500">
              error: {part.errorText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

