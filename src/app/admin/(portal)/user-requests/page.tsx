import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { listSeatRequests } from "@/server/seats/requests";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { SEAT_REQUEST_STATUS_LABELS } from "@/lib/seats";
import { Badge, Table, Td, Th, Tr } from "@/components/ui";
import { AdminCard, AdminPageHeader, EmptyRow } from "@/components/admin/ui";
import { SeatRequestRowActions } from "./row-actions";

export const metadata = { title: "Additional user requests" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function UserRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePlatformAdmin();
  const status = first((await searchParams).status);
  const filter = status && status in SEAT_REQUEST_STATUS_LABELS ? status : undefined;
  const requests = await listSeatRequests(filter);

  return (
    <>
      <AdminPageHeader
        title="Additional user requests"
        description="Companies include 2 users. Anything beyond that is requested here and charged per user per month once approved."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "User requests" }]}
      />

      <div className="mb-3 flex flex-wrap gap-2 text-[0.8125rem]">
        {[undefined, "PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/admin/user-requests?status=${s}` : "/admin/user-requests"}
            className={`rounded-full border px-3 py-1 ${filter === s ? "border-brand-600 bg-brand-soft font-medium" : "border-paper-400 bg-white hover:bg-paper-100"}`}
          >
            {s ? SEAT_REQUEST_STATUS_LABELS[s] : "All"}
          </Link>
        ))}
      </div>

      <AdminCard>
        <Table>
          <thead>
            <tr>
              <Th>Company</Th>
              <Th width="7rem" align="right">Current users</Th>
              <Th width="8rem" align="right">Requested</Th>
              <Th width="9rem" align="right">Charge / month</Th>
              <Th width="8rem">Requested on</Th>
              <Th width="9rem">Status</Th>
              <Th width="14rem" align="right">{""}</Th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 && <EmptyRow colSpan={7}>No requests{filter ? ` with status “${SEAT_REQUEST_STATUS_LABELS[filter]}”` : ""}.</EmptyRow>}
            {requests.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link href={`/admin/clients/${r.company.id}`} className="font-medium text-brand-700 hover:underline">{r.company.name}</Link>
                  {r.note && <div className="mt-0.5 text-[0.75rem] text-muted-ink">“{r.note}”</div>}
                  {r.decisionNote && <div className="mt-0.5 text-[0.75rem] text-muted-ink">Decision: {r.decisionNote}</div>}
                </Td>
                <Td align="right"><span className="tnum">{r.usersBefore}</span> <span className="text-muted-ink">of {r.seatsBefore}</span></Td>
                <Td align="right"><span className="tnum">+{r.extraUsers}</span></Td>
                <Td align="right"><span className="tnum">{formatMoney(r.totalCents)}</span></Td>
                <Td>{formatDate(r.createdAt)}</Td>
                <Td>
                  <Badge tone={r.status === "APPROVED" ? "positive" : r.status === "PENDING" ? "info" : "negative"}>
                    {SEAT_REQUEST_STATUS_LABELS[r.status] ?? r.status}
                  </Badge>
                  {r.decidedByEmail && <div className="mt-0.5 text-[0.75rem] text-muted-ink">{r.decidedByEmail}</div>}
                </Td>
                <Td align="right">
                  {r.status === "PENDING" && (
                    <SeatRequestRowActions
                      csrfToken={actor.csrfToken}
                      requestId={r.id}
                      companyName={r.company.name}
                      extraUsers={r.extraUsers}
                      chargeLabel={`${formatMoney(r.totalCents)}/month`}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </AdminCard>
    </>
  );
}
