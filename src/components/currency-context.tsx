"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { currencySymbol, formatCompact, formatMoney, type MoneyFormatOptions } from "@/lib/money";

/**
 * The active company's base currency, for client components.
 *
 * Server components take `company.baseCurrency` from `requireCompany()` and
 * pass `currency:` to `formatMoney` directly. Client components are often
 * several levels below the page that knows the company, so the value is
 * provided once by the (app) layout and read with `useMoney()` rather than
 * threaded through every intermediate prop.
 *
 * The default is CAD, which is also the database default — a client component
 * rendered outside the provider (a preview in the marketing site, say) still
 * formats sensibly rather than throwing.
 */
const CurrencyContext = createContext<string>(DEFAULT_CURRENCY);

export function CurrencyProvider({
  currency,
  children,
}: {
  currency: string;
  children: React.ReactNode;
}) {
  return <CurrencyContext value={currency}>{children}</CurrencyContext>;
}

export function useCurrency(): string {
  return useContext(CurrencyContext);
}

export interface BoundMoney {
  currency: string;
  symbol: string;
  /** Same options as formatMoney, minus `currency` — that is bound already. */
  format: (cents: number, opts?: Omit<MoneyFormatOptions, "currency">) => string;
  compact: (cents: number) => string;
}

/** Money formatters bound to the active company's currency. */
export function useMoney(): BoundMoney {
  const currency = useCurrency();
  return useMemo(
    () => ({
      currency,
      symbol: currencySymbol(currency),
      format: (cents, opts) => formatMoney(cents, { ...opts, currency }),
      compact: (cents) => formatCompact(cents, { currency }),
    }),
    [currency],
  );
}
