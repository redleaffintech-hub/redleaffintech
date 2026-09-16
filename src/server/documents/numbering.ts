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

/**
 * Allocate the next customer display code (issue 9, 15 Sep 2026 review) —
 * same atomic-increment shape as {@link nextNumber}, but zero-padded (e.g.
 * `CUST-00042`), since a customer-facing code reads oddly without it while a
 * document number does not. Call from every customer-creation path,
 * including inline creation from a document form, inside that create's own
 * transaction.
 */
export async function nextCustomerCode(tx: Tx, companyId: string): Promise<string> {
  const company = await tx.company.update({
    where: { id: companyId },
    data: { nextCustomerCodeNumber: { increment: 1 } },
    select: { customerCodePrefix: true, customerCodePadding: true, nextCustomerCodeNumber: true },
  });
  const n = company.nextCustomerCodeNumber - 1;
  return `${company.customerCodePrefix}${String(n).padStart(company.customerCodePadding, "0")}`;
}

/** The customer code the next customer *would* get, without consuming it — for a settings-page live example. */
export function previewCustomerCode(prefix: string, padding: number, next: number): string {
  return `${prefix}${String(next).padStart(padding, "0")}`;
}
