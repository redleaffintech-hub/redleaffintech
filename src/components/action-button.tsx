"use client";

import { useState, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import { BUTTON_BASE, BUTTON_STYLES, type ButtonVariant } from "./button-styles";

type ButtonClickHandler = (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;

/**
 * The one Button every screen in this app renders through. Frozen (disabled)
 * for as long as the action it triggers is in flight, so a second click can
 * never fire the same mutation twice before the first one finishes. Two
 * independent cases, both covered automatically:
 *
 *  - onClick returns a Promise (a plain async click handler) — this Button
 *    tracks that promise itself and disables for its duration.
 *  - type="submit" inside a <form action={fn}> — useFormStatus reports that
 *    form's own pending state. Safe to call unconditionally: it returns the
 *    idle default when there is no enclosing form, and only a submit button
 *    ever looks at it, so an unrelated ancestor form being busy never freezes
 *    a plain type="button".
 *
 * A synchronous onClick (menu toggles, opening a dialog) is unaffected in
 * either case, since its handler returns before any disabled state would be
 * visible.
 *
 * This lives in its own "use client" file, separate from ui.tsx, so the rest
 * of that file's presentational exports (Card, Table, Badge, ...) stay plain
 * Server-Component-safe pieces with no client-JS cost of their own.
 */
export function Button({
  children,
  variant = "secondary",
  className,
  type = "button",
  onClick,
  disabled,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  variant?: ButtonVariant;
  onClick?: ButtonClickHandler;
}) {
  const [pending, setPending] = useState(false);
  const { pending: formPending } = useFormStatus();

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (!onClick || pending) return;
    const result = onClick(event);
    if (result instanceof Promise) {
      setPending(true);
      try {
        await result;
      } finally {
        setPending(false);
      }
    }
  }

  const frozen = pending || (type === "submit" && formPending);

  return (
    <button
      type={type}
      className={clsx(BUTTON_BASE, BUTTON_STYLES[variant], className)}
      disabled={disabled || frozen}
      onClick={onClick ? handleClick : undefined}
      {...props}
    >
      {children}
    </button>
  );
}
