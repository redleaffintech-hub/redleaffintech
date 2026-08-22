"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Icon } from "./icons";

interface SearchHit {
  type: string;
  label: string;
  sublabel: string;
  href: string;
  amount?: string;
}

const QUICK_ACTIONS: SearchHit[] = [
  { type: "Create", label: "New invoice", sublabel: "Sales", href: "/sales/invoices/new" },
  { type: "Create", label: "New bill", sublabel: "Purchases", href: "/purchases/bills/new" },
  { type: "Create", label: "New expense", sublabel: "Expenses", href: "/expenses/new" },
  { type: "Create", label: "New journal entry", sublabel: "Accounting", href: "/accounting/journals/new" },
  { type: "Go to", label: "Bank review queue", sublabel: "Banking", href: "/banking" },
  { type: "Go to", label: "Trial balance", sublabel: "Accounting", href: "/accounting/trial-balance" },
  { type: "Go to", label: "Profit & loss", sublabel: "Reports", href: "/reports/profit-and-loss" },
  { type: "Go to", label: "Balance sheet", sublabel: "Reports", href: "/reports/balance-sheet" },
  { type: "Go to", label: "Tax Centre", sublabel: "Tax", href: "/tax" },
  { type: "Go to", label: "Chart of accounts", sublabel: "Accounting", href: "/accounting/chart-of-accounts" },
];

/**
 * ⌘K search over customers, vendors, invoices, bills and accounts, plus the
 * common create actions — the fastest route to anything in the product.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setRemote([]);
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setRemote([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (response.ok) setRemote(await response.json());
      } catch {
        // Aborted or offline — the local action list still works.
      } finally {
        setLoading(false);
      }
    }, 160);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const actions = needle
      ? QUICK_ACTIONS.filter((a) => `${a.label} ${a.sublabel}`.toLowerCase().includes(needle))
      : QUICK_ACTIONS;
    return [...remote, ...actions].slice(0, 24);
  }, [query, remote]);

  useEffect(() => setCursor(0), [results.length]);

  if (!open) return null;

  function go(hit: SearchHit) {
    onClose();
    router.push(hit.href);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/40 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="rise w-full max-w-xl overflow-hidden rounded-xl border border-paper-300 bg-white shadow-[0_24px_64px_-16px_rgba(10,16,32,0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-paper-200 px-4">
          <Icon name="search" className="h-4 w-4 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (event.key === "Enter" && results[cursor]) go(results[cursor]);
            }}
            placeholder="Search or jump to…"
            className="h-12 flex-1 bg-transparent text-[0.9375rem] text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          {loading && <span className="text-[0.75rem] text-muted-ink">Searching…</span>}
          <kbd className="rounded border border-paper-300 px-1.5 py-0.5 font-sans text-[0.6875rem] text-muted-ink">esc</kbd>
        </div>

        <ul className="thin-scroll max-h-[22rem] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <li className="px-4 py-8 text-center text-[0.8125rem] text-muted-ink">No matches for “{query}”.</li>
          )}
          {results.map((hit, index) => (
            <li key={`${hit.href}-${hit.label}-${index}`}>
              <button
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => go(hit)}
                className={clsx(
                  "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                  index === cursor ? "bg-brand-soft" : "hover:bg-paper-100",
                )}
              >
                <span className="w-[4.75rem] shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink">
                  {hit.type}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-medium text-ink-900">{hit.label}</span>
                  <span className="block truncate text-[0.75rem] text-muted-ink">{hit.sublabel}</span>
                </span>
                {hit.amount && <span className="tnum shrink-0 text-[0.8125rem] text-ink-700">{hit.amount}</span>}
                <Icon name="chevron" className="h-3.5 w-3.5 shrink-0 text-ink-300" />
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-4 border-t border-paper-200 bg-paper-100 px-4 py-2 text-[0.6875rem] text-muted-ink">
          <span>↑↓ to navigate</span>
          <span>↵ to open</span>
          <span className="ml-auto">Searches this company only</span>
        </div>
      </div>
    </div>
  );
}
