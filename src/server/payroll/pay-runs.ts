/**
 * Pay runs — the payroll module's only document type.
 *
 * CPP, CPP2, EI, QPIP (Quebec only) and federal/provincial tax are auto-suggested per line from
 * the effective-dated PayrollStatutoryRate/PayrollTaxBracket reference tables
 * (see src/server/payroll/tax-engine.ts) and the employee's year-to-date
 * figures (src/server/payroll/ytd.ts) whenever the caller doesn't supply an
 * explicit value — but every suggested amount is still a plain field the
 * bookkeeper can override. What this module owns is: resolving each line's
 * earnings into a gross figure, suggesting deductions, totalling everything
 * into a correct net pay, and posting a balanced journal entry when the run
 * is finalized.
 *
 * Posting rule, one journal entry per pay run, amounts summed across every line:
 *   Dr  Salaries & Wages (or equivalent PAYROLL_EXPENSE account)
 *         gross pay + employer CPP + employer CPP2 + employer EI + employer QPIP, for every employee
 *   Cr  Payroll Liabilities (or equivalent PAYROLL_LIABILITY account)
 *         every withheld amount (CPP, CPP2, EI, QPIP, federal tax, provincial tax, other)
 *         plus the employer CPP/CPP2/EI/QPIP match — all of it owed to Revenu Québec/CRA until remitted
 *   Cr  Bank account
 *         net pay, paid out now
 *
 * Debits and credits balance because netPayCents is always gross minus the
 * employee-side deductions: Dr(gross + employerCpp + employerCpp2 + employerEi + employerQpip)
 * equals Cr(employee deductions + employerCpp + employerCpp2 + employerEi + employerQpip) + Cr(netPay).
 */

import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { toUtcDay } from "@/lib/dates";
import { postJournal, reverseJournal } from "@/server/accounting/ledger";
import { nextNumber } from "@/server/documents/numbering";
import type { PayFrequency } from "@/lib/hr-enums";
import { computeCppAndEi, currentPayrollStatutoryRate, currentTaxBrackets, periodIncomeTaxCents, suggestOvertimePayCents } from "@/server/payroll/tax-engine";
import { payrollYtd } from "@/server/payroll/ytd";

export interface PayRunLineInput {
  employeeId: string;
  regularHours?: number | null;
  overtimeHours?: number | null;

  regularPayCents?: number;
  /** Omit to have this suggested from overtimeHours * the employee's (or otRateMultiplierMicro's) overtime rate. */
  overtimePayCents?: number | null;
  vacationPayCents?: number;
  sickPayCents?: number;
  bonusCents?: number;
  retroactivePayCents?: number;
  statutoryHolidayPayCents?: number;
  /** Overrides the employee's defaultOvertimeRateMultiplierMicro for this line's overtime suggestion. */
  otRateMultiplierMicro?: number | null;

  /** Omit any of these six to have it auto-suggested from the statutory rate/bracket tables and this employee's year-to-date figures. */
  cppCents?: number | null;
  cpp2Cents?: number | null;
  eiCents?: number | null;
  /** Quebec employees only — auto-suggests to 0 for every other province. */
  qpipCents?: number | null;
  federalTaxCents?: number | null;
  provincialTaxCents?: number | null;
  otherDeductionsCents?: number;
  otherDeductionsNote?: string | null;
  employerCppCents?: number | null;
  employerCpp2Cents?: number | null;
  employerEiCents?: number | null;
  employerQpipCents?: number | null;
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

const EARNINGS_FIELDS = [
  "regularPayCents",
  "overtimePayCents",
  "vacationPayCents",
  "sickPayCents",
  "bonusCents",
  "retroactivePayCents",
  "statutoryHolidayPayCents",
] as const;

interface ResolvedLine {
  employeeId: string;
  regularHours: number | null;
  overtimeHours: number | null;
  regularPayCents: number;
  overtimePayCents: number;
  vacationPayCents: number;
  sickPayCents: number;
  bonusCents: number;
  retroactivePayCents: number;
  statutoryHolidayPayCents: number;
  grossPayCents: number;
  otRateMultiplierMicro: number | null;
  cppCents: number;
  cpp2Cents: number;
  eiCents: number;
  qpipCents: number;
  federalTaxCents: number;
  provincialTaxCents: number;
  otherDeductionsCents: number;
  otherDeductionsNote: string | null;
  employerCppCents: number;
  employerCpp2Cents: number;
  employerEiCents: number;
  employerQpipCents: number;
  netPayCents: number;
  notes: string | null;
}

function sumEarnings(line: Pick<ResolvedLine, (typeof EARNINGS_FIELDS)[number]>): number {
  return EARNINGS_FIELDS.reduce((total, field) => total + line[field], 0);
}

/** grossPayCents minus every deduction. Recomputed here, never trusted from the client. */
export function computeNetPayCents(
  line: Pick<
    ResolvedLine,
    (typeof EARNINGS_FIELDS)[number] | "cppCents" | "cpp2Cents" | "eiCents" | "qpipCents" | "federalTaxCents" | "provincialTaxCents" | "otherDeductionsCents"
  >,
): number {
  return (
    sumEarnings(line) -
    line.cppCents -
    line.cpp2Cents -
    line.eiCents -
    line.qpipCents -
    line.federalTaxCents -
    line.provincialTaxCents -
    line.otherDeductionsCents
  );
}

async function validateBankAccount(tx: Tx, companyId: string, bankAccountId: string) {
  const account = await tx.account.findFirst({
    where: { companyId, id: bankAccountId, isActive: true, subtype: { in: ["BANK", "CASH", "CREDIT_CARD"] } },
  });
  if (!account) throw new PayRunError("Choose a valid bank or credit card account to fund net pay from.");
  return account;
}

/**
 * Validates every line's shape, then resolves each one: earnings sum into
 * grossPayCents, and any deduction the caller omitted is suggested from the
 * statutory rate/bracket tables and the employee's year-to-date figures as of
 * this pay run's date. A caller-supplied value is always kept as-is.
 */
async function resolveLines(tx: Tx, companyId: string, payDate: Date, lines: PayRunLineInput[]): Promise<ResolvedLine[]> {
  if (lines.length === 0) throw new PayRunError("A pay run needs at least one employee.");

  const ids = new Set(lines.map((l) => l.employeeId));
  if (ids.size !== lines.length) throw new PayRunError("An employee appears more than once in this pay run.");

  const employees = await tx.employee.findMany({ where: { companyId, id: { in: [...ids] } } });
  if (employees.length !== ids.size) throw new PayRunError("One of these employees does not exist in this company.");
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const nonNegativeFields: [string, number | null | undefined][] = [];
  for (const line of lines) {
    nonNegativeFields.push(
      [EARNINGS_FIELDS[0], line.regularPayCents], [EARNINGS_FIELDS[1], line.overtimePayCents],
      [EARNINGS_FIELDS[2], line.vacationPayCents], [EARNINGS_FIELDS[3], line.sickPayCents],
      [EARNINGS_FIELDS[4], line.bonusCents], [EARNINGS_FIELDS[5], line.retroactivePayCents],
      [EARNINGS_FIELDS[6], line.statutoryHolidayPayCents],
    );
    nonNegativeFields.push(
      ["CPP", line.cppCents], ["CPP2", line.cpp2Cents], ["EI", line.eiCents], ["QPIP", line.qpipCents],
      ["federal tax", line.federalTaxCents], ["provincial tax", line.provincialTaxCents],
      ["other deductions", line.otherDeductionsCents], ["employer CPP", line.employerCppCents],
      ["employer CPP2", line.employerCpp2Cents], ["employer EI", line.employerEiCents], ["employer QPIP", line.employerQpipCents],
    );
  }
  for (const [label, value] of nonNegativeFields) {
    if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0)) {
      throw new PayRunError(`${label} must be a non-negative amount.`);
    }
  }

  const rates = await currentPayrollStatutoryRate(payDate);
  const year = payDate.getUTCFullYear();

  const resolved: ResolvedLine[] = [];
  for (const line of lines) {
    const employee = employeeById.get(line.employeeId)!;

    const overtimeHours = line.overtimeHours ?? null;
    const overtimePayCents =
      line.overtimePayCents ??
      (overtimeHours
        ? suggestOvertimePayCents(employee, overtimeHours, line.otRateMultiplierMicro ?? undefined)
        : 0);

    const earnings = {
      regularPayCents: line.regularPayCents ?? 0,
      overtimePayCents,
      vacationPayCents: line.vacationPayCents ?? 0,
      sickPayCents: line.sickPayCents ?? 0,
      bonusCents: line.bonusCents ?? 0,
      retroactivePayCents: line.retroactivePayCents ?? 0,
      statutoryHolidayPayCents: line.statutoryHolidayPayCents ?? 0,
    };
    const grossPayCents = sumEarnings(earnings);

    let cppCents = line.cppCents ?? undefined;
    let cpp2Cents = line.cpp2Cents ?? undefined;
    let eiCents = line.eiCents ?? undefined;
    let qpipCents = line.qpipCents ?? undefined;
    let employerCppCents = line.employerCppCents ?? undefined;
    let employerCpp2Cents = line.employerCpp2Cents ?? undefined;
    let employerEiCents = line.employerEiCents ?? undefined;
    let employerQpipCents = line.employerQpipCents ?? undefined;

    if (rates && (cppCents === undefined || cpp2Cents === undefined || eiCents === undefined || qpipCents === undefined)) {
      const ytd = await payrollYtd(companyId, employee.id, year, payDate);
      const computed = computeCppAndEi({
        grossPayCents,
        payFrequency: employee.payFrequency as PayFrequency,
        ytdPensionableEarningsCents: ytd.pensionableEarningsCents,
        ytdCppCents: ytd.cppCents,
        ytdCpp2Cents: ytd.cpp2Cents,
        ytdInsurableEarningsCents: ytd.insurableEarningsCents,
        ytdEiCents: ytd.eiCents,
        ytdQpipCents: ytd.qpipCents,
        rates,
        province: employee.provinceOfEmployment,
      });
      cppCents ??= computed.cppCents;
      cpp2Cents ??= computed.cpp2Cents;
      eiCents ??= computed.eiCents;
      qpipCents ??= computed.qpipCents;
      employerCppCents ??= computed.employerCppCents;
      employerCpp2Cents ??= computed.employerCpp2Cents;
      employerEiCents ??= computed.employerEiCents;
      employerQpipCents ??= computed.employerQpipCents;
    }

    let federalTaxCents = line.federalTaxCents ?? undefined;
    let provincialTaxCents = line.provincialTaxCents ?? undefined;
    if (federalTaxCents === undefined) {
      const brackets = await currentTaxBrackets("FEDERAL", payDate);
      federalTaxCents = periodIncomeTaxCents(grossPayCents, employee.payFrequency as PayFrequency, brackets);
    }
    if (provincialTaxCents === undefined) {
      const brackets = await currentTaxBrackets(employee.provinceOfEmployment, payDate);
      provincialTaxCents = periodIncomeTaxCents(grossPayCents, employee.payFrequency as PayFrequency, brackets);
    }

    const resolvedLine: ResolvedLine = {
      employeeId: line.employeeId,
      regularHours: line.regularHours ?? null,
      overtimeHours,
      ...earnings,
      grossPayCents,
      otRateMultiplierMicro: line.otRateMultiplierMicro ?? null,
      cppCents: cppCents ?? 0,
      cpp2Cents: cpp2Cents ?? 0,
      eiCents: eiCents ?? 0,
      qpipCents: qpipCents ?? 0,
      federalTaxCents: federalTaxCents ?? 0,
      provincialTaxCents: provincialTaxCents ?? 0,
      otherDeductionsCents: line.otherDeductionsCents ?? 0,
      otherDeductionsNote: line.otherDeductionsNote ?? null,
      employerCppCents: employerCppCents ?? 0,
      employerCpp2Cents: employerCpp2Cents ?? 0,
      employerEiCents: employerEiCents ?? 0,
      employerQpipCents: employerQpipCents ?? 0,
      netPayCents: 0,
      notes: line.notes ?? null,
    };
    resolvedLine.netPayCents = computeNetPayCents(resolvedLine);

    if (resolvedLine.netPayCents < 0) {
      throw new PayRunError(`${employee.legalFirstName}'s deductions total more than their gross pay.`);
    }
    resolved.push(resolvedLine);
  }

  return resolved;
}

/**
 * Resolves a single line's suggested amounts without saving anything — what
 * the pay-run form's "Calculate" button calls to preview CPP/CPP2/EI/tax/OT
 * pay before the bookkeeper decides whether to accept or override them.
 */
export async function previewLineAmounts(companyId: string, payDate: Date, line: PayRunLineInput): Promise<ResolvedLine> {
  const [resolved] = await resolveLines(db, companyId, payDate, [line]);
  return resolved;
}

function lineCreateData(companyId: string, line: ResolvedLine) {
  return {
    companyId,
    employeeId: line.employeeId,
    regularHours: line.regularHours,
    overtimeHours: line.overtimeHours,
    regularPayCents: line.regularPayCents,
    overtimePayCents: line.overtimePayCents,
    vacationPayCents: line.vacationPayCents,
    sickPayCents: line.sickPayCents,
    bonusCents: line.bonusCents,
    retroactivePayCents: line.retroactivePayCents,
    statutoryHolidayPayCents: line.statutoryHolidayPayCents,
    grossPayCents: line.grossPayCents,
    otRateMultiplierMicro: line.otRateMultiplierMicro,
    cppCents: line.cppCents,
    cpp2Cents: line.cpp2Cents,
    eiCents: line.eiCents,
    qpipCents: line.qpipCents,
    federalTaxCents: line.federalTaxCents,
    provincialTaxCents: line.provincialTaxCents,
    otherDeductionsCents: line.otherDeductionsCents,
    otherDeductionsNote: line.otherDeductionsNote,
    employerCppCents: line.employerCppCents,
    employerCpp2Cents: line.employerCpp2Cents,
    employerEiCents: line.employerEiCents,
    employerQpipCents: line.employerQpipCents,
    netPayCents: line.netPayCents,
    notes: line.notes,
  };
}

export async function createPayRunInTx(tx: Tx, input: PayRunInput) {
  await validateBankAccount(tx, input.companyId, input.bankAccountId);

  const payPeriodStart = toUtcDay(input.payPeriodStart);
  const payPeriodEnd = toUtcDay(input.payPeriodEnd);
  const payDate = toUtcDay(input.payDate);
  if (payPeriodEnd < payPeriodStart) throw new PayRunError("The pay period end date cannot be before its start date.");

  const resolvedLines = await resolveLines(tx, input.companyId, payDate, input.lines);
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
      lines: { create: resolvedLines.map((line) => lineCreateData(input.companyId, line)) },
    },
    include: { lines: true },
  });
}

export async function updatePayRunInTx(tx: Tx, payRunId: string, input: PayRunInput) {
  const existing = await tx.payRun.findFirst({ where: { id: payRunId, companyId: input.companyId } });
  if (!existing) throw new PayRunError("That pay run no longer exists.");
  if (existing.status !== "DRAFT") throw new PayRunError(`Pay run ${existing.number} is ${existing.status.toLowerCase()} and cannot be edited.`);

  await validateBankAccount(tx, input.companyId, input.bankAccountId);

  const payPeriodStart = toUtcDay(input.payPeriodStart);
  const payPeriodEnd = toUtcDay(input.payPeriodEnd);
  const payDate = toUtcDay(input.payDate);
  if (payPeriodEnd < payPeriodStart) throw new PayRunError("The pay period end date cannot be before its start date.");

  const resolvedLines = await resolveLines(tx, input.companyId, payDate, input.lines);

  await tx.payRunLine.deleteMany({ where: { payRunId } });

  return tx.payRun.update({
    where: { id: payRunId },
    data: {
      payPeriodStart,
      payPeriodEnd,
      payDate,
      bankAccountId: input.bankAccountId,
      memo: input.memo ?? null,
      lines: { create: resolvedLines.map((line) => lineCreateData(input.companyId, line)) },
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
  let employerCpp2Total = 0;
  let employerEiTotal = 0;
  let employerQpipTotal = 0;
  let liabilityTotal = 0;
  let netPayTotal = 0;

  for (const line of payRun.lines) {
    // Recomputed from the stored fields, never trusted from whatever
    // netPayCents happened to be written earlier — the one number this posting
    // step is not allowed to get wrong.
    const netPay = computeNetPayCents(line);
    if (netPay < 0) {
      throw new PayRunError(`${line.employee.legalFirstName} ${line.employee.legalLastName}'s deductions exceed their gross pay.`);
    }
    grossTotal += line.grossPayCents;
    employerCppTotal += line.employerCppCents;
    employerCpp2Total += line.employerCpp2Cents;
    employerEiTotal += line.employerEiCents;
    employerQpipTotal += line.employerQpipCents;
    liabilityTotal +=
      line.cppCents + line.cpp2Cents + line.eiCents + line.qpipCents + line.federalTaxCents + line.provincialTaxCents +
      line.otherDeductionsCents + line.employerCppCents + line.employerCpp2Cents + line.employerEiCents + line.employerQpipCents;
    netPayTotal += netPay;
  }

  const debitTotal = grossTotal + employerCppTotal + employerCpp2Total + employerEiTotal + employerQpipTotal;
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
