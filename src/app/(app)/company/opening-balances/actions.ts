"use server";

import { revalidatePath } from "next/cache";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import {
  findExistingNames,
  importOpeningBalances,
  parseOpeningBalanceCsv,
  type ImportKind,
} from "@/server/documents/opening-balance-import";

const MAX_BYTES = 1_000_000;

export type ImportResult =
  | { error: string; rowErrors?: { line: number; message: string }[] }
  | {
      ok: true;
      created: { name: string; amountCents: number }[];
      failed: { line: number; name: string; message: string }[];
    };

/**
 * Validate the whole file, then import it. Validation covers every row before the
 * first write, so a bad file imports nothing.
 */
export async function importOpeningBalancesAction(formData: FormData): Promise<ImportResult> {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);

  const kind = formData.get("kind");
  if (kind !== "CUSTOMER" && kind !== "VENDOR") return { error: "Unknown import type." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to upload." };
  if (file.size > MAX_BYTES) return { error: "That file is over 1 MB — it does not look like a balance template." };
  if (!/\.csv$/i.test(file.name)) return { error: "Upload a .csv file (in Excel: Save As → CSV)." };

  const parsed = parseOpeningBalanceCsv(await file.text(), kind as ImportKind);
  if (parsed.errors.length > 0) {
    return { error: "Nothing was imported — fix these rows and upload again.", rowErrors: parsed.errors.slice(0, 100) };
  }
  if (parsed.rows.length === 0) return { error: "The file has a header but no rows." };

  const existing = await findExistingNames(company.id, kind as ImportKind, parsed.rows.map((r) => r.name));
  const label = kind === "CUSTOMER" ? "customer" : "vendor";
  const clashes = parsed.rows
    .filter((r) => existing.has(r.name.toLowerCase()))
    .map((r) => ({ line: r.line, message: `"${r.name}" already exists as a ${label}.` }));
  if (clashes.length > 0) {
    return { error: "Nothing was imported — these names already exist. Remove them or rename them.", rowErrors: clashes.slice(0, 100) };
  }

  const outcome = await importOpeningBalances({ companyId: company.id, userId: user.id, kind: kind as ImportKind, rows: parsed.rows });

  const totalCents = outcome.created.reduce((s, c) => s + c.amountCents, 0);
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "CREATE",
    entityType: kind === "CUSTOMER" ? "Customer" : "Vendor",
    summary: `Imported ${outcome.created.length} ${label}${outcome.created.length === 1 ? "" : "s"} with opening balances from ${file.name} (total ${(totalCents / 100).toFixed(2)})${outcome.failed.length ? `; ${outcome.failed.length} row(s) failed` : ""}`,
  });

  revalidatePath(kind === "CUSTOMER" ? "/sales/customers" : "/purchases/vendors");
  return { ok: true, created: outcome.created, failed: outcome.failed };
}
