import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import type { AdminParams } from "@/lib/admin-constants";
import { StatutoryRateForm, type StatutoryRateFormValues } from "../../rate-form";

export const metadata = { title: "Edit payroll statutory rate" };

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function EditStatutoryRatePage({ params }: { params: AdminParams<"id"> }) {
  const actor = await requirePlatformAdmin();
  const { id } = await params;

  const rate = await db.payrollStatutoryRate.findUnique({ where: { id } });
  if (!rate) notFound();

  if (rate.effectiveFrom <= new Date()) {
    return (
      <>
        <AdminPageHeader
          title="Edit payroll statutory rate"
          breadcrumb={[{ label: "Payroll rates" }, { label: "Statutory (CPP/CPP2/EI)", href: "/admin/payroll-rates/statutory" }, { label: "Edit" }]}
        />
        <AdminCard>
          <p className="text-[0.8125rem] leading-6 text-ink-700">
            This rate took effect on {isoDate(rate.effectiveFrom)} and can no longer be edited. Use <strong>End</strong> from
            the list to close its range, and add a new rate for what replaces it.
          </p>
        </AdminCard>
      </>
    );
  }

  const initial: StatutoryRateFormValues = {
    id: rate.id,
    cppRate: String(rate.cppRateMicro / 10_000),
    cppBasicExemption: String(rate.cppBasicExemptionCents / 100),
    cppMaxPensionableEarnings: String(rate.cppMaxPensionableEarningsCents / 100),
    cpp2Rate: String(rate.cpp2RateMicro / 10_000),
    cpp2MaxPensionableEarnings: String(rate.cpp2MaxPensionableEarningsCents / 100),
    eiRate: String(rate.eiRateMicro / 10_000),
    eiRateQuebec: String(rate.eiRateMicroQuebec / 10_000),
    eiEmployerMultiplier: String(rate.eiEmployerMultiplierMicro / 1_000_000),
    eiMaxInsurableEarnings: String(rate.eiMaxInsurableEarningsCents / 100),
    qpipRate: String(rate.qpipRateMicro / 10_000),
    qpipEmployerRate: String(rate.qpipEmployerRateMicro / 10_000),
    qpipMaxInsurableEarnings: String(rate.qpipMaxInsurableEarningsCents / 100),
    effectiveFrom: isoDate(rate.effectiveFrom),
    effectiveTo: rate.effectiveTo ? isoDate(rate.effectiveTo) : "",
  };

  return (
    <>
      <AdminPageHeader
        title="Edit payroll statutory rate"
        description="This rate has not taken effect yet, so it can still be corrected directly rather than superseded."
        breadcrumb={[{ label: "Payroll rates" }, { label: "Statutory (CPP/CPP2/EI)", href: "/admin/payroll-rates/statutory" }, { label: "Edit" }]}
      />
      <StatutoryRateForm csrfToken={actor.csrfToken} initial={initial} />
    </>
  );
}
