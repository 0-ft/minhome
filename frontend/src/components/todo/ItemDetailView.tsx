import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import ReactMarkdown, { MarkdownHooks } from "react-markdown";
import type { TodoItem, TodoStatus } from "../../api.js";
import { Button } from "../ui/button.js";
import { markdownRehypePlugins } from "../markdownPlugins.js";
import { StatusPicker } from "./StatusPicker.js";

export function ItemDetailView({
  item,
  statusOptions,
  statusIconByStatus,
  onBack,
  onSavePatch,
  onSetStatus,
  onDelete,
}: {
  item: TodoItem;
  statusOptions: TodoStatus[];
  statusIconByStatus?: Partial<Record<TodoStatus, string | undefined>>;
  onBack: () => void;
  onSavePatch: (patch: { title?: string; body?: string }) => void;
  onSetStatus: (status: TodoStatus) => void;
  onDelete: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(item.title);
  const [bodyDraft, setBodyDraft] = useState(item.body ?? "");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingBody, setIsEditingBody] = useState(false);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setTitleDraft(item.title);
    setBodyDraft(item.body ?? "");
    setIsEditingTitle(false);
    setIsEditingBody(false);
  }, [item.id, item.title, item.body]);

  const resizeBodyEditor = () => {
    const textarea = bodyTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    if (!isEditingBody) return;
    resizeBodyEditor();
  }, [isEditingBody, bodyDraft]);

  const saveIfChanged = () => {
    const title = titleDraft.trim();
    const body = bodyDraft;
    if (!title) return;
    if (title !== item.title || body !== (item.body ?? "")) {
      onSavePatch({ title, body });
    }
  };

  return (
    <div className="rounded-xl border border-sand-300 bg-sand-50 p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-sand-700 hover:text-sand-900 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-sand-500">#{item.id}</span>
          <StatusPicker value={item.status} options={statusOptions} iconByStatus={statusIconByStatus} onChange={onSetStatus} />
          <Button size="icon" variant="ghost" onClick={onDelete} title="Delete item" aria-label="Delete item">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div>
        {isEditingTitle ? (
          <div className="flex items-baseline gap-3 py-1">
            <span className="text-3xl md:text-4xl font-normal text-sand-500 font-mono">#{item.id}</span>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                saveIfChanged();
                setIsEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                saveIfChanged();
                setIsEditingTitle(false);
              }}
              autoFocus
              className="w-full bg-transparent text-3xl md:text-4xl font-normal text-sand-900 outline-none"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingTitle(true)}
            className="w-full text-left py-1 cursor-text"
          >
            <div className="flex items-baseline gap-3">
              <span className="text-3xl md:text-4xl font-normal text-sand-500 font-mono">#{item.id}</span>
              <div className="text-3xl md:text-4xl leading-tight font-normal text-sand-900">
                <ReactMarkdown
                  allowedElements={["p", "em", "strong", "code"]}
                  components={{
                    p: ({ children }) => <span className="text-inherit leading-inherit">{children}</span>,
                    em: ({ children }) => <em className="text-inherit">{children}</em>,
                    strong: ({ children }) => <strong className="text-inherit font-semibold">{children}</strong>,
                    code: ({ children }) => (
                      <code className="rounded bg-sand-200 px-1.5 py-0.5 text-[0.8em] font-medium">{children}</code>
                    ),
                  }}
                >
                  {titleDraft}
                </ReactMarkdown>
              </div>
            </div>
          </button>
        )}
      </div>

      <div>
        {isEditingBody ? (
          <textarea
            ref={bodyTextareaRef}
            value={bodyDraft}
            onChange={(e) => {
              setBodyDraft(e.target.value);
              resizeBodyEditor();
            }}
            onBlur={() => {
              saveIfChanged();
              setIsEditingBody(false);
            }}
            rows={1}
            autoFocus
            className="w-full resize-none overflow-hidden bg-transparent py-1 pb-2 text-sm text-sand-900 focus-visible:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingBody(true)}
            className="w-full text-left py-1 cursor-text"
          >
            <div className="prose-chat text-sand-900 pb-2">
              {bodyDraft.trim().length > 0 ? (
                <MarkdownHooks rehypePlugins={markdownRehypePlugins} fallback={<pre className="whitespace-pre-wrap">{bodyDraft}</pre>}>
                  {bodyDraft}
                </MarkdownHooks>
              ) : (
                <span className="text-sand-500 text-sm">Click to add markdown body...</span>
              )}
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

