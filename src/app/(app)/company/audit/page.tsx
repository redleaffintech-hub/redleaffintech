import Link from "next/link";
import { db } from "@/lib/db";
import { requireVisible } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDateTime, relativeTime } from "@/lib/dates";
import { contains } from "@/lib/search";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr, type Tone } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 100;

const ACTION_TONE: Record<string, Tone> = {
  POST: "positive",
  CREATE: "info",
  UPDATE: "neutral",
  REVERSE: "caution",
  VOID: "negative",
  CLOSE: "caution",
  REOPEN: "caution",
  LOGIN: "neutral",
  EXPORT: "info",
};

/** Where an entity can be opened, when the log row points at something linkable. */
function linkFor(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case "JournalEntry":
      return `/accounting/journals/${entityId}`;
    case "Invoice":
      return `/sales/invoices/${entityId}`;
    case "Bill":
      return `/purchases/bills/${entityId}`;
    default:
      return null;
  }
}

export default async function AuditLogPage({ searchParams }: PageProps<"/company/audit">) {
  const { company } = await requireVisible(CAPABILITIES.AUDIT);
  const params = await searchParams;
  const action = typeof params.action === "string" ? params.action : "";
  const query = typeof params.q === "string" ? params.q : "";
  const page = Math.max(1, Number(typeof params.page === "string" ? params.page : 1) || 1);

  const where = {
    companyId: company.id,
    ...(action ? { action } : {}),
    ...(query
      ? { OR: [{ summary: contains(query) }, { entityType: contains(query) }] }
      : {}),
  };

  const [entries, total, byAction] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["action"], where: { companyId: company.id }, _count: { _all: true } }),
  ]);

  const countOf = (name: string) => byAction.find((row) => row.action === name)?._count._all ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const queryString = (nextPage: number) => {
    const next = new URLSearchParams();
    if (action) next.set("action", action);
    if (query) next.set("q", query);
    if (nextPage > 1) next.set("page", String(nextPage));
    const search = next.toString();
    return search ? `/company/audit?${search}` : "/company/audit";
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        breadcrumb={[{ label: "Company", href: "/company" }, { label: "Audit log" }]}
        description="Every posting, reversal, close and access change, with who did it and when. Entries are written by the engine and cannot be edited or deleted from the app."
      />

      <FilterBar
        paramName="action"
        searchPlaceholder="Search the log…"
        tabs={[
          { label: "Everything", value: "" },
          { label: "Postings", value: "POST", count: countOf("POST") },
          { label: "Created", value: "CREATE", count: countOf("CREATE") },
          { label: "Changed", value: "UPDATE", count: countOf("UPDATE") },
          { label: "Reversed", value: "REVERSE", count: countOf("REVERSE") },
          { label: "Voided", value: "VOID", count: countOf("VOID") },
          { label: "Sign-ins", value: "LOGIN", count: countOf("LOGIN") },
        ]}
      />

      <Card className="p-5">
        {entries.length === 0 ? (
          <EmptyState
            title="Nothing in the log yet"
            description={action || query ? "Try clearing the filters." : "Activity appears here as soon as anything is posted."}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th width="13rem">When</Th>
                  <Th width="7rem">Action</Th>
                  <Th>What happened</Th>
                  <Th width="12rem">Who</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const href = linkFor(entry.entityType, entry.entityId);
                  return (
                    <Tr key={entry.id}>
                      <Td className="text-[0.75rem] text-ink-700">
                        {formatDateTime(entry.createdAt)}
                        <span className="block text-muted-ink">{relativeTime(entry.createdAt)}</span>
                      </Td>
                      <Td>
                        <Badge tone={ACTION_TONE[entry.action] ?? "neutral"}>{entry.action.toLowerCase()}</Badge>
                      </Td>
                      <Td>
                        {href ? (
                          <Link href={href} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                            {entry.summary}
                          </Link>
                        ) : (
                          <span className="text-ink-800">{entry.summary}</span>
                        )}
                        <span className="block text-[0.75rem] text-muted-ink">{entry.entityType}</span>
                      </Td>
                      <Td className="text-[0.75rem]">
                        {entry.user ? (
                          <>
                            <span className="text-ink-800">{entry.user.name}</span>
                            <span className="block text-muted-ink">{entry.user.email}</span>
                          </>
                        ) : (
                          <span className="text-muted-ink">system</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>

            <div className="mt-4 flex items-center justify-between border-t border-paper-200 pt-3 text-[0.8125rem] text-muted-ink">
              <span>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString("en-CA")}
              </span>
              <span className="flex items-center gap-3">
                {page > 1 && (
                  <Link href={queryString(page - 1)} className="font-medium text-ink-700 hover:text-brand-700 hover:underline">
                    Newer
                  </Link>
                )}
                {page < pages && (
                  <Link href={queryString(page + 1)} className="font-medium text-ink-700 hover:text-brand-700 hover:underline">
                    Older
                  </Link>
                )}
              </span>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
