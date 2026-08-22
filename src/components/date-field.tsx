"use client";

import { useRef, useState } from "react";

/** Long enough that typing a year out digit by digit never navigates twice. */
const SETTLE_MS = 600;

/**
 * A date whose four digits of year are typed one at a time is a complete, valid
 * date at every step: 2026 is spelled 0002, 0020, 0202, 2026. Only the last of
 * those is worth acting on, and a year below 1000 is always mid-typing.
 */
export function isSettledDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1000;
}

/**
 * `<input type="date">` for a value that lives in the URL.
 *
 * The naive version — `value` from the search params, commit on change — cannot
 * be typed into: each keystroke commits a half-finished date, and because the
 * navigation runs in a transition the input is still bound to the *old* params
 * when React re-renders, so the field visibly snaps back to where it started.
 * Here the keystrokes go into a local draft and only a settled date is pushed
 * up, once typing pauses or the field is left. Picking from the calendar still
 * commits in one go, because it produces a settled date immediately.
 */
export function DateField({
  value,
  onCommit,
  allowEmpty = true,
  className,
  min,
  max,
  "aria-label": ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  /** False where the screen always needs a date — an emptied field reverts. */
  allowEmpty?: boolean;
  className?: string;
  min?: string;
  max?: string;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const timer = useRef<number | undefined>(undefined);

  // A value that *changes* — a preset button, the back button, our own commit
  // arriving back — wins over the draft. Comparing successive props rather than
  // draft against prop is what makes this safe: while a commit is still in
  // flight the prop is unchanged and stale, and treating that as an external
  // edit would yank the freshly typed date back to the old one.
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  function commit(next: string) {
    window.clearTimeout(timer.current);
    setDraft(next);
    // `value` can be a commit behind while a navigation is in flight, so a
    // repeat push is possible here; the query it builds is identical and the
    // writer drops it.
    if (next !== value) onCommit(next);
  }

  // An emptied field is a finished instruction only where the value is optional
  // (a list filter can be cleared; a report still has to run for some period).
  // It is also what the browser reports for a half-filled field, which is why
  // an abandoned edit is reverted on blur rather than committed.
  function settled(candidate: string) {
    return candidate === "" ? allowEmpty : isSettledDay(candidate);
  }

  return (
    <input
      type="date"
      value={draft}
      min={min}
      max={max}
      aria-label={ariaLabel}
      className={className}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        window.clearTimeout(timer.current);
        if (!settled(next)) return;
        timer.current = window.setTimeout(() => commit(next), SETTLE_MS);
      }}
      onBlur={() => {
        window.clearTimeout(timer.current);
        if (settled(draft)) commit(draft);
        else setDraft(value);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (settled(draft)) commit(draft);
      }}
    />
  );
}
