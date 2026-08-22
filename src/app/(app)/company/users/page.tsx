import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, MATRIX_FOR_DISPLAY, type AccessLevel, type Capability } from "@/lib/permissions";
import { COMPANY_ROLES, ROLE_LABELS, type CompanyRole } from "@/lib/enums";
import { formatDate, relativeTime } from "@/lib/dates";
import { Badge, Card, CardHeader, PageHeader, Table, Td, Th, Tr, type Tone } from "@/components/ui";
import { InviteUserForm, MembershipActions } from "./user-admin";

export const metadata = { title: "Users & access" };

const LEVEL_TONE: Record<AccessLevel, Tone> = {
  FULL: "positive",
  REVIEW: "caution",
  VIEW: "info",
  NONE: "neutral",
};

const CAPABILITY_LABELS: Record<string, string> = {
  "company.settings": "Company settings",
  "company.users": "Users & access",
  "accounting.coa": "Chart of accounts",
  "sales.invoices": "Invoices & customers",
  "purchases.bills": "Bills & vendors",
  expenses: "Expenses",
  payments: "Payments",
  "accounting.journals": "Journal entries",
  "accounting.period_close": "Period close",
  "tax.settings": "Tax setup",
  "tax.filing": "Tax filing",
  banking: "Banking",
  reports: "Reports",
  audit: "Audit log",
  subscription: "Subscription",
};

export default async function CompanyUsersPage() {
  const { company, user } = await requireCapability(CAPABILITIES.USERS);

  const [memberships, subscription] = await Promise.all([
    db.companyUser.findMany({
      where: { companyId: company.id },
      include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true, mfaEnabled: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    }),
    db.subscription.findUnique({ where: { companyId: company.id } }),
  ]);

  const seatsUsed = memberships.filter((m) => m.status !== "SUSPENDED").length;
  const seats = subscription?.seats ?? memberships.length;

  return (
    <>
      <PageHeader
        title="Users & access"
        breadcrumb={[{ label: "Company", href: "/company" }, { label: "Users & access" }]}
        description="A person can only reach this company's books through a membership row here. Removing it removes the access, immediately and everywhere."
        actions={
          <Badge tone={seatsUsed >= seats ? "caution" : "neutral"}>
            {seatsUsed} of {seats} seats
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-4">
          <Card className="p-5">
            <CardHeader title="People" subtitle={`${memberships.length} with a membership on this company`} />
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th width="13rem">Role</Th>
                  <Th width="9rem">Last seen</Th>
                  <Th width="7rem">Status</Th>
                  <Th width="13rem" />
                </tr>
              </thead>
              <tbody>
                {memberships.map((membership) => (
                  <Tr key={membership.id}>
                    <Td>
                      <span className="font-medium text-ink-900">{membership.user.name}</span>
                      {membership.userId === user.id && <span className="ml-1.5 text-[0.75rem] text-muted-ink">(you)</span>}
                      <span className="block text-[0.75rem] text-muted-ink">{membership.user.email}</span>
                    </Td>
                    <Td>
                      <span className="text-ink-800">{ROLE_LABELS[membership.role as CompanyRole] ?? membership.role}</span>
                      <span className="block text-[0.75rem] text-muted-ink">
                        {membership.acceptedAt
                          ? `joined ${formatDate(membership.acceptedAt)}`
                          : membership.invitedAt
                            ? `invited ${formatDate(membership.invitedAt)}`
                            : `added ${formatDate(membership.createdAt)}`}
                      </span>
                    </Td>
                    <Td className="text-[0.75rem] text-ink-700">
                      {membership.user.lastLoginAt ? relativeTime(membership.user.lastLoginAt) : "never"}
                      <span className="block text-muted-ink">{membership.user.mfaEnabled ? "MFA on" : "MFA off"}</span>
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          membership.status === "ACTIVE" ? "positive" : membership.status === "INVITED" ? "info" : "negative"
                        }
                      >
                        {membership.status.toLowerCase()}
                      </Badge>
                    </Td>
                    <Td>
                      <MembershipActions
                        membershipId={membership.id}
                        role={membership.role}
                        status={membership.status}
                        name={membership.user.name}
                        isSelf={membership.userId === user.id}
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card className="p-5">
            <CardHeader
              title="What each role can do"
              subtitle="Enforced on the server for every request — hiding a menu item is never the control"
            />
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th>Area</Th>
                  {COMPANY_ROLES.map((role) => (
                    <Th key={role} width="8.5rem" align="center">{role.toLowerCase()}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(CAPABILITY_LABELS).map(([capability, label]) => (
                  <Tr key={capability}>
                    <Td>{label}</Td>
                    {COMPANY_ROLES.map((role) => {
                      const level = MATRIX_FOR_DISPLAY[role][capability as Capability];
                      return (
                        <Td key={role} align="center">
                          {level === "NONE" ? (
                            <span className="text-muted-ink">—</span>
                          ) : (
                            <Badge tone={LEVEL_TONE[level]}>{level.toLowerCase()}</Badge>
                          )}
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-3 text-[0.75rem] leading-5 text-muted-ink">
              <span className="font-medium text-ink-700">Full</span> can create, edit and post.{" "}
              <span className="font-medium text-ink-700">Review</span> can read and approve but never originate a
              document. <span className="font-medium text-ink-700">View</span> is read-only.
            </p>
          </Card>
        </div>

        <div className="space-y-4">
          <InviteUserForm seatsLeft={Math.max(0, seats - seatsUsed)} />

          <Card>
            <CardHeader title="External accountants" />
            <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
              Give your accountant the <span className="font-medium text-ink-700">External Accountant</span> role. It
              carries full posting, tax and close rights and opens the firm workspace, but no access to billing or to
              inviting other people.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
