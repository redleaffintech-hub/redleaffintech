"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Icon } from "@/components/shell/icons";

/**
 * A modal dialog for the flows that must not lose the form behind them — adding
 * a customer mid-invoice, or previewing a document before it posts.
 *
 * Deliberately not `<dialog>`: the invoice preview needs the page's print styles
 * to reach it, and a top-layer dialog is not part of the printed document.
 *
 * Rendered through a portal to `document.body`: `fixed inset-0` only covers the
 * viewport if nothing between it and `<body>` creates a CSS containing block —
 * a `filter`/`backdrop-filter`/`transform` on any ancestor traps it there
 * instead. The topbar's `backdrop-blur-md` wrapper is exactly that trap, and
 * without the portal a modal opened from the account menu renders squashed
 * into the topbar's own height rather than over the page.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  size?: "md" | "lg" | "xl";
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // document.body does not exist during SSR; this is the no-effect way to
  // know the client has taken over (the server snapshot is always false).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // Stop the page behind from scrolling under the dialog.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus in, so Tab cycles the dialog's own fields rather than the form
    // underneath it.
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="no-print fixed inset-0 cursor-default bg-ink-950/40 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={clsx(
          "rise relative my-auto w-full rounded-[--radius-card] border border-paper-300 bg-white shadow-[0_24px_64px_-16px_rgba(10,16,32,0.35)] focus:outline-none",
          size === "md" && "max-w-lg",
          size === "lg" && "max-w-2xl",
          size === "xl" && "max-w-4xl",
        )}
      >
        <div className="no-print flex items-start gap-4 border-b border-paper-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[0.9375rem] font-semibold text-ink-950">{title}</h2>
            {description && <p className="mt-0.5 text-[0.8125rem] leading-5 text-muted-ink">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-400 transition-colors hover:bg-paper-200 hover:text-ink-800"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <div className="no-print flex flex-wrap items-center justify-end gap-2 border-t border-paper-200 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
