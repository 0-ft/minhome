import { useEffect, useState } from "react";
import { Button } from "./button.js";
import { Input } from "./input.js";

/** Modal asking for a single line of text, e.g. a name for something new. */
export function PromptDialog({
  open,
  title,
  message,
  placeholder,
  confirmLabel = "Create",
  cancelLabel = "Cancel",
  pending = false,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  if (!open) return null;

  const trimmed = value.trim();
  const disabled = pending || trimmed.length === 0;
  const submit = () => {
    if (!disabled) onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 cursor-default"
        onClick={onCancel}
        aria-label="Close dialog"
      />
      <div className="relative w-full max-w-md rounded-xl border border-blood-300/50 bg-blood-500 p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-sand-50">{title}</h3>
        {message && <p className="mt-1 text-sm text-blood-100">{message}</p>}
        <div className="mt-4">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="bg-sand-50 text-sand-900 border-sand-300 focus-visible:bg-sand-50"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onCancel();
            }}
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button disabled={disabled} onClick={submit}>
            {pending ? "Working..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
