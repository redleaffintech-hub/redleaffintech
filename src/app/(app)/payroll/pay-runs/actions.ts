"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import {
  PayRunError,
  createPayRun,
  deletePayRun,
  postPayRun,
  updatePayRun,
  voidPayRun,
} from "@/server/payroll/pay-runs-fs";
import { payRuns } from "@/server/db/payroll";

const lineSchema = z.object({
  employeeId: z.string().min(1),
  regularHours: z.number().min(0).max(1000).nullable().optional(),
  overtimeHours: z.number().min(0).max(1000).nullable().optional(),
  grossPayCents: z.number().int().min(0),
  cppCents: z.number().int().min(0).optional(),
  eiCents: z.number().int().min(0).optional(),
  federalTaxCents: z.number().int().min(0).optional(),
  provincialTaxCents: z.number().int().min(0).optional(),
  otherDeductionsCents: z.number().int().min(0).optional(),
  otherDeductionsNote: z.string().trim().max(200).nullable().optional(),
  employerCppCents: z.number().int().min(0).optional(),
  employerEiCents: z.number().int().min(0).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const payRunSchema = z.object({
  payPeriodStart: z.string().trim().min(1, "Pay period start is required."),
  payPeriodEnd: z.string().trim().min(1, "Pay period end is required."),
  payDate: z.string().trim().min(1, "Pay date is required."),
  bankAccountId: z.string().min(1, "Choose the account net pay is paid from."),
  memo: z.string().trim().max(500).optional(),
  lines: z.array(lineSchema).min(1, "Add at least one employee to this pay run."),
});

/** Flat, all-optional shape (matching this app's other action results) so a
 * caller can read `.error` or `.payRunId` off the union without narrowing. */
interface PayRunActionResult {
  ok?: boolean;
  error?: string;
  payRunId?: string;
}

function parsePayload(payload: string): { error?: string; input?: z.infer<typeof payRunSchema> } {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the pay run details." };
  }
  const parsed = payRunSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the pay run details." };
  return { input: parsed.data };
}

export async function createPayRunAction(payload: string): Promise<PayRunActionResult> {
  const { company, user } = await requireCapability(CAPABILITIES.PAYROLL);
  const { error, input } = parsePayload(payload);
  if (error || !input) return { error: error ?? "Check the pay run details." };

  try {
    const payRun = await createPayRun({ companyId: company.id, ...input, userId: user.id });

    await recordAudit({
      companyId: company.id, userId: user.id, action: "CREATE", entityType: "PayRun",
      entityId: payRun.id, summary: `Pay run ${payRun.number} created (${payRun.lines.length} employees)`,
    });

    revalidatePath("/payroll/pay-runs");
    return { ok: true, payRunId: payRun.id };
  } catch (caught) {
    if (caught instanceof PayRunError) return { error: caught.message };
    throw caught;
  }
}

export async function updatePayRunAction(id: string, payload: string): Promise<PayRunActionResult> {
  const { company, user } = await requireCapability(CAPABILITIES.PAYROLL);
  const { error, input } = parsePayload(payload);
  if (error || !input) return { error: error ?? "Check the pay run details." };

  try {
    const payRun = await updatePayRun(id, { companyId: company.id, ...input });

    await recordAudit({
      companyId: company.id, userId: user.id, action: "UPDATE", entityType: "PayRun",
      entityId: payRun.id, summary: `Pay run ${payRun.number} updated`,
    });

    revalidatePath("/payroll/pay-runs");
    revalidatePath(`/payroll/pay-runs/${id}`);
    return { ok: true, payRunId: payRun.id };
  } catch (caught) {
    if (caught instanceof PayRunError) return { error: caught.message };
    throw caught;
  }
}

export async function postPayRunAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYROLL);
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing pay run id." };

  try {
    const payRun = await postPayRun(id, company.id, user.id);

    await recordAudit({
      companyId: company.id, userId: user.id, action: "POST", entityType: "PayRun",
      entityId: payRun.id, summary: `Pay run ${payRun.number} posted`,
    });

    revalidatePath("/payroll/pay-runs");
    revalidatePath(`/payroll/pay-runs/${id}`);
    return { ok: true as const };
  } catch (error) {
    if (error instanceof PayRunError) return { error: error.message };
    throw error;
  }
}

export async function voidPayRunAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYROLL);
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing pay run id." };

  try {
    const payRun = await voidPayRun(id, company.id, user.id);

    await recordAudit({
      companyId: company.id, userId: user.id, action: "VOID", entityType: "PayRun",
      entityId: payRun.id, summary: `Pay run ${payRun.number} voided`,
    });

    revalidatePath("/payroll/pay-runs");
    revalidatePath(`/payroll/pay-runs/${id}`);
    return { ok: true as const };
  } catch (error) {
    if (error instanceof PayRunError) return { error: error.message };
    throw error;
  }
}

export async function deletePayRunAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYROLL);
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing pay run id." };

  try {
    const existing = await payRuns.get(company.id, id);
    await deletePayRun(id, company.id);

    await recordAudit({
      companyId: company.id, userId: user.id, action: "DELETE", entityType: "PayRun",
      entityId: id, summary: `Draft pay run ${existing?.number ?? id} deleted`,
    });

    revalidatePath("/payroll/pay-runs");
    return { ok: true as const };
  } catch (error) {
    if (error instanceof PayRunError) return { error: error.message };
    throw error;
  }
}
