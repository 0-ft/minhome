import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils.js";

export function EditableText({
  value,
  onSave,
  className,
  textClassName,
}: {
  value: string;
  onSave: (nextValue: string) => void;
  className?: string;
  textClassName?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isEditing) return;
    setDraftValue(value);
  }, [value, isEditing]);

  const resize = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    resize();
  }, [draftValue, value, isEditing]);

  const commit = () => {
    const trimmed = draftValue.trim();
    if (trimmed.length === 0 || trimmed === value) {
      setDraftValue(value);
      setIsEditing(false);
      return;
    }
    onSave(trimmed);
    setIsEditing(false);
  };

  const cancel = () => {
    setDraftValue(value);
    setIsEditing(false);
  };

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={isEditing ? draftValue : value}
      readOnly={!isEditing}
      onClick={(e) => {
        e.stopPropagation();
        if (!isEditing) setIsEditing(true);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        if (!isEditing) return;
        setDraftValue(e.target.value);
      }}
      onBlur={() => {
        if (!isEditing) return;
        commit();
      }}
      onKeyDown={(e) => {
        if (!isEditing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commit();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      className={cn(
        "w-full bg-transparent border-0 p-0 m-0 appearance-none resize-none overflow-hidden focus:outline-none cursor-text",
        "whitespace-pre-wrap break-words",
        textClassName,
        className,
      )}
    />
  );
}
