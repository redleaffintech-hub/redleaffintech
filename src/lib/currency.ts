/**
 * ISO 4217 currencies.
 *
 * The list is deliberately NOT a hand-maintained table. `Intl.supportedValuesOf`
 * exposes the runtime's own CLDR-backed ISO 4217 set (~160 codes), and
 * `Intl.DisplayNames` gives the English name for each, so both stay current with
 * the Node/browser version instead of with a constant someone has to remember to
 * update when a currency is redenominated.
 *
 * `currencyOptions()` is called from server components and the result passed to
 * the client as props: one source of truth, and the browser never has to have
 * `Intl.supportedValuesOf` itself.
 *
 * This is the company's *display and bookkeeping* currency. Nothing here
 * converts between currencies — see the note on `baseCurrency` in
 * `src/app/(app)/company/actions.ts`.
 */

/** What a company gets when nothing has been chosen. Matches the DB default. */
export const DEFAULT_CURRENCY = "CAD";

/** A handful that Canadian books actually reach for, floated to the top. */
const PREFERRED = ["CAD", "USD", "EUR", "GBP"];

let supported: Set<string> | null = null;

function supportedCodes(): Set<string> {
  if (supported) return supported;
  // `supportedValuesOf` is ES2022. Every runtime this app targets has it, but a
  // missing implementation must not take the company page down — fall back to
  // the preferred set so the form still renders and validation still rejects
  // nonsense.
  const codes =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("currency")
      : PREFERRED;
  supported = new Set(codes);
  return supported;
}

/** Uppercase and trim, or null if it is not a real ISO 4217 code. */
export function normalizeCurrency(input: string | null | undefined): string | null {
  if (!input) return null;
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return supportedCodes().has(code) ? code : null;
}

export function isSupportedCurrency(input: string | null | undefined): boolean {
  return normalizeCurrency(input) !== null;
}

let displayNames: Intl.DisplayNames | null = null;

/** "CAD" -> "Canadian Dollar". Falls back to the code itself. */
export function currencyName(code: string): string {
  try {
    displayNames ??= new Intl.DisplayNames(["en-CA"], { type: "currency" });
    const name = displayNames.of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** "CAD — Canadian Dollar", the form's option label. */
export function currencyLabel(code: string): string {
  const name = currencyName(code);
  return name === code ? code : `${code} — ${name}`;
}

export interface CurrencyOption {
  code: string;
  name: string;
  label: string;
}

/**
 * Every ISO 4217 currency, with the ones Canadian books actually use first and
 * the rest alphabetical. `selected` is included even if the runtime does not
 * know it, so an existing value can never silently vanish from the dropdown and
 * be replaced by whatever happens to be first.
 */
export function currencyOptions(selected?: string | null): CurrencyOption[] {
  const codes = new Set(supportedCodes());
  if (selected && /^[A-Z]{3}$/.test(selected.toUpperCase())) codes.add(selected.toUpperCase());

  const preferred = PREFERRED.filter((code) => codes.has(code));
  const rest = [...codes].filter((code) => !preferred.includes(code)).sort();

  return [...preferred, ...rest].map((code) => ({
    code,
    name: currencyName(code),
    label: currencyLabel(code),
  }));
}
