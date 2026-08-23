import type { Tx } from "@/lib/db";

type Sequence = "invoice" | "estimate" | "bill" | "credit" | "payment" | "expense" | "employee" | "payrun";

const FIELDS: Record<Sequence, { prefix: keyof PrefixShape; next: keyof NextShape }> = {
  invoice: { prefix: "invoicePrefix", next: "nextInvoiceNumber" },
  estimate: { prefix: "estimatePrefix", next: "nextEstimateNumber" },
  bill: { prefix: "billPrefix", next: "nextBillNumber" },
  credit: { prefix: "creditPrefix", next: "nextCreditNumber" },
  payment: { prefix: "paymentPrefix", next: "nextPaymentNumber" },
  expense: { prefix: "expensePrefix", next: "nextExpenseNumber" },
  employee: { prefix: "employeePrefix", next: "nextEmployeeNumber" },
  payrun: { prefix: "payRunPrefix", next: "nextPayRunNumber" },
};

interface PrefixShape {
  invoicePrefix: string; estimatePrefix: string; billPrefix: string;
  creditPrefix: string; paymentPrefix: string; expensePrefix: string; employeePrefix: string;
  payRunPrefix: string;
}
interface NextShape {
  nextInvoiceNumber: number; nextEstimateNumber: number; nextBillNumber: number;
  nextCreditNumber: number; nextPaymentNumber: number; nextExpenseNumber: number; nextEmployeeNumber: number;
  nextPayRunNumber: number;
}

/**
 * Allocate the next document number by atomically incrementing the company
 * counter inside the caller's transaction, so two concurrent invoices can never
 * take the same number.
 */
export async function nextNumber(tx: Tx, companyId: string, sequence: Sequence): Promise<string> {
  const { prefix, next } = FIELDS[sequence];
  const company = (await tx.company.update({
    where: { id: companyId },
    data: { [next]: { increment: 1 } },
    select: { [prefix]: true, [next]: true },
  })) as unknown as PrefixShape & NextShape;

  return `${company[prefix]}${company[next] - 1}`;
}

/**
 * The number the next document *would* take, without consuming it.
 *
 * The editor shows this so the number is visible before saving. Nothing is
 * reserved: two people opening the form see the same number, and whoever saves
 * first gets it. `nextNumber` is what actually allocates, and it is what the
 * save path calls unless the user typed a different number over the top.
 */
export async function peekNumber(tx: Tx, companyId: string, sequence: Sequence): Promise<string> {
  const { prefix, next } = FIELDS[sequence];
  const company = (await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { [prefix]: true, [next]: true },
  })) as unknown as PrefixShape & NextShape;

  return `${company[prefix]}${company[next]}`;
}
