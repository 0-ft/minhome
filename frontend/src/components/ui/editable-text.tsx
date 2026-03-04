import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "../../lib/utils.js";

export function EditableText({
  value,
  onSave,
  fullWidth = true,
  className,
  textClassName,
}: {
  value: string;
  onSave: (nextValue: string) => void;
  fullWidth?: boolean;
  className?: string;
  textClassName?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [displayValue, setDisplayValue] = useState(value);
  const [pendingCommittedValue, setPendingCommittedValue] = useState<string | null>(null);
  const editableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editable = editableRef.current;
    if (!editable) return;
    if (pendingCommittedValue != null) {
      // While awaiting parent/cache propagation, hold on to committed text to avoid visual snapback.
      if (value === pendingCommittedValue) {
        setPendingCommittedValue(null);
      }
      return;
    }
    if (!isEditing) {
      setDisplayValue(value);
      if (editable.textContent !== value) {
        editable.textContent = value;
      }
    }
    if (isEditing && (editable.textContent == null || editable.textContent.length === 0)) {
      editable.textContent = value;
    }
  }, [value, isEditing, pendingCommittedValue]);

  const getCurrentText = () => {
    const text = editableRef.current?.innerText ?? "";
    return text.replace(/\r/g, "");
  };

  const commit = () => {
    const nextValue = getCurrentText();
    const trimmed = nextValue.trim();
    if (trimmed.length === 0 || trimmed === value) {
      setPendingCommittedValue(null);
      setDisplayValue(value);
      if (editableRef.current) {
        editableRef.current.textContent = value;
      }
      setIsEditing(false);
      return;
    }
    setPendingCommittedValue(trimmed);
    setDisplayValue(trimmed);
    onSave(trimmed);
    setIsEditing(false);
  };

  const cancel = () => {
    setPendingCommittedValue(null);
    setDisplayValue(value);
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
        fullWidth ? "w-full" : "w-fit max-w-full",
        "bg-transparent border-0 p-0 m-0 focus:outline-none cursor-text",
        "whitespace-pre-wrap break-words",
        textClassName,
        className,
      )}
    >
      {displayValue}
    </div>
  );
}
