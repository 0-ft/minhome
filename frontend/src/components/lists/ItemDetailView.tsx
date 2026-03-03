import { ViewTransition, useEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { MarkdownHooks } from "react-markdown";
import type { ListItem } from "../../api.js";
import { Button } from "../ui/button.js";
import { EditableText } from "../ui/editable-text.js";
import { markdownRehypePlugins } from "../markdownPlugins.js";
import { StatusPicker, type StatusOption } from "./StatusPicker.js";

export function ItemDetailView({
  item,
  cardViewTransitionName,
  titleViewTransitionName,
  statusViewTransitionName,
  statusOptions,
  onBack,
  onSavePatch,
  onSetStatus,
  onDelete,
}: {
  item: ListItem;
  cardViewTransitionName?: string;
  titleViewTransitionName?: string;
  statusViewTransitionName?: string;
  statusOptions: StatusOption[];
  onBack: () => void;
  onSavePatch: (patch: { title?: string; body?: string }) => void;
  onSetStatus: (statusId: string) => void;
  onDelete: () => void;
}) {
  const [bodyDraft, setBodyDraft] = useState(item.body ?? "");
  const [isEditingBody, setIsEditingBody] = useState(false);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setBodyDraft(item.body ?? "");
    setIsEditingBody(false);
  }, [item.id, item.body]);

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

  const saveBodyIfChanged = () => {
    const body = bodyDraft;
    if (body !== (item.body ?? "")) {
      onSavePatch({ body });
    }
  };

  const detailCard = (
    <div className="rounded-xl border border-sand-300 bg-sand-50 p-4 space-y-2 h-fit">
      <div>
        <div className="flex items-start justify-between gap-3 py-1">
          <div className="flex items-baseline gap-3 min-w-0 flex-1">
            <span className="text-3xl md:text-4xl font-normal text-sand-500">{item.id}</span>
            {titleViewTransitionName ? (
              <ViewTransition name={titleViewTransitionName} share="list-title-share">
                <EditableText
                  value={item.title}
                  onSave={(nextTitle) => onSavePatch({ title: nextTitle })}
                  textClassName="text-3xl md:text-4xl leading-tight font-normal text-sand-900"
                />
              </ViewTransition>
            ) : (
              <EditableText
                value={item.title}
                onSave={(nextTitle) => onSavePatch({ title: nextTitle })}
                textClassName="text-3xl md:text-4xl leading-tight font-normal text-sand-900"
              />
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1">
            <div className="origin-right scale-110">
              {statusViewTransitionName ? (
                <ViewTransition name={statusViewTransitionName} share="list-status-share">
                  <StatusPicker value={item.statusId} options={statusOptions} onChange={onSetStatus} />
                </ViewTransition>
              ) : (
                <StatusPicker value={item.statusId} options={statusOptions} onChange={onSetStatus} />
              )}
            </div>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onDelete} title="Delete item" aria-label="Delete item">
              <Trash2 className="h-[18px] w-[18px]" />
            </Button>
          </div>
        </div>
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
              saveBodyIfChanged();
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

  if (cardViewTransitionName) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-sand-700 hover:text-sand-900 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </button>
        <ViewTransition name={cardViewTransitionName} share="list-card-share">
          {detailCard}
        </ViewTransition>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-sand-700 hover:text-sand-900 cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to list
      </button>
      {detailCard}
    </div>
  );
}

