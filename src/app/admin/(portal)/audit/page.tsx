import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { AUDIT_ACTION_LABELS, SENSITIVE_ACTIONS } from "@/server/admin/audit";
import { listPlatformAudit } from "@/server/db/platform";
import { formatDateTime } from "@/lib/dates";
import { AdminCard, AdminPageHeader, Pagination } from "@/components/admin/ui";
import { adminInputClass } from "@/components/admin/forms";
import type { AdminSearchParams } from "@/lib/admin-constants";

export const metadata = { title: "Admin audit log" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const PER_PAGE = 40;

/**
 * The platform audit trail.
 *
 * Read-only by construction: there is no edit control, no delete control and no
 * action on this page at all. An audit log the console can alter is not evidence
 * of anything.
 *
 * What each entry may contain is decided in `recordPlatformAudit`, which passes
 * every payload through `redact()` — so no password hash, token, secret or key
 * can appear here even if a caller passed one by mistake.
 */
export default async function AuditPage({ searchParams }: { searchParams: AdminSearchParams }) {
  await requirePlatformAdmin();
  const params = await searchParams;

  const action = first(params.action) ?? "";
  const entityId = first(params.entityId) ?? "";
  const actor = first(params.actor) ?? "";
  const page = Math.max(Number(first(params.page) ?? 1) || 1, 1);

  const actorLc = actor.toLowerCase();
  const matched = (await listPlatformAudit({ limit: 5000 }))
    .filter((e) => !action || e.action === action)
    .filter((e) => !entityId || e.entityId === entityId)
    .filter((e) => !actor || (e.actorEmail ?? "").toLowerCase().includes(actorLc));
  const total = matched.length;
  const entries = matched.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const actions = Object.keys(AUDIT_ACTION_LABELS).sort((a, b) =>
    AUDIT_ACTION_LABELS[a].localeCompare(AUDIT_ACTION_LABELS[b]),
  );

  return (
    <>
      <AdminPageHeader
        title="Admin audit log"
        description="Every action taken from this console — who, what, when, and from where."
      />

      <AdminCard className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[14rem_1fr_1fr_auto]">
          <select name="action" defaultValue={action} aria-label="Action" className={adminInputClass}>
            <option value="">Any action</option>
            {actions.map((key) => (
              <option key={key} value={key}>
                {AUDIT_ACTION_LABELS[key]}
              </option>
            ))}
          </select>
          <input
            type="search"
            name="actor"
            defaultValue={actor}
            placeholder="Administrator email"
            aria-label="Acting administrator"
            className={adminInputClass}
          />
          <input
            type="search"
            name="entityId"
            defaultValue={entityId}
            placeholder="Entity id (company, user, plan…)"
            aria-label="Entity id"
            className={`${adminInputClass} font-mono`}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-lg bg-ink-950 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-ink-900"
            >
              Filter
            </button>
            {(action || actor || entityId) && (
              <Link href="/admin/audit" className="text-[0.8125rem] font-medium text-brand-700 hover:underline">
                Clear
              </Link>
            )}
          </div>
        </form>
      </AdminCard>

      <div className="space-y-2">
        {entries.length === 0 ? (
          <AdminCard>
            <p className="py-8 text-center text-[0.8125rem] text-muted-ink">
              No audit entries match that filter.
            </p>
          </AdminCard>
        ) : (
          entries.map((entry) => {
            const sensitive = SENSITIVE_ACTIONS.has(entry.action);
            return (
              <article
                key={entry.id}
                className={
                  sensitive
                    ? "rounded-(--radius-card) border border-[color:var(--color-negative)]/25 bg-white px-4 py-3"
                    : "rounded-(--radius-card) border border-paper-300 bg-white px-4 py-3"
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[0.8125rem] font-medium text-ink-900">{entry.summary}</p>
                  <span className="shrink-0 text-[0.75rem] tabular-nums text-muted-ink">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>

                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-muted-ink">
                  <span
                    className={
                      sensitive
                        ? "rounded-full bg-negative-soft px-2 py-0.5 font-medium text-negative"
                        : "rounded-full bg-paper-200 px-2 py-0.5 font-medium text-ink-700"
                    }
                  >
                    {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                  <span>{entry.actorEmail}</span>
                  <span>
                    {entry.entityType}
                    {entry.entityId && (
                      <>
                        {" "}
                        <Link
                          href={`/admin/audit?entityId=${entry.entityId}`}
                          className="font-mono hover:text-brand-700 hover:underline"
                        >
                          {entry.entityId.slice(0, 10)}…
                        </Link>
                      </>
                    )}
                  </span>
                  {entry.ipAddress && <span>{entry.ipAddress}</span>}
                  {entry.requestId && (
                    <span className="font-mono" title="Request correlation id">
                      {entry.requestId.slice(0, 8)}
                    </span>
                  )}
                </p>

                {entry.reason && (
                  <p className="mt-2 rounded-md bg-paper-200 px-3 py-1.5 text-[0.75rem] italic leading-5 text-ink-700">
                    “{entry.reason}”
                  </p>
                )}

                {(entry.beforeJson || entry.afterJson) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[0.75rem] font-medium text-brand-700 hover:underline">
                      Before and after
                    </summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {entry.beforeJson && <JsonBlock label="Before" json={entry.beforeJson} />}
                      {entry.afterJson && <JsonBlock label="After" json={entry.afterJson} />}
                    </div>
                  </details>
                )}
              </article>
            );
          })
        )}
      </div>

      <div className="mt-4">
        <Pagination
          page={page}
          pageCount={Math.max(1, Math.ceil(total / PER_PAGE))}
          total={total}
          basePath="/admin/audit"
          params={{ action, actor, entityId }}
        />
      </div>
    </>
  );
}

function JsonBlock({ label, json }: { label: string; json: string }) {
  let pretty = json;
  try {
    pretty = JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    // Stored as written. A payload that will not re-parse is still worth showing.
  }
  return (
    <div>
      <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <pre className="thin-scroll max-h-64 overflow-auto rounded-md bg-ink-950 p-3 text-[0.6875rem] leading-5 text-ink-100">
        {pretty}
      </pre>
    </div>
  );
}
