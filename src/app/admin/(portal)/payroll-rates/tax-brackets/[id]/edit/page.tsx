import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import type { AdminParams } from "@/lib/admin-constants";
import { BracketForm, type BracketFormValues } from "../../bracket-form";

export const metadata = { title: "Edit payroll tax bracket" };

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function EditBracketPage({ params }: { params: AdminParams<"id"> }) {
  const actor = await requirePlatformAdmin();
  const { id } = await params;

  const bracket = await db.payrollTaxBracket.findUnique({ where: { id } });
  if (!bracket) notFound();

  if (bracket.effectiveFrom <= new Date()) {
    return (
      <>
        <AdminPageHeader
          title="Edit payroll tax bracket"
          breadcrumb={[{ label: "Payroll rates" }, { label: "Tax brackets", href: "/admin/payroll-rates/tax-brackets" }, { label: "Edit" }]}
        />
        <AdminCard>
          <p className="text-[0.8125rem] leading-6 text-ink-700">
            This bracket took effect on {isoDate(bracket.effectiveFrom)} and can no longer be edited. Use <strong>End</strong> from
            the list to close its range, and add a new bracket for what replaces it.
          </p>
        </AdminCard>
      </>
    );
  }

  const initial: BracketFormValues = {
    id: bracket.id,
    jurisdiction: bracket.jurisdiction,
    min: String(bracket.minCents / 100),
    max: bracket.maxCents !== null ? String(bracket.maxCents / 100) : "",
    rate: String(bracket.rateMicro / 10_000),
    basicPersonalAmount: String(bracket.basicPersonalAmountCents / 100),
    effectiveFrom: isoDate(bracket.effectiveFrom),
    effectiveTo: bracket.effectiveTo ? isoDate(bracket.effectiveTo) : "",
  };

  return (
    <>
      <AdminPageHeader
        title="Edit payroll tax bracket"
        description="This bracket has not taken effect yet, so it can still be corrected directly rather than superseded."
        breadcrumb={[{ label: "Payroll rates" }, { label: "Tax brackets", href: "/admin/payroll-rates/tax-brackets" }, { label: "Edit" }]}
      />
      <BracketForm csrfToken={actor.csrfToken} initial={initial} />
    </>
  );
}
