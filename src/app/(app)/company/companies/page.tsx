import { requireVisible } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { currencyOptions, DEFAULT_CURRENCY } from "@/lib/currency";
import { PROVINCES } from "@/lib/enums";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { companyFamily, companyLimit, subscriptionForCompany } from "@/server/companies/families";
import { CompaniesToolbar, CompanyRowActions } from "./companies-client";

export const metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const { company, role, user } = await requireVisible(CAPABILITIES.COMPANY_SETTINGS);
  const manage = can(role, CAPABILITIES.COMPANY_SETTINGS);

  const subscription = await subscriptionForCompany(company.id);
  if (!subscription) {
    return (
      <>
        <PageHeader title="Companies" breadcrumb={[{ label: "Company" }, { label: "Companies" }]} />
        <Card className="p-5">
          <p className="text-[0.8125rem] text-muted-ink">
            No subscription is associated with this account, so companies cannot be managed here.
          </p>
        </Card>
      </>
    );
  }

  const [family, limit] = await Promise.all([
    companyFamily(subscription.id, user.id),
    companyLimit(subscription.id),
  ]);

  const active = family.filter((c) => !c.archivedAt);
  const archived = family.filter((c) => c.archivedAt);

  const createOptions = {
    provinces: PROVINCES.map((p) => ({ code: p.code, name: p.name })),
    currencies: currencyOptions(DEFAULT_CURRENCY),
  };

  return (
    <>
      <PageHeader
        title="Companies"
        breadcrumb={[{ label: "Company" }, { label: "Companies" }]}
        description="Every company on this subscription. Each has its own isolated books; only people you explicitly add can open one."
        actions={
          manage ? (
            <CompaniesToolbar
              usage={`${limit.used} of ${limit.limit} companies used`}
              overLimit={limit.overLimit}
              atLimit={limit.used >= limit.limit}
              planName={limit.planName}
              options={createOptions}
            />
          ) : (
            <Badge>{limit.used} of {limit.limit} companies used</Badge>
          )
        }
      />

      {limit.overLimit && manage && (
        <p className="mb-4 rounded-lg border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2.5 text-[0.8125rem] text-negative">
          This account is using {limit.used} companies, over the {limit.limit} included in the {limit.planName ?? "current"}{" "}
          plan — likely from a recent downgrade. Nothing has been removed. Archive companies you no longer need, or
          upgrade the plan, before adding another.
        </p>
      )}

      <Card padded={false}>
        {active.length === 0 ? (
          <EmptyState title="No active companies" description="Every company on this subscription is archived." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th width="8rem">Jurisdiction</Th>
                <Th width="6rem">Currency</Th>
                <Th width="7rem">Your access</Th>
                <Th width="7rem">Opened</Th>
                {manage && <Th width="12rem" align="right">{""}</Th>}
              </tr>
            </thead>
            <tbody>
              {active.map((c) => (
                <Tr key={c.id} className={c.id === company.id ? "bg-brand-soft/40" : undefined}>
                  <Td>
                    <span className="font-medium text-ink-900">{c.name}</span>
                    {c.id === company.id && <Badge tone="accent" className="ml-1.5">current</Badge>}
                    {c.isOriginal && <Badge className="ml-1.5">original</Badge>}
                  </Td>
                  <Td className="text-[0.8125rem] text-muted-ink">{c.province}</Td>
                  <Td className="text-[0.8125rem] text-muted-ink">{c.baseCurrency}</Td>
                  <Td className="text-[0.8125rem] text-muted-ink">
                    {c.memberRole ? c.memberRole.charAt(0) + c.memberRole.slice(1).toLowerCase() : "Not a member"}
                  </Td>
                  <Td className="text-[0.8125rem] text-muted-ink">{formatDate(c.createdAt)}</Td>
                  {manage && (
                    <Td align="right">
                      <CompanyRowActions
                        company={{ id: c.id, name: c.name }}
                        isCurrent={c.id === company.id}
                        isMember={c.memberRole !== null}
                        archived={false}
                      />
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {archived.length > 0 && (
        <Card padded={false} className="mt-4">
          <div className="border-b border-paper-200 px-5 py-3">
            <h2 className="text-[0.8125rem] font-semibold text-ink-900">Archived</h2>
            <p className="text-[0.75rem] text-muted-ink">Read-only. Restore to reopen a company for posting.</p>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th width="8rem">Jurisdiction</Th>
                <Th>Reason</Th>
                {manage && <Th width="8rem" align="right">{""}</Th>}
              </tr>
            </thead>
            <tbody>
              {archived.map((c) => (
                <Tr key={c.id}>
                  <Td className="text-ink-700">{c.name}</Td>
                  <Td className="text-[0.8125rem] text-muted-ink">{c.province}</Td>
                  <Td className="text-[0.8125rem] text-muted-ink">{c.archiveReason ?? "—"}</Td>
                  {manage && (
                    <Td align="right">
                      <CompanyRowActions
                        company={{ id: c.id, name: c.name }}
                        isCurrent={false}
                        isMember={c.memberRole !== null}
                        archived
                      />
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
