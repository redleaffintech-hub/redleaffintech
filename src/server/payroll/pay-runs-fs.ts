import "server-only";

/**
 * Pay runs (§payroll) — Firestore implementation.
 *
 * Does NOT calculate CPP/EI/income tax — those are entered per line. This module
 * totals what was entered into a correct net pay and posts one balanced journal:
 *   Dr  Payroll Expense       gross + employer CPP + employer EI
 *     Cr  Payroll Liability     every withholding + the employer CPP/EI match
 *     Cr  Bank                  net pay
 */

import { toUtcDay } from "@/lib/dates";
import { bumpSequenceTx, runTransaction } from "@/server/db/companies";
import { listAccounts } from "@/server/db/accounts";
import { employees as employeeRepo } from "@/server/db/hr";
import { payRuns } from "@/server/db/payroll";
import type { PayRun, PayRunLineRow } from "@/server/db/types";
import {
  commitPosting,
  planPosting,
  reverseJournal,
} from "@/server/accounting/ledger-fs";
import { newId } from "@/server/db/firestore";

export class PayRunError extends Error {}

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

async function validate(companyId: string, input: PayRunInput) {
  if (input.lines.length === 0) throw new PayRunError("A pay run needs at least one employee.");
  const ids = new Set(input.lines.map((l) => l.employeeId));
  if (ids.size !== input.lines.length) {
    throw new PayRunError("An employee appears more than once in this pay run.");
  }

  const accounts = await listAccounts(companyId);
  const bank = accounts.find(
    (a) => a.id === input.bankAccountId && a.isActive && ["BANK", "CASH", "CREDIT_CARD"].includes(a.subtype),
  );
  if (!bank) throw new PayRunError("Choose a valid bank or credit card account to fund net pay from.");

  const emps = await Promise.all([...ids].map((id) => employeeRepo.get(companyId, id)));
  if (emps.some((e) => !e)) throw new PayRunError("One of these employees does not exist in this company.");

  for (const line of input.lines) {
    if (!Number.isInteger(line.grossPayCents) || line.grossPayCents < 0) {
      throw new PayRunError("Gross pay must be a non-negative amount.");
    }
    if (computeNetPayCents(line) < 0) {
      const e = emps.find((x) => x?.id === line.employeeId);
      throw new PayRunError(
        `${e?.legalFirstName ?? "This employee"}'s deductions total more than their gross pay.`,
      );
    }
  }
}

function toLineRows(companyId: string, lines: PayRunLineInput[]): PayRunLineRow[] {
  return lines.map((line) => ({
    id: newId(),
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
  }));
}

export async function createPayRun(input: PayRunInput): Promise<PayRun> {
  await validate(input.companyId, input);
  const payPeriodStart = toUtcDay(input.payPeriodStart);
  const payPeriodEnd = toUtcDay(input.payPeriodEnd);
  if (payPeriodEnd < payPeriodStart) {
    throw new PayRunError("The pay period end date cannot be before its start date.");
  }
  return runTransaction(async (tx) => {
    const number = await bumpSequenceTx(tx, input.companyId, "payRun");
    return payRuns.createTx(tx, {
      companyId: input.companyId,
      number,
      payPeriodStart,
      payPeriodEnd,
      payDate: toUtcDay(input.payDate),
      status: "DRAFT",
      bankAccountId: input.bankAccountId,
      memo: input.memo ?? null,
      journalEntryId: null,
      createdById: input.userId ?? null,
      postedById: null,
      postedAt: null,
      lines: toLineRows(input.companyId, input.lines),
    } as Partial<PayRun> & { companyId: string });
  });
}

export async function updatePayRun(payRunId: string, input: PayRunInput): Promise<PayRun> {
  await validate(input.companyId, input);
  const payPeriodStart = toUtcDay(input.payPeriodStart);
  const payPeriodEnd = toUtcDay(input.payPeriodEnd);
  if (payPeriodEnd < payPeriodStart) {
    throw new PayRunError("The pay period end date cannot be before its start date.");
  }
  return runTransaction(async (tx) => {
    const existing = await payRuns.getTx(tx, input.companyId, payRunId);
    if (!existing) throw new PayRunError("That pay run no longer exists.");
    if (existing.status !== "DRAFT") {
      throw new PayRunError(`Pay run ${existing.number} is ${existing.status.toLowerCase()} and cannot be edited.`);
    }
    payRuns.updateTx(tx, input.companyId, payRunId, {
      payPeriodStart,
      payPeriodEnd,
      payDate: toUtcDay(input.payDate),
      bankAccountId: input.bankAccountId,
      memo: input.memo ?? null,
      lines: toLineRows(input.companyId, input.lines),
    });
    return { ...existing, lines: toLineRows(input.companyId, input.lines) };
  });
}

export async function deletePayRun(payRunId: string, companyId: string): Promise<void> {
  const existing = await payRuns.get(companyId, payRunId);
  if (!existing) throw new PayRunError("That pay run no longer exists.");
  if (existing.status !== "DRAFT") {
    throw new PayRunError(
      `Pay run ${existing.number} is ${existing.status.toLowerCase()} and cannot be deleted. Void it instead.`,
    );
  }
  await payRuns.remove(companyId, payRunId);
}

export async function postPayRun(
  payRunId: string,
  companyId: string,
  userId?: string | null,
): Promise<PayRun> {
  const accounts = await listAccounts(companyId);
  const expenseAccount = accounts
    .filter((a) => a.isActive && a.type === "EXPENSE" && a.subtype === "PAYROLL_EXPENSE")
    .sort((a, b) => a.code.localeCompare(b.code))[0];
  const liabilityAccount = accounts
    .filter((a) => a.isActive && a.type === "LIABILITY" && a.subtype === "PAYROLL_LIABILITY")
    .sort((a, b) => a.code.localeCompare(b.code))[0];
  if (!expenseAccount) {
    throw new PayRunError(
      'No active "Payroll Expense" account found. Add one in Chart of Accounts (type Expense, subtype Payroll Expense) before posting.',
    );
  }
  if (!liabilityAccount) {
    throw new PayRunError(
      'No active "Payroll Liability" account found. Add one in Chart of Accounts (type Liability, subtype Payroll Liability) before posting.',
    );
  }

  return runTransaction(async (tx) => {
    const payRun = await payRuns.getTx(tx, companyId, payRunId);
    if (!payRun) throw new PayRunError("That pay run no longer exists.");
    if (payRun.journalEntryId) throw new PayRunError(`Pay run ${payRun.number} is already posted.`);
    if (payRun.status !== "DRAFT") {
      throw new PayRunError(`Pay run ${payRun.number} is ${payRun.status.toLowerCase()} and cannot be posted.`);
    }
    if (payRun.lines.length === 0) throw new PayRunError("This pay run has no employees on it.");

    let grossTotal = 0;
    let liabilityTotal = 0;
    let netPayTotal = 0;
    for (const line of payRun.lines) {
      const netPay =
        line.grossPayCents -
        line.cppCents -
        line.eiCents -
        line.federalTaxCents -
        line.provincialTaxCents -
        line.otherDeductionsCents;
      if (netPay < 0) throw new PayRunError("A line's deductions exceed its gross pay.");
      grossTotal += line.grossPayCents + line.employerCppCents + line.employerEiCents;
      liabilityTotal +=
        line.cppCents +
        line.eiCents +
        line.federalTaxCents +
        line.provincialTaxCents +
        line.otherDeductionsCents +
        line.employerCppCents +
        line.employerEiCents;
      netPayTotal += netPay;
    }
    if (grossTotal !== liabilityTotal + netPayTotal) {
      throw new PayRunError("Pay run totals do not balance. Check each line's amounts and try again.");
    }

    const plan = await planPosting(tx, {
      companyId,
      date: payRun.payDate,
      memo: payRun.memo ? `Pay run ${payRun.number} — ${payRun.memo}` : `Pay run ${payRun.number}`,
      sourceType: "PAY_RUN",
      sourceId: payRun.id,
      sourceNumber: payRun.number,
      createdById: userId,
      lines: [
        { accountId: expenseAccount.id, debitCents: grossTotal, description: `Pay run ${payRun.number}` },
        ...(liabilityTotal > 0
          ? [
              {
                accountId: liabilityAccount.id,
                creditCents: liabilityTotal,
                description: `Pay run ${payRun.number} — withholdings and employer contributions`,
              },
            ]
          : []),
        ...(netPayTotal > 0
          ? [
              {
                accountId: payRun.bankAccountId,
                creditCents: netPayTotal,
                description: `Pay run ${payRun.number} — net pay`,
              },
            ]
          : []),
      ],
    });
    const entry = commitPosting(tx, plan);

    payRuns.updateTx(tx, companyId, payRun.id, {
      status: "POSTED",
      journalEntryId: entry.id,
      postedById: userId ?? null,
      postedAt: new Date(),
    });
    return { ...payRun, status: "POSTED", journalEntryId: entry.id };
  });
}

export async function voidPayRun(
  payRunId: string,
  companyId: string,
  userId?: string | null,
): Promise<PayRun> {
  return runTransaction(async (tx) => {
    const payRun = await payRuns.getTx(tx, companyId, payRunId);
    if (!payRun) throw new PayRunError("That pay run no longer exists.");
    if (payRun.status !== "POSTED") throw new PayRunError(`Pay run ${payRun.number} is not posted.`);
    if (payRun.journalEntryId) {
      await reverseJournal(tx, payRun.journalEntryId, {
        companyId,
        memo: `Void pay run ${payRun.number}`,
        userId,
      });
    }
    payRuns.updateTx(tx, companyId, payRunId, { status: "VOID" });
    return { ...payRun, status: "VOID" };
  });
}
