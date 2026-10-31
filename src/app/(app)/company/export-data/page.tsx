import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { EXPORT_ITEMS } from "@/server/exports/quickbooks-style";
import { ExportForm } from "./export-form";

export const metadata = { title: "Export data" };

export default async function ExportDataPage() {
  const { company, role } = await requireCapability(CAPABILITIES.REPORTS);
  const hrAllowed = can(role, CAPABILITIES.HR) && company.enabledModules.includes("HR");

  const items = EXPORT_ITEMS.map((i) => ({
    key: i.key,
    label: i.label,
    kind: i.kind,
    disabledReason:
      i.key === "EMPLOYEES" && !hrAllowed ? "Needs the HR product and HR access on your role." : undefined,
  }));

  return (
    <>
      <PageHeader
        title="Export data"
        breadcrumb={[{ label: "Company", href: "/company" }, { label: "Export data" }]}
      />
      <Card className="p-5">
        <h2 className="text-[1rem] font-semibold text-ink-900">Which reports and lists do you want to export?</h2>
        <p className="mb-4 mt-1 text-[0.8125rem] text-muted-ink">Turn items on or off and set the date range to get just what you need.</p>
        <ExportForm items={items} />
      </Card>
    </>
  );
}
