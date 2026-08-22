/**
 * Which sales tax codes apply to a sale, given where it is delivered.
 *
 * Canadian GST/HST follows the *place of supply* — the destination — not where
 * the seller happens to sit. An Ontario company delivering to Nova Scotia
 * charges Nova Scotia's rate, so the ship-to address is what selects the code,
 * and the federal codes (GST, zero-rated, exempt, out of scope) stay available
 * everywhere because they are jurisdiction-agnostic.
 *
 * This module only ever *orders and filters codes the company already has*. It
 * never invents a rate: every rate still comes from an effective-dated TaxCode,
 * which is what keeps §7 true.
 */

/** Codes with this jurisdiction apply regardless of province. */
export const FEDERAL_JURISDICTION = "CA";

interface JurisdictionalCode {
  jurisdiction: string;
}

/**
 * The codes to offer for a place of supply: that province's own codes first,
 * then the federal ones. A province of `null` (unknown destination, or a
 * purchase document, which has no place of supply) offers everything.
 */
export function codesForPlaceOfSupply<T extends JurisdictionalCode>(
  codes: T[],
  province: string | null | undefined,
): T[] {
  if (!province) return codes;
  return [
    ...codes.filter((code) => code.jurisdiction === province),
    ...codes.filter((code) => code.jurisdiction === FEDERAL_JURISDICTION),
  ];
}

interface RatedCode extends JurisdictionalCode {
  components: unknown[];
}

/**
 * The code a line should default to for a place of supply.
 *
 * A standard-rated code for the destination province wins; failing that the
 * federal standard-rated code (GST alone, which is the correct answer in AB, NT,
 * NU and YT); failing that whatever is offered, so the dropdown is never empty.
 */
export function defaultCodeForPlaceOfSupply<T extends RatedCode>(
  codes: T[],
  province: string | null | undefined,
): T | null {
  const offered = codesForPlaceOfSupply(codes, province);
  const rated = offered.filter((code) => code.components.length > 0);

  if (province) {
    const provincial = rated.find((code) => code.jurisdiction === province);
    if (provincial) return provincial;
  }
  return rated.find((code) => code.jurisdiction === FEDERAL_JURISDICTION) ?? rated[0] ?? offered[0] ?? null;
}

/**
 * The code a line should hold for a place of supply, given what it holds now.
 *
 * Three cases, in order:
 *  - the current code is not offered where this is delivered — take the default;
 *  - it is a zero-rated, exempt or out-of-scope code — keep it. Those are
 *    deliberate treatments of the supply itself, they carry no rate, and they mean
 *    the same thing in every province;
 *  - it is standard-rated — it must be the *destination's* standard code. Federal
 *    GST alone is only correct where no provincial tax applies, so a line left on
 *    GST moves onto the provincial code as soon as one exists.
 */
export function resolveLineCode<T extends RatedCode & { id: string }>(
  codes: T[],
  province: string | null | undefined,
  currentId: string,
): string {
  const current = codesForPlaceOfSupply(codes, province).find((code) => code.id === currentId);
  const fallback = defaultCodeForPlaceOfSupply(codes, province);

  if (!current) return fallback?.id ?? "";
  if (current.components.length === 0) return current.id;
  return fallback?.id ?? current.id;
}

/**
 * True when the destination levies a provincial tax but this company holds no
 * code for it — the case where an invoice would otherwise be raised at the
 * federal rate alone and quietly under-charge.
 *
 * `provincesWithTax` is the set of provinces a published template exists for,
 * passed in rather than imported so this stays usable on the client.
 */
export function isMissingProvincialCode(
  codes: JurisdictionalCode[],
  province: string | null | undefined,
  provincesWithTax: readonly string[],
): boolean {
  if (!province || !provincesWithTax.includes(province)) return false;
  return !codes.some((code) => code.jurisdiction === province);
}
