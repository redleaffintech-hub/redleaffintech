"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Write to the query string, which is where every list filter keeps its state.
 *
 * `useSearchParams()` reports the *committed* URL, and a filter navigation runs
 * inside a transition that only commits once the server has re-rendered the
 * list. Rebuilding the query from those params therefore drops any edit made
 * while an earlier one is still in flight — set a date, then immediately pick a
 * status, and the date is gone. So the last query we pushed is staged here and
 * later writes build on that, while a URL that changed underneath us (the back
 * button, a link) takes the staged value back over.
 */
export function useQueryParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = params.toString();
  const [seen, setSeen] = useState(current);
  const [staged, setStaged] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setStaged(current);
  }

  function update(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(staged);
    mutate(next);
    const query = next.toString();
    if (query === staged) return;
    // Outside the transition on purpose: this has to land before the next
    // event handler reads it, which an update inside the transition would not.
    setStaged(query);
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  return { params, update, pending };
}
