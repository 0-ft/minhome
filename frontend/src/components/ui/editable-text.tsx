import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  const editableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editable = editableRef.current;
    if (!editable) return;
    if (!isEditing && editable.textContent !== value) {
      editable.textContent = value;
    }
    if (isEditing && (editable.textContent == null || editable.textContent.length === 0)) {
      editable.textContent = value;
    }
  }, [value, isEditing]);

  const getCurrentText = () => {
    const text = editableRef.current?.innerText ?? "";
    return text.replace(/\r/g, "");
  };

  const commit = () => {
    const nextValue = getCurrentText();
    const trimmed = nextValue.trim();
    if (trimmed.length === 0 || trimmed === value) {
      if (editableRef.current) {
        editableRef.current.textContent = value;
      }
      setIsEditing(false);
      return;
    }
    onSave(trimmed);
    setIsEditing(false);
  };

  const cancel = () => {
    if (editableRef.current) {
      editableRef.current.textContent = value;
    }
    setIsEditing(false);
  };

  return (
    <div
      ref={editableRef}
      role="textbox"
      aria-multiline="true"
      contentEditable={isEditing}
      suppressContentEditableWarning
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (isEditing) return;
        if (editableRef.current) {
          editableRef.current.textContent = value;
        }
        // Enter edit mode before browser default caret placement runs.
        flushSync(() => {
          setIsEditing(true);
        });
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
        "w-full bg-transparent border-0 p-0 m-0 focus:outline-none cursor-text",
        "whitespace-pre-wrap break-words",
        textClassName,
        className,
      )}
    >
      {value}
    </div>
  );
}
