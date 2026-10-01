"use server";

import { revalidatePath } from "next/cache";
import { recordPlatformAudit } from "@/server/admin/audit";
import { optionalStr, runAdminAction } from "@/server/admin/run-action";
import { importBracketRows, parseBracketCsv } from "@/server/payroll/bracket-import";

const MAX_ERRORS_SHOWN = 12;

export async function importBracketsAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const file = formData.get("file");
    const pasted = optionalStr(formData, "csv");
    const reason = optionalStr(formData, "reason") ?? null;

    let text: string | null = null;
    if (file instanceof File && file.size > 0) {
      text = await file.text();
    } else if (pasted) {
      text = pasted;
    }
    if (!text) return { error: "Choose a CSV file or paste CSV text." };
    if (!reason) return { error: "A reason is required to publish an import." };

    const { rows, errors } = parseBracketCsv(text);
    if (errors.length > 0) {
      const shown = errors.slice(0, MAX_ERRORS_SHOWN).join(" ");
      const more = errors.length > MAX_ERRORS_SHOWN ? ` (+${errors.length - MAX_ERRORS_SHOWN} more)` : "";
      return { error: `${errors.length} row error${errors.length === 1 ? "" : "s"} — nothing was imported: ${shown}${more}` };
    }
    if (rows.length === 0) return { error: "No data rows found." };

    const { outcome, error } = await importBracketRows(rows, reason, actor.id);
    if (error || !outcome) return { error: error ?? "Import failed." };

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: "CREATE",
      entityType: "PayrollTaxBracket",
      summary: `Bulk import — ${outcome.insertedCount} bracket rows across ${outcome.setCount} jurisdiction/year set${outcome.setCount === 1 ? "" : "s"} (${outcome.jurisdictions.join(", ")})`,
      reason,
      after: outcome,
    });

    revalidatePath("/admin/payroll-rates/tax-brackets");
    return { ok: true, message: `Imported ${outcome.insertedCount} bracket rows across ${outcome.setCount} jurisdiction/year set${outcome.setCount === 1 ? "" : "s"}.` };
  });
}
