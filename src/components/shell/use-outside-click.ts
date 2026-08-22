import { useEffect, useRef } from "react";

/**
 * Closes a popover when the pointer goes down anywhere outside it, or on Escape.
 *
 * Shared by the topbar menus and the module nav so every dropdown in the shell
 * dismisses the same way. `handler` is kept in a ref rather than in the effect's
 * dependency list: callers pass an inline arrow, so depending on it directly
 * would tear the listener down and rebuild it on every render.
 */
export function useOutsideClick<T extends HTMLElement = HTMLDivElement>(handler: () => void) {
  const ref = useRef<T>(null);
  const latest = useRef(handler);

  // Written from an effect, not during render: a ref must not be mutated while
  // rendering. This runs before the listeners below could ever fire, because
  // effects flush in order and a pointer event cannot interleave between them.
  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) latest.current();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") latest.current();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return ref;
}
