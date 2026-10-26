import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { ImportPanel } from "../banking-tools";
import { bankingOptions } from "../actions";

export const metadata = { title: "Import bank statement" };

export default async function ImportBankStatementPage() {
  await requireCapability(CAPABILITIES.BANKING);
  const { bankAccounts } = await bankingOptions();

  return (
    <>
      <PageHeader
        title="Import bank statement"
        breadcrumb={[{ label: "Banking", href: "/banking" }, { label: "Import bank statement" }]}
        description="Bring in a CSV or OFX statement first, classify each transaction in the review queue, then reconcile against the statement balance."
        actions={<LinkButton href="/banking">Go to review queue</LinkButton>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        <ImportPanel bankAccounts={bankAccounts} />
        <Card>
          <CardHeader title="Import, classify, reconcile" />
          <ol className="mt-3 space-y-2.5 text-[0.8125rem] leading-6 text-muted-ink">
            <li>1. Choose the bank account and upload the statement. Duplicates are skipped automatically.</li>
            <li>2. Open the review queue and classify each transaction (category, matching invoice or bill, or transfer). Categorisation rules do this for you next time.</li>
            <li>3. Once everything is classified, reconcile the account against the statement closing balance.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
