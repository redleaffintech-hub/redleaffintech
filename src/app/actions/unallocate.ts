"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability } from "@/server/auth/context";
import { unallocatePayment, unallocateWholePayment } from "@/server/documents/payments";

/** Take a cash allocation back off an AR invoice or AP bill; the payment stays as unapplied credit. */
export async function unallocatePaymentAction(allocationId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYMENTS);
  try {
    const result = await unallocatePayment(company.id, allocationId, user.id);
    revalidatePath("/sales/invoices", "layout");
    revalidatePath("/sales/customers", "layout");
    revalidatePath("/purchases/bills", "layout");
    revalidatePath("/purchases/vendors", "layout");
    revalidatePath("/sales/receipts", "layout");
    revalidatePath("/purchases/payments", "layout");
    return { ok: true as const, ...result };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Unapply everything applied from one payment/receipt; it returns to unapplied credit. */
export async function unallocateWholePaymentAction(paymentId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYMENTS);
  try {
    const result = await unallocateWholePayment(company.id, paymentId, user.id);
    revalidatePath("/sales/invoices", "layout");
    revalidatePath("/sales/customers", "layout");
    revalidatePath("/purchases/bills", "layout");
    revalidatePath("/purchases/vendors", "layout");
    revalidatePath("/sales/receipts", "layout");
    revalidatePath("/purchases/payments", "layout");
    return { ok: true as const, ...result };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
