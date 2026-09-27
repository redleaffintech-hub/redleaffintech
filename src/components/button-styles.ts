/**
 * Shared between ui.tsx's LinkButton (a plain <a>, no click-freezing needed)
 * and action-button.tsx's Button (needs "use client" for its freeze-on-click
 * behavior) — kept in its own file with neither so it can be imported by
 * both without a circular import between them.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-[0_1px_2px_rgba(30,70,100,0.3)]",
  secondary: "bg-white text-ink-800 border border-paper-400 hover:bg-paper-100 hover:border-ink-300",
  ghost: "text-ink-700 hover:bg-paper-200",
  danger: "bg-white text-negative border border-[color:var(--color-negative)]/30 hover:bg-negative-soft",
};

export const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
