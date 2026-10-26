import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children?: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  width?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const onCancel = (event: React.SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault();
    if (dismissible) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={onCancel}
      onClose={() => {
        if (open) onClose();
      }}
      className="m-auto w-[calc(100vw-2rem)] rounded-sheet border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
      style={{ maxWidth: width === "sm" ? 420 : width === "md" ? 520 : 680 }}
    >
      <div className="flex items-start justify-between gap-6 px-6 pb-4 pt-5">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description !== undefined && (
            <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-ink-2">
              {description}
            </p>
          )}
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-2 -mt-1 rounded-control p-2 text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {children !== undefined && <div className="px-6 pb-5">{children}</div>}
      {footer !== undefined && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
    </dialog>
  );
}
