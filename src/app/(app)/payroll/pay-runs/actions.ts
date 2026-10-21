"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import {
  PayRunError,
  createPayRunInTx,
  deletePayRunInTx,
  postPayRunInTx,
  previewLineAmounts,
  updatePayRunInTx,
  voidPayRun,
} from "@/server/payroll/pay-runs";

const lineSchema = z.object({
  employeeId: z.string().min(1),
  regularHours: z.number().min(0).max(1000).nullable().optional(),
  overtimeHours: z.number().min(0).max(1000).nullable().optional(),
  vacationHours: z.number().min(0).max(1000).nullable().optional(),
  sickHours: z.number().min(0).max(1000).nullable().optional(),
  statutoryHolidayHours: z.number().min(0).max(1000).nullable().optional(),
  unpaidLeaveHours: z.number().min(0).max(1000).nullable().optional(),
  unpaidLeaveCents: z.number().int().min(0).optional(),
  regularPayCents: z.number().int().min(0).optional(),
  overtimePayCents: z.number().int().min(0).nullable().optional(),
  vacationPayCents: z.number().int().min(0).optional(),
  sickPayCents: z.number().int().min(0).optional(),
  bonusCents: z.number().int().min(0).optional(),
  retroactivePayCents: z.number().int().min(0).optional(),
  statutoryHolidayPayCents: z.number().int().min(0).optional(),
  otRateMultiplierMicro: z.number().int().min(0).nullable().optional(),
  cppCents: z.number().int().min(0).nullable().optional(),
  cpp2Cents: z.number().int().min(0).nullable().optional(),
  eiCents: z.number().int().min(0).nullable().optional(),
  qpipCents: z.number().int().min(0).nullable().optional(),
  federalTaxCents: z.number().int().min(0).nullable().optional(),
  provincialTaxCents: z.number().int().min(0).nullable().optional(),
  otherDeductionsCents: z.number().int().min(0).optional(),
  otherDeductionsNote: z.string().trim().max(200).nullable().optional(),
  medicalInsuranceCents: z.number().int().min(0).nullable().optional(),
  employerCppCents: z.number().int().min(0).nullable().optional(),
  employerCpp2Cents: z.number().int().min(0).nullable().optional(),
  employerEiCents: z.number().int().min(0).nullable().optional(),
  employerQpipCents: z.number().int().min(0).nullable().optional(),
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
    const payRun = await db.$transaction((tx) =>
      createPayRunInTx(tx, { companyId: company.id, ...input, userId: user.id }),
    );

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
    const payRun = await db.$transaction((tx) => updatePayRunInTx(tx, id, { companyId: company.id, ...input }));

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
    const payRun = await db.$transaction((tx) => postPayRunInTx(tx, id, company.id, user.id));

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

const previewSchema = z.object({
  payDate: z.string().trim().min(1),
  line: lineSchema,
});

interface PreviewLineResult {
  error?: string;
  grossPayCents?: number;
  overtimePayCents?: number;
  cppCents?: number;
  cpp2Cents?: number;
  eiCents?: number;
  qpipCents?: number;
  federalTaxCents?: number;
  provincialTaxCents?: number;
  employerCppCents?: number;
  employerCpp2Cents?: number;
  employerEiCents?: number;
  employerQpipCents?: number;
  medicalInsuranceCents?: number;
  regularHours?: number | null;
  vacationHours?: number | null;
  sickHours?: number | null;
  statutoryHolidayHours?: number | null;
  netPayCents?: number;
}

/**
 * Backs the pay-run form's "Calculate" button: suggests CPP/CPP2/EI/QPIP/tax/OT
 * pay for one line from the statutory rate tables and this employee's
 * year-to-date figures, without saving anything. The bookkeeper can accept or
 * override every field the result fills in.
 */
export async function previewLineAction(payload: string): Promise<PreviewLineResult> {
  const { company } = await requireCapability(CAPABILITIES.PAYROLL);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read this line's details." };
  }
  const parsed = previewSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check this line's details." };

  const payDate = new Date(parsed.data.payDate);
  if (Number.isNaN(payDate.getTime())) return { error: "Set the pay date before calculating." };

  try {
    // Leave every deduction unset so resolveLines suggests all of them, even
    // if the form already has a value the bookkeeper typed in.
    const { cppCents, cpp2Cents, eiCents, qpipCents, federalTaxCents, provincialTaxCents, employerCppCents, employerCpp2Cents, employerEiCents, employerQpipCents, medicalInsuranceCents, ...line } = parsed.data.line;
    void cppCents; void cpp2Cents; void eiCents; void qpipCents; void federalTaxCents; void provincialTaxCents;
    void medicalInsuranceCents; void employerCppCents; void employerCpp2Cents; void employerEiCents; void employerQpipCents;

    const resolved = await previewLineAmounts(company.id, payDate, line);
    return {
      grossPayCents: resolved.grossPayCents,
      overtimePayCents: resolved.overtimePayCents,
      cppCents: resolved.cppCents,
      cpp2Cents: resolved.cpp2Cents,
      eiCents: resolved.eiCents,
      qpipCents: resolved.qpipCents,
      federalTaxCents: resolved.federalTaxCents,
      provincialTaxCents: resolved.provincialTaxCents,
      employerCppCents: resolved.employerCppCents,
      employerCpp2Cents: resolved.employerCpp2Cents,
      employerEiCents: resolved.employerEiCents,
      employerQpipCents: resolved.employerQpipCents,
      medicalInsuranceCents: resolved.medicalInsuranceCents,
      regularHours: resolved.regularHours,
      vacationHours: resolved.vacationHours,
      sickHours: resolved.sickHours,
      statutoryHolidayHours: resolved.statutoryHolidayHours,
      netPayCents: resolved.netPayCents,
    };
  } catch (caught) {
    if (caught instanceof PayRunError) return { error: caught.message };
    throw caught;
  }
}

/** Approved paid vacation/sick leave inside the pay period, as pay-line figures. */
export async function pullApprovedLeaveAction(start: string, end: string, payRunId: string | null = null) {
  const { company } = await requireCapability(CAPABILITIES.PAYROLL);
  const from = new Date(`${start}T00:00:00.000Z`);
  const to = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: "Set the pay period start and end first." };
  if (to < from) return { error: "The pay period end is before its start." };
  const { approvedLeaveForPeriod } = await import("@/server/payroll/leave-pay");
  return { rows: await approvedLeaveForPeriod(company.id, from, to, { excludePayRunId: payRunId }) };
}

export async function deletePayRunAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYROLL);
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing pay run id." };

  try {
    const payRun = await db.$transaction((tx) => deletePayRunInTx(tx, id, company.id));

    await recordAudit({
      companyId: company.id, userId: user.id, action: "DELETE", entityType: "PayRun",
      entityId: id, summary: `Draft pay run ${payRun.number} deleted`,
    });

    revalidatePath("/payroll/pay-runs");
    return { ok: true as const };
  } catch (error) {
    if (error instanceof PayRunError) return { error: error.message };
    throw error;
  }
}
