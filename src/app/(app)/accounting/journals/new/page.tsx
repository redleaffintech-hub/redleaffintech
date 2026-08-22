import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { JournalForm } from "./journal-form";
import { journalFormOptions } from "../actions";

export const metadata = { title: "New journal entry" };

export default async function NewJournalPage() {
  const { role } = await requireCapability(CAPABILITIES.JOURNALS);
  const { accounts } = await journalFormOptions();

  return (
    <>
      <PageHeader
        title="New journal entry"
        breadcrumb={[
          { label: "Accounting" },
          { label: "Journal entries", href: "/accounting/journals" },
          { label: "New" },
        ]}
        description="Manual entries for accruals, reclassifications and adjustments. Debits must equal credits and the date must fall in an open period."
      />
      <JournalForm accounts={accounts} canPostAdjusting={role === "ACCOUNTANT"} />
    </>
  );
}
