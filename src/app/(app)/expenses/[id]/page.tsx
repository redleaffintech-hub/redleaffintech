import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Card, CardHeader, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { listAttachments } from "@/server/documents/attachments";
import { ExpenseAttachments } from "./expense-attachments";

export const metadata = { title: "Expense" };

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.EXPENSES);
  const { id } = await params;
  const currency = company.baseCurrency;

  const expense = await db.expense.findFirst({
    where: { id, companyId: company.id },
    include: {
      vendor: { select: { id: true, name: true } },
      lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { lineNo: "asc" } },
    },
  });
  if (!expense) notFound();

  const [paidFrom, attachments] = await Promise.all([
    db.account.findUnique({ where: { id: expense.paymentAccountId }, select: { code: true, name: true } }),
    listAttachments(company.id, "EXPENSE", expense.id),
  ]);

  return (
    <>
      <PageHeader
        title={`Expense ${expense.number}`}
        breadcrumb={[{ label: "Accounting", href: "/accounting/chart-of-accounts" }, { label: "Expenses", href: "/expenses" }, { label: expense.number }]}
        description={`${formatDate(expense.date)} · ${expense.vendor?.name ?? expense.payeeName ?? "No payee"}`}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-3">
            <StatusBadge status={expense.status} />
            {expense.journalEntryId && (
              <Link href={`/accounting/journals/${expense.journalEntryId}`} className="text-[0.8125rem] text-brand-700 hover:underline">View journal entry</Link>
            )}
            <span className="ml-auto text-[0.8125rem] text-muted-ink">Paid from {paidFrom ? `${paidFrom.code} ${paidFrom.name}` : "—"}</span>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Description</Th>
                <Th width="7rem" align="right">Tax</Th>
                <Th width="8rem" align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {expense.lines.map((line) => (
                <Tr key={line.id}>
                  <Td>{line.account.code} {line.account.name}</Td>
                  <Td className="text-muted-ink">{line.description}</Td>
                  <Td align="right"><Money cents={line.taxCents} currency={currency} blankZero /></Td>
                  <Td align="right"><Money cents={line.totalCents} currency={currency} bold /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card className="p-5">
          <CardHeader title="Attachments" subtitle="Receipts and supporting documents" />
          <div className="mt-3">
            <ExpenseAttachments
              expenseId={expense.id}
              attachments={attachments.map((a) => ({ id: a.id, fileName: a.fileName, sizeBytes: a.sizeBytes, createdAt: a.createdAt.toISOString() }))}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
