"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { createPurchaseReturnFromBill } from "@/server/documents/credit-notes";

/** Options for the "return goods to a vendor" flow (issue 4): the source
 * bill's lines plus how much of each is still returnable. */
export async function billReturnOptions(billId: string) {
  const { company } = await requireCapability(CAPABILITIES.BILLS);

  const bill = await db.bill.findFirst({
    where: { id: billId, companyId: company.id },
    include: {
      vendor: { select: { id: true, name: true } },
      lines: { orderBy: { lineNo: "asc" }, include: { item: true } },
    },
  });
  if (!bill) return { error: "Bill not found in this company." };
  if (!bill.journalEntryId) return { error: `Bill ${bill.number} has not been posted yet.` };

  const priorReturns = await db.creditNoteLine.groupBy({
    by: ["sourceBillLineId"],
    where: {
      sourceBillLineId: { in: bill.lines.map((l) => l.id) },
      creditNote: { companyId: company.id, status: { not: "VOID" } },
    },
    _sum: { quantityMilli: true },
  });
  const returnedByLine = new Map(priorReturns.map((r) => [r.sourceBillLineId, r._sum.quantityMilli ?? 0]));

  return {
    bill: { id: bill.id, number: bill.number, status: bill.status, vendor: bill.vendor },
    lines: bill.lines.map((line) => ({
      id: line.id,
      description: line.description,
      itemCode: line.item?.code ?? null,
      quantityMilli: line.quantityMilli,
      remainingMilli: line.quantityMilli - (returnedByLine.get(line.id) ?? 0),
      unitPriceCents: line.unitPriceCents,
      netCents: line.netCents,
    })),
  };
}

const returnLineSchema = z.object({ billLineId: z.string(), quantity: z.number().positive() });
const returnSchema = z.object({
  billId: z.string(),
  issueDate: z.string(),
  reason: z.string().optional(),
  returns: z.array(returnLineSchema).min(1),
});

/** Create a vendor credit note that returns specific quantities from a
 * posted bill (issue 4) — reduces stock at the ORIGINAL receipt cost and
 * posts any difference from the vendor's actual credit explicitly to COGS. */
export async function createPurchaseReturnAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BILLS);
  const parsed = returnSchema.safeParse(JSON.parse(payload));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the return and try again." };

  try {
    const creditNote = await createPurchaseReturnFromBill({
      companyId: company.id,
      billId: parsed.data.billId,
      issueDate: parsed.data.issueDate,
      reason: parsed.data.reason || "Return of goods",
      returns: parsed.data.returns.map((r) => ({
        billLineId: r.billLineId,
        quantityMilli: Math.round(r.quantity * 1000),
      })),
      userId: user.id,
    });

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "CREATE",
      entityType: "CreditNote",
      entityId: creditNote.id,
      summary: `Raised purchase return ${creditNote.number} from bill`,
    });

    revalidatePath("/purchases/returns");
    revalidatePath("/purchases/bills");
    revalidatePath("/inventory");
    revalidatePath("/sales/credit-notes");
    return { redirectTo: `/sales/credit-notes/${creditNote.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
