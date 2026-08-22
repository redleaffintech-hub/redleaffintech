import Link from "next/link";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { detectTransfers } from "@/server/banking/matching";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge, Card, CardHeader, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { ReviewQueue } from "./review-queue";
import { ImportPanel, TransferButton } from "./banking-tools";
import { bankingOptions } from "./actions";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";

export const metadata = { title: "Banking" };

export default async function BankingPage() {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  const { accounts, taxCodes, bankAccounts } = await bankingOptions();

  const [queue, recent, transfers, defaults] = await Promise.all([
    db.bankTransaction.findMany({
      where: { companyId: company.id, status: "UNMATCHED" },
      include: { bankAccount: { select: { name: true, type: true } } },
      orderBy: { date: "desc" },
      take: 60,
    }),
    db.bankTransaction.findMany({
      where: { companyId: company.id, status: { in: ["CATEGORIZED", "MATCHED", "TRANSFER"] } },
      include: { bankAccount: { select: { name: true } }, categoryAccount: { select: { code: true, name: true } } },
      orderBy: { date: "desc" },
      take: 12,
    }),
    detectTransfers(company.id),
    db.account.findMany({
      where: { companyId: company.id, systemKey: { in: [SYSTEM_ACCOUNTS.UNCATEGORIZED_EXPENSE] } },
      select: { id: true },
    }),
  ]);

  const defaultExpenseAccountId =
    defaults[0]?.id ?? accounts.find((a) => a.type === "EXPENSE")?.id ?? accounts[0]?.id ?? "";
  const defaultTaxCodeId = taxCodes[0]?.id ?? "";

  const inflowCents = queue.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
  const outflowCents = queue.filter((t) => t.amountCents < 0).reduce((s, t) => s + t.amountCents, 0);

  return (
    <>
      <PageHeader
        title="Bank review queue"
        breadcrumb={[{ label: "Banking" }, { label: "Review queue" }]}
        description={
          queue.length > 0
            ? `${queue.length} transactions waiting — ${formatMoney(inflowCents)} in, ${formatMoney(Math.abs(outflowCents))} out. Nothing here has touched the ledger yet.`
            : "Everything imported has been categorised, matched or excluded."
        }
        actions={
          <>
            <LinkButton href="/banking/rules">Rules</LinkButton>
            <LinkButton href="/banking/reconcile">Reconcile</LinkButton>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-4">
          {transfers.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--color-info)]/25 bg-info-soft px-4 py-3">
              <span className="flex-1 text-[0.8125rem] text-info">
                <span className="font-medium">
                  {transfers.length} likely transfer{transfers.length === 1 ? "" : "s"} detected
                </span>{" "}
                — matching amounts moving between two of your own accounts within three days. Recording these as
                income and expense is the most common feed error.
              </span>
              <TransferButton count={transfers.length} />
            </div>
          )}

          <ReviewQueue
            transactions={queue.map((t) => ({
              id: t.id,
              date: formatDate(t.date),
              description: t.description,
              amountCents: t.amountCents,
              bankAccountName: t.bankAccount.name,
              bankAccountType: t.bankAccount.type,
            }))}
            accounts={accounts}
            taxCodes={taxCodes}
            defaultExpenseAccountId={defaultExpenseAccountId}
            defaultTaxCodeId={defaultTaxCodeId}
          />

          <Card className="p-5">
            <CardHeader title="Recently confirmed" subtitle="Already posted to the ledger" />
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th width="6.5rem">Date</Th>
                  <Th>Description</Th>
                  <Th width="12rem">Posted to</Th>
                  <Th width="8rem" align="right">Amount</Th>
                  <Th width="7rem">Status</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((transaction) => (
                  <Tr key={transaction.id}>
                    <Td className="text-muted-ink">{formatDate(transaction.date)}</Td>
                    <Td>
                      {transaction.journalEntryId ? (
                        <Link href={`/accounting/journals/${transaction.journalEntryId}`} className="hover:text-brand-700 hover:underline">
                          {transaction.description}
                        </Link>
                      ) : (
                        transaction.description
                      )}
                      <span className="block text-[0.75rem] text-muted-ink">{transaction.bankAccount.name}</span>
                    </Td>
                    <Td className="text-muted-ink">
                      {transaction.categoryAccount
                        ? `${transaction.categoryAccount.code} · ${transaction.categoryAccount.name}`
                        : transaction.matchedType?.replace(/_/g, " ").toLowerCase() ?? "—"}
                    </Td>
                    <Td align="right"><Money cents={transaction.amountCents} /></Td>
                    <Td><StatusBadge status={transaction.status} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <ImportPanel bankAccounts={bankAccounts} />

          <Card>
            <CardHeader title="How the queue works" />
            <ol className="mt-3 space-y-2.5 text-[0.8125rem] leading-6 text-muted-ink">
              {[
                "Transactions arrive from a feed or a CSV/OFX import. Duplicates are filtered on the bank's own transaction id, or on date + amount + description.",
                "The engine looks for an open invoice or bill of the same amount near the same date, and for any categorisation rule you have set up.",
                "Confirming posts a balanced journal entry immediately — there is no intermediate 'accepted but not posted' state to reconcile later.",
                "Anything you confirm can be undone: the reversal is a new entry, and the line goes back into the queue.",
              ].map((step, index) => (
                <li key={index} className="flex gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-paper-200 text-[0.6875rem] font-semibold text-ink-700">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader title="Accounts" action={<LinkButton href="/banking/accounts">Manage</LinkButton>} />
            <ul className="mt-3 space-y-2">
              {bankAccounts.map((account) => (
                <li key={account.id} className="flex items-center gap-2 text-[0.8125rem]">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-paper-200 text-[0.6875rem] font-semibold text-ink-700">
                    {account.type === "CREDIT_CARD" ? "CC" : "BA"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-900">{account.name}</span>
                    <span className="text-[0.75rem] text-muted-ink">{account.accountNumberMasked}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
