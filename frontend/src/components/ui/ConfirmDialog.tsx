import { Button } from "./button.js";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "destructive",
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "success";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 cursor-default"
        onClick={onCancel}
        aria-label="Close confirmation dialog"
      />
      <div className="relative w-full max-w-md rounded-xl border border-blood-300/50 bg-blood-500 p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-sand-50">{title}</h3>
        <p className="mt-2 text-sm text-blood-100">{message}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={pending}>
            {pending ? "Working..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
