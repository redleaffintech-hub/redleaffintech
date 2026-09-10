import { notFound } from "next/navigation";
import { regionalTaxRates } from "@/server/db/platform";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import type { AdminParams } from "@/lib/admin-constants";
import { RateForm, type RateFormValues } from "../../rate-form";

export const metadata = { title: "Edit regional tax rate" };

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function EditRegionalTaxRatePage({ params }: { params: AdminParams<"id"> }) {
  const actor = await requirePlatformAdmin();
  const { id } = await params;

  const rate = await regionalTaxRates.get(id);
  if (!rate) notFound();

  // A rate that has come into force since this link was shown is not
  // editable — the same rule the server action enforces, surfaced here rather
  // than letting the operator fill out a form only to have it rejected.
  if (rate.effectiveFrom <= new Date()) {
    return (
      <>
        <AdminPageHeader
          title="Edit regional tax rate"
          breadcrumb={[{ label: "Regional tax rates", href: "/admin/regional-tax-rates" }, { label: "Edit" }]}
        />
        <AdminCard>
          <p className="text-[0.8125rem] leading-6 text-ink-700">
            This rate took effect on {isoDate(rate.effectiveFrom)} and can no longer be edited. Use{" "}
            <strong>End</strong> from the list to close its range, and add a new rate for what replaces it.
          </p>
        </AdminCard>
      </>
    );
  }

  const initial: RateFormValues = {
    id: rate.id,
    province: rate.province,
    federalType: rate.federalType,
    federalRate: String(rate.federalRateMicro / 10_000),
    provincialType: rate.provincialType,
    provincialRate: String(rate.provincialRateMicro / 10_000),
    effectiveFrom: isoDate(rate.effectiveFrom),
    effectiveTo: rate.effectiveTo ? isoDate(rate.effectiveTo) : "",
  };

  return (
    <>
      <AdminPageHeader
        title="Edit regional tax rate"
        description="This rate has not taken effect yet, so it can still be corrected directly rather than superseded."
        breadcrumb={[{ label: "Regional tax rates", href: "/admin/regional-tax-rates" }, { label: "Edit" }]}
      />
      <RateForm csrfToken={actor.csrfToken} initial={initial} />
    </>
  );
}
