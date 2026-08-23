/**
 * Pay runs — the payroll module's only document type.
 *
 * This deliberately does not calculate CPP, EI, or federal/provincial income
 * tax. Those are entered per employee line by the bookkeeper (from CRA's PDOC
 * tool, a payroll service, or their accountant) — see the scoping note in
 * `prisma/schema.prisma` on `PayRunLine`. What this module owns is: totalling
 * what was entered into a correct net pay, and posting a balanced journal
 * entry when the run is finalized.
 *
 * Posting rule, one journal entry per pay run, amounts summed across every line:
 *   Dr  Salaries & Wages (or equivalent PAYROLL_EXPENSE account)
 *         gross pay + employer CPP + employer EI, for every employee
 *   Cr  Payroll Liabilities (or equivalent PAYROLL_LIABILITY account)
 *         every withheld amount (CPP, EI, federal tax, provincial tax, other)
 *         plus the employer CPP/EI match — all of it owed to CRA until remitted
 *   Cr  Bank account
 *         net pay, paid out now
 *
 * Debits and credits balance because netPayCents is always gross minus the
 * employee-side deductions: Dr(gross + employerCpp + employerEi) equals
 * Cr(employee deductions + employerCpp + employerEi) + Cr(netPay).
 */

import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { toUtcDay } from "@/lib/dates";
import { postJournal, reverseJournal } from "@/server/accounting/ledger";
import { nextNumber } from "@/server/documents/numbering";

export interface PayRunLineInput {
  employeeId: string;
  regularHours?: number | null;
  overtimeHours?: number | null;
  grossPayCents: number;
  cppCents?: number;
  eiCents?: number;
  federalTaxCents?: number;
  provincialTaxCents?: number;
  otherDeductionsCents?: number;
  otherDeductionsNote?: string | null;
  employerCppCents?: number;
  employerEiCents?: number;
  notes?: string | null;
}

export interface PayRunInput {
  companyId: string;
  payPeriodStart: Date | string;
  payPeriodEnd: Date | string;
  payDate: Date | string;
  bankAccountId: string;
  memo?: string | null;
  lines: PayRunLineInput[];
  userId?: string | null;
}

export class PayRunError extends Error {}

/** grossPayCents minus every deduction. Never trusted from the client — always recomputed here. */
export function computeNetPayCents(line: PayRunLineInput): number {
  return (
    line.grossPayCents -
    (line.cppCents ?? 0) -
    (line.eiCents ?? 0) -
    (line.federalTaxCents ?? 0) -
    (line.provincialTaxCents ?? 0) -
    (line.otherDeductionsCents ?? 0)
  );
}

async function validateBankAccount(tx: Tx, companyId: string, bankAccountId: string) {
  const account = await tx.account.findFirst({
    where: { companyId, id: bankAccountId, isActive: true, subtype: { in: ["BANK", "CREDIT_CARD"] } },
  });
  if (!account) throw new PayRunError("Choose a valid bank or credit card account to fund net pay from.");
  return account;
}

async function validateLines(tx: Tx, companyId: string, lines: PayRunLineInput[]) {
  if (lines.length === 0) throw new PayRunError("A pay run needs at least one employee.");

  const ids = new Set(lines.map((l) => l.employeeId));
  if (ids.size !== lines.length) throw new PayRunError("An employee appears more than once in this pay run.");

  const employees = await tx.employee.findMany({ where: { companyId, id: { in: [...ids] } } });
  if (employees.length !== ids.size) throw new PayRunError("One of these employees does not exist in this company.");

  for (const line of lines) {
    if (!Number.isInteger(line.grossPayCents) || line.grossPayCents < 0) {
      throw new PayRunError("Gross pay must be a non-negative amount.");
    }
    for (const [label, value] of [
      ["CPP", line.cppCents], ["EI", line.eiCents], ["federal tax", line.federalTaxCents],
      ["provincial tax", line.provincialTaxCents], ["other deductions", line.otherDeductionsCents],
      ["employer CPP", line.employerCppCents], ["employer EI", line.employerEiCents],
    ] as const) {
      if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0)) {
        throw new PayRunError(`${label} must be a non-negative amount.`);
      }
    }
    if (computeNetPayCents(line) < 0) {
      const employee = employees.find((e) => e.id === line.employeeId);
      throw new PayRunError(
        `${employee?.legalFirstName ?? "This employee"}'s deductions total more than their gross pay.`,
      );
    }
  }
}

export async function createPayRunInTx(tx: Tx, input: PayRunInput) {
  await validateBankAccount(tx, input.companyId, input.bankAccountId);
  await validateLines(tx, input.companyId, input.lines);

  const payPeriodStart = toUtcDay(input.payPeriodStart);
  const payPeriodEnd = toUtcDay(input.payPeriodEnd);
  const payDate = toUtcDay(input.payDate);
  if (payPeriodEnd < payPeriodStart) throw new PayRunError("The pay period end date cannot be before its start date.");

  const number = await nextNumber(tx, input.companyId, "payrun");

  return tx.payRun.create({
    data: {
      companyId: input.companyId,
      number,
      payPeriodStart,
      payPeriodEnd,
      payDate,
      bankAccountId: input.bankAccountId,
      memo: input.memo ?? null,
      createdById: input.userId ?? null,
      lines: {
        create: input.lines.map((line) => ({
          companyId: input.companyId,
          employeeId: line.employeeId,
          regularHours: line.regularHours ?? null,
          overtimeHours: line.overtimeHours ?? null,
          grossPayCents: line.grossPayCents,
          cppCents: line.cppCents ?? 0,
          eiCents: line.eiCents ?? 0,
          federalTaxCents: line.federalTaxCents ?? 0,
          provincialTaxCents: line.provincialTaxCents ?? 0,
          otherDeductionsCents: line.otherDeductionsCents ?? 0,
          otherDeductionsNote: line.otherDeductionsNote ?? null,
          employerCppCents: line.employerCppCents ?? 0,
          employerEiCents: line.employerEiCents ?? 0,
          netPayCents: computeNetPayCents(line),
          notes: line.notes ?? null,
        })),
      },
    },
    include: { lines: true },
  });
}

export async function updatePayRunInTx(tx: Tx, payRunId: string, input: PayRunInput) {
  const existing = await tx.payRun.findFirst({ where: { id: payRunId, companyId: input.companyId } });
  if (!existing) throw new PayRunError("That pay run no longer exists.");
  if (existing.status !== "DRAFT") throw new PayRunError(`Pay run ${existing.number} is ${existing.status.toLowerCase()} and cannot be edited.`);

  await validateBankAccount(tx, input.companyId, input.bankAccountId);
  await validateLines(tx, input.companyId, input.lines);

  const payPeriodStart = toUtcDay(input.payPeriodStart);
  const payPeriodEnd = toUtcDay(input.payPeriodEnd);
  const payDate = toUtcDay(input.payDate);
  if (payPeriodEnd < payPeriodStart) throw new PayRunError("The pay period end date cannot be before its start date.");

  await tx.payRunLine.deleteMany({ where: { payRunId } });

  return tx.payRun.update({
    where: { id: payRunId },
    data: {
      payPeriodStart,
      payPeriodEnd,
      payDate,
      bankAccountId: input.bankAccountId,
      memo: input.memo ?? null,
      lines: {
        create: input.lines.map((line) => ({
          companyId: input.companyId,
          employeeId: line.employeeId,
          regularHours: line.regularHours ?? null,
          overtimeHours: line.overtimeHours ?? null,
          grossPayCents: line.grossPayCents,
          cppCents: line.cppCents ?? 0,
          eiCents: line.eiCents ?? 0,
          federalTaxCents: line.federalTaxCents ?? 0,
          provincialTaxCents: line.provincialTaxCents ?? 0,
          otherDeductionsCents: line.otherDeductionsCents ?? 0,
          otherDeductionsNote: line.otherDeductionsNote ?? null,
          employerCppCents: line.employerCppCents ?? 0,
          employerEiCents: line.employerEiCents ?? 0,
          netPayCents: computeNetPayCents(line),
          notes: line.notes ?? null,
        })),
      },
    },
    include: { lines: true },
  });
}

export async function deletePayRunInTx(tx: Tx, payRunId: string, companyId: string) {
  const existing = await tx.payRun.findFirst({ where: { id: payRunId, companyId } });
  if (!existing) throw new PayRunError("That pay run no longer exists.");
  if (existing.status !== "DRAFT") throw new PayRunError(`Pay run ${existing.number} is ${existing.status.toLowerCase()} and cannot be deleted. Void it instead.`);
  await tx.payRun.delete({ where: { id: payRunId } });
  return existing;
}

/** Find the company's payroll expense/liability accounts by subtype — see the PayRun schema note on why this isn't a per-run picker. */
async function resolvePayrollAccounts(tx: Tx, companyId: string) {
  const [expenseAccount, liabilityAccount] = await Promise.all([
    tx.account.findFirst({
      where: { companyId, isActive: true, type: "EXPENSE", subtype: "PAYROLL_EXPENSE" },
      orderBy: { code: "asc" },
    }),
    tx.account.findFirst({
      where: { companyId, isActive: true, type: "LIABILITY", subtype: "PAYROLL_LIABILITY" },
      orderBy: { code: "asc" },
    }),
  ]);
  if (!expenseAccount) {
    throw new PayRunError('No active "Payroll Expense" account found. Add one in Chart of Accounts (type Expense, subtype Payroll Expense) before posting.');
  }
  if (!liabilityAccount) {
    throw new PayRunError('No active "Payroll Liability" account found. Add one in Chart of Accounts (type Liability, subtype Payroll Liability) before posting.');
  }
  return { expenseAccount, liabilityAccount };
}

export async function postPayRunInTx(tx: Tx, payRunId: string, companyId: string, userId?: string | null) {
  const payRun = await tx.payRun.findFirst({
    where: { id: payRunId, companyId },
    include: { lines: { include: { employee: { select: { legalFirstName: true, legalLastName: true } } } } },
  });
  if (!payRun) throw new PayRunError("That pay run no longer exists.");
  if (payRun.journalEntryId) throw new PayRunError(`Pay run ${payRun.number} is already posted.`);
  if (payRun.status !== "DRAFT") throw new PayRunError(`Pay run ${payRun.number} is ${payRun.status.toLowerCase()} and cannot be posted.`);
  if (payRun.lines.length === 0) throw new PayRunError("This pay run has no employees on it.");

  await validateBankAccount(tx, companyId, payRun.bankAccountId);
  const { expenseAccount, liabilityAccount } = await resolvePayrollAccounts(tx, companyId);

  let grossTotal = 0;
  let employerCppTotal = 0;
  let employerEiTotal = 0;
  let liabilityTotal = 0;
  let netPayTotal = 0;

  for (const line of payRun.lines) {
    // Recomputed from the stored deduction fields, never trusted from whatever
    // netPayCents happened to be written earlier — the one number this posting
    // step is not allowed to get wrong.
    const netPay = computeNetPayCents(line);
    if (netPay < 0) {
      throw new PayRunError(`${line.employee.legalFirstName} ${line.employee.legalLastName}'s deductions exceed their gross pay.`);
    }
    grossTotal += line.grossPayCents;
    employerCppTotal += line.employerCppCents;
    employerEiTotal += line.employerEiCents;
    liabilityTotal +=
      line.cppCents + line.eiCents + line.federalTaxCents + line.provincialTaxCents +
      line.otherDeductionsCents + line.employerCppCents + line.employerEiCents;
    netPayTotal += netPay;
  }

  const debitTotal = grossTotal + employerCppTotal + employerEiTotal;
  if (debitTotal !== liabilityTotal + netPayTotal) {
    // Should be arithmetically impossible given the per-line invariant above,
    // but this is what stands between a silent rounding bug and an unbalanced
    // journal entry ever reaching postJournal.
    throw new PayRunError("Pay run totals do not balance. Check each line's amounts and try again.");
  }

  const lines = [
    { accountId: expenseAccount.id, debitCents: debitTotal, description: `Pay run ${payRun.number}` },
    ...(liabilityTotal > 0
      ? [{ accountId: liabilityAccount.id, creditCents: liabilityTotal, description: `Pay run ${payRun.number} — withholdings and employer contributions` }]
      : []),
    ...(netPayTotal > 0
      ? [{ accountId: payRun.bankAccountId, creditCents: netPayTotal, description: `Pay run ${payRun.number} — net pay` }]
      : []),
  ];

  const entry = await postJournal(tx, {
    companyId,
    date: payRun.payDate,
    memo: payRun.memo ? `Pay run ${payRun.number} — ${payRun.memo}` : `Pay run ${payRun.number}`,
    sourceType: "PAY_RUN",
    sourceId: payRun.id,
    sourceNumber: payRun.number,
    createdById: userId,
    lines,
  });

  return tx.payRun.update({
    where: { id: payRun.id },
    data: { status: "POSTED", journalEntryId: entry.id, postedById: userId ?? null, postedAt: new Date() },
    include: { lines: true },
  });
}

export async function voidPayRun(payRunId: string, companyId: string, userId?: string | null) {
  return db.$transaction(async (tx) => {
    const payRun = await tx.payRun.findFirst({ where: { id: payRunId, companyId } });
    if (!payRun) throw new PayRunError("That pay run no longer exists.");
    if (payRun.status !== "POSTED") throw new PayRunError(`Pay run ${payRun.number} is not posted.`);
    if (payRun.journalEntryId) {
      await reverseJournal(tx, payRun.journalEntryId, { companyId, memo: `Void pay run ${payRun.number}`, userId });
    }
    return tx.payRun.update({ where: { id: payRunId }, data: { status: "VOID" } });
  });
}
