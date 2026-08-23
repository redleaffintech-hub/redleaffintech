import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { getClient } from "@/server/admin/clients";
import { PROVINCES } from "@/lib/enums";
import { currencyOptions } from "@/lib/currency";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { AdminField, AdminForm, adminInputClass, SubmitButton } from "@/components/admin/forms";
import { updateClientAction } from "../../actions";
import type { AdminParams } from "@/lib/admin-constants";

export const metadata = { title: "Edit client" };

/**
 * Company details, editable.
 *
 * The fiscal-year start is not here. It becomes read-only once anything is
 * posted — that is a domain rule the company's own settings screen owns, and
 * duplicating an editable copy of it in the admin console would be a way to
 * break a client's comparatives from the outside.
 */
export default async function EditClientPage({ params }: { params: AdminParams<"companyId"> }) {
  const actor = await requirePlatformAdmin();
  const { companyId } = await params;

  const company = await getClient(companyId);
  if (!company) notFound();

  const currencies = currencyOptions(company.baseCurrency);

  return (
    <>
      <AdminPageHeader
        title={`Edit ${company.name}`}
        description="Contact and registration details for this company file."
        breadcrumb={[
          { label: "Clients", href: "/admin/clients" },
          { label: company.name, href: `/admin/clients/${companyId}` },
          { label: "Edit" },
        ]}
      />

      <AdminForm action={updateClientAction} csrfToken={actor.csrfToken} className="space-y-5">
        <input type="hidden" name="companyId" value={companyId} />

        <AdminCard title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminField label="Operating name" required htmlFor="name">
              <input id="name" name="name" required defaultValue={company.name} className={adminInputClass} />
            </AdminField>
            <AdminField label="Legal name" htmlFor="legalName">
              <input id="legalName" name="legalName" defaultValue={company.legalName ?? ""} className={adminInputClass} />
            </AdminField>
            <AdminField label="Business number" htmlFor="businessNumber">
              <input
                id="businessNumber"
                name="businessNumber"
                defaultValue={company.businessNumber ?? ""}
                className={adminInputClass}
              />
            </AdminField>
            <AdminField label="Industry" htmlFor="industry">
              <input id="industry" name="industry" defaultValue={company.industry ?? ""} className={adminInputClass} />
            </AdminField>
          </div>
        </AdminCard>

        <AdminCard title="Contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminField label="Company email" htmlFor="email">
              <input id="email" name="email" type="email" defaultValue={company.email ?? ""} className={adminInputClass} />
            </AdminField>
            <AdminField label="Phone" htmlFor="phone">
              <input id="phone" name="phone" defaultValue={company.phone ?? ""} className={adminInputClass} />
            </AdminField>
            <AdminField label="Website" htmlFor="website">
              <input id="website" name="website" defaultValue={company.website ?? ""} className={adminInputClass} />
            </AdminField>
          </div>
        </AdminCard>

        <AdminCard title="Address and jurisdiction">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminField label="Address line 1" htmlFor="addressLine1">
              <input
                id="addressLine1"
                name="addressLine1"
                defaultValue={company.addressLine1 ?? ""}
                className={adminInputClass}
              />
            </AdminField>
            <AdminField label="Address line 2" htmlFor="addressLine2">
              <input
                id="addressLine2"
                name="addressLine2"
                defaultValue={company.addressLine2 ?? ""}
                className={adminInputClass}
              />
            </AdminField>
            <AdminField label="City" htmlFor="city">
              <input id="city" name="city" defaultValue={company.city ?? ""} className={adminInputClass} />
            </AdminField>
            <AdminField label="Postal code" htmlFor="postalCode">
              <input id="postalCode" name="postalCode" defaultValue={company.postalCode ?? ""} className={adminInputClass} />
            </AdminField>
            <AdminField label="Country" htmlFor="country">
              <select id="country" name="country" defaultValue={company.country} className={adminInputClass}>
                <option value="CA">Canada</option>
                <option value="US">United States</option>
              </select>
            </AdminField>
            <AdminField
              label="Province"
              required
              htmlFor="province"
              hint="Changing this does not re-provision tax codes — the company adds those from its own tax settings."
            >
              <select id="province" name="province" defaultValue={company.province} required className={adminInputClass}>
                {PROVINCES.map((province) => (
                  <option key={province.code} value={province.code}>
                    {province.name}
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField
              label="Base currency"
              htmlFor="baseCurrency"
              hint="Only the presentation currency. Posted amounts are not converted."
            >
              <select
                id="baseCurrency"
                name="baseCurrency"
                defaultValue={company.baseCurrency}
                className={adminInputClass}
              >
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.label}
                  </option>
                ))}
              </select>
            </AdminField>
          </div>
        </AdminCard>

        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          <Link
            href={`/admin/clients/${companyId}`}
            className="text-[0.8125rem] font-medium text-ink-700 hover:underline"
          >
            Cancel
          </Link>
        </div>
      </AdminForm>
    </>
  );
}
