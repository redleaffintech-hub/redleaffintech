import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminPageHeader } from "@/components/admin/ui";
import { BracketImportForm } from "./import-form";

export const metadata = { title: "Import payroll tax brackets" };

export default async function ImportBracketsPage() {
  const actor = await requirePlatformAdmin();

  return (
    <>
      <AdminPageHeader
        title="Import payroll tax brackets"
        description="Load a whole jurisdiction/year bracket set — or several years across several jurisdictions — in one batch. Every row is validated and checked for overlaps the same way the single-bracket form is; the whole file is rejected if any row fails, so a partial backfill can never leave a jurisdiction half-loaded."
        breadcrumb={[{ label: "Payroll rates" }, { label: "Tax brackets", href: "/admin/payroll-rates/tax-brackets" }, { label: "Import" }]}
      />
      <BracketImportForm csrfToken={actor.csrfToken} />
    </>
  );
}
