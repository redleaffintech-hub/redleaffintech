import { requireAdminApi } from "@/server/admin/guard";
import { listClientsForExport, type ClientRow, type ClientSort } from "@/server/admin/clients";
import { AUDIT_ACTIONS, recordPlatformAudit } from "@/server/admin/audit";
import { contentDisposition, csvFile, csvDate, csvMoney, type CsvColumn } from "@/lib/csv";

/**
 * CSV export of the client list.
 *
 * A route handler, not a server action, because a browser has to be able to
 * navigate to it and receive a file. That also makes it the one admin endpoint
 * an attacker could try to reach directly — so it is guarded by
 * `requireAdminApi()`, which answers 401 to an anonymous caller and 403 to a
 * signed-in customer, and returns no data in either case.
 *
 * It lives under `/admin` rather than `/api` for a concrete reason: the admin
 * session cookie is scoped to the `/admin` path, so a browser would not send it
 * to `/api/...` at all and the export would 401 for a legitimately signed-in
 * administrator. Route handlers ignore layouts, so being inside the `(portal)`
 * group costs nothing.
 *
 * The export deliberately carries no secrets: no password hashes, no session or
 * reset tokens, no payment credentials. It is a commercial list — who the
 * clients are, what they are on, and when it renews.
 */

const COLUMNS: CsvColumn<ClientRow>[] = [
  { header: "Company", value: (row) => row.name },
  { header: "Legal name", value: (row) => row.legalName ?? "" },
  { header: "Company email", value: (row) => row.email ?? "" },
  { header: "Phone", value: (row) => row.phone ?? "" },
  { header: "Country", value: (row) => row.country },
  { header: "Province", value: (row) => row.province },
  { header: "Currency", value: (row) => row.baseCurrency },
  { header: "Primary user", value: (row) => row.primaryUser?.name ?? "" },
  { header: "Primary email", value: (row) => row.primaryUser?.email ?? "" },
  { header: "Users", value: (row) => row.userCount },
  { header: "Plan", value: (row) => row.subscription?.plan ?? "" },
  { header: "Billing cycle", value: (row) => row.subscription?.billingCycle ?? "" },
  { header: "Status", value: (row) => row.subscription?.status ?? "" },
  { header: "Seats allowed", value: (row) => row.subscription?.seats ?? "" },
  { header: "Seat override", value: (row) => (row.subscription?.seatsOverridden ? "yes" : "no") },
  {
    header: "Price per cycle",
    value: (row) => (row.subscription?.priceCents != null ? csvMoney(row.subscription.priceCents) : ""),
  },
  { header: "Trial ends", value: (row) => csvDate(row.subscription?.trialEndsAt) },
  { header: "Period ends", value: (row) => csvDate(row.subscription?.currentPeriodEnd) },
  { header: "Read-only", value: (row) => (row.isReadOnly ? "yes" : "no") },
  { header: "Created", value: (row) => csvDate(row.createdAt) },
];

export async function GET(request: Request) {
  const guard = await requireAdminApi();
  if ("response" in guard) return guard.response;

  const url = new URL(request.url);
  const filters = {
    q: url.searchParams.get("q") ?? undefined,
    plan: url.searchParams.get("plan") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    sort: (url.searchParams.get("sort") ?? "created") as ClientSort,
  };

  const rows = await listClientsForExport(filters);

  // Exporting the customer list is worth a line in the trail: it is the one
  // action here that takes commercial data out of the building.
  await recordPlatformAudit({
    actorUserId: guard.actor.id,
    actorEmail: guard.actor.email,
    action: AUDIT_ACTIONS.CLIENT_UPDATED,
    entityType: "Company",
    summary: `Exported ${rows.length} client${rows.length === 1 ? "" : "s"} to CSV`,
    after: { filters },
  });

  const filename = `redleaf-clients-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csvFile(rows, COLUMNS), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
