import { PageHeader } from "@/components/ui";
import { openingBalancesFormOptions } from "./actions";
import { OpeningBalancesForm } from "./opening-balances-form";

export const metadata = { title: "Import opening balances" };

export default async function OpeningBalancesPage() {
  const { accounts } = await openingBalancesFormOptions();

  return (
    <>
      <PageHeader
        title="Import opening balances"
        breadcrumb={[
          { label: "Accounting" },
          { label: "Chart of accounts", href: "/accounting/chart-of-accounts" },
          { label: "Opening balances" },
        ]}
        description="Bring in balances from a prior system, by CSV or entered by hand. Any difference between total debits and credits posts to Opening Balance Equity, so a partial migration never needs to balance perfectly on its own."
      />

      <OpeningBalancesForm accounts={accounts} />
    </>
  );
}
