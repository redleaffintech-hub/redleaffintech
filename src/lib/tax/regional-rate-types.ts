/**
 * Shared shape for the regional tax rate feature — no "server-only", so the
 * admin form (a client component) can import it directly instead of pulling
 * in the whole server-side regional-rates service.
 */

export const FEDERAL_TYPES = ["GST", "HST"] as const;
export type FederalType = (typeof FEDERAL_TYPES)[number];

export const PROVINCIAL_TYPES = ["PST", "QST", "RST", "NONE"] as const;
export type ProvincialType = (typeof PROVINCIAL_TYPES)[number];
