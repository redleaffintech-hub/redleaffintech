import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminPageHeader } from "@/components/admin/ui";
import { BracketForm } from "../bracket-form";

export const metadata = { title: "New payroll tax bracket" };

export default async function NewBracketPage() {
  const actor = await requirePlatformAdmin();

  return (
    <>
      <AdminPageHeader
        title="Add a payroll tax bracket"
        description="Adds one bracket row. Add every bracket for a jurisdiction/year with the same effective date to form a complete bracket set — src/server/payroll/tax-engine.ts reads all rows sharing that jurisdiction and effective date together."
        breadcrumb={[{ label: "Payroll rates" }, { label: "Tax brackets", href: "/admin/payroll-rates/tax-brackets" }, { label: "New" }]}
      />
      <BracketForm csrfToken={actor.csrfToken} />
    </>
  );
}
