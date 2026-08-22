import { clientSnapshot, requireFirmAccess } from "@/server/firm/portfolio";
import { formatDate, relativeTime } from "@/lib/dates";
import { Badge, Card, CardHeader, LinkButton, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { OpenClient } from "./firm-client";

export const metadata = { title: "Client dashboard" };

export default async function FirmDashboardPage() {
  const { clients, firm } = await requireFirmAccess();
  const snapshots = await Promise.all(clients.map((client) => clientSnapshot(client)));

  const needsAttention = snapshots.filter((snapshot) => snapshot.attention.length > 0).length;
  const critical = snapshots.reduce(
    (count, snapshot) => count + snapshot.attention.filter((item) => item.severity === "critical").length,
    0,
  );

  return (
    <>
      <PageHeader
        title="Client dashboard"
        breadcrumb={[{ label: "Firm workspace" }, { label: "Clients" }]}
        description={
          firm
            ? `${clients.length} files under ${firm.name}. Each row reads that client's own ledger — opening one switches your active company.`
            : `${clients.length} client files. Opening one switches your active company.`
        }
        actions={<LinkButton href="/firm/review">Review queue</LinkButton>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Tile label="Client files" value={String(clients.length)} />
        <Tile label="Need attention" value={String(needsAttention)} tone={needsAttention > 0 ? "caution" : "positive"} />
        <Tile label="Ledger exceptions" value={String(critical)} tone={critical > 0 ? "negative" : "positive"} />
      </div>

      <Card className="p-5">
        <CardHeader title="Files" subtitle="Health at a glance, straight from each client's ledger" />
        <Table className="mt-3">
          <thead>
            <tr>
              <Th>Client</Th>
              <Th width="7rem" align="center">Ledger</Th>
              <Th width="6rem" align="right">Bank</Th>
              <Th width="7rem" align="right">Approvals</Th>
              <Th width="9rem" align="right">Overdue A/R</Th>
              <Th width="11rem">Next return</Th>
              <Th width="9rem">Last posting</Th>
              <Th width="6rem" />
            </tr>
          </thead>
          <tbody>
            {snapshots.map((snapshot) => (
              <Tr key={snapshot.client.id}>
                <Td>
                  <OpenClient companyId={snapshot.client.id} href="/dashboard">
                    {snapshot.client.name}
                  </OpenClient>
                  <span className="block text-[0.75rem] text-muted-ink">
                    {snapshot.client.province}
                    {snapshot.client.isReadOnly && " · read-only"}
                    {snapshot.openPeriodsBehind > 0 && ` · ${snapshot.openPeriodsBehind} periods open`}
                  </span>
                </Td>
                <Td align="center">
                  <Badge tone={snapshot.ledgerBalanced ? "positive" : "negative"}>
                    {snapshot.ledgerBalanced ? "balanced" : "exception"}
                  </Badge>
                </Td>
                <Td align="right" className="tnum">
                  {snapshot.bankQueue === 0 ? (
                    <span className="text-muted-ink">—</span>
                  ) : (
                    <span className="font-medium text-caution">{snapshot.bankQueue}</span>
                  )}
                </Td>
                <Td align="right" className="tnum">
                  {snapshot.billsAwaitingApproval === 0 ? (
                    <span className="text-muted-ink">—</span>
                  ) : (
                    <span className="font-medium text-caution">{snapshot.billsAwaitingApproval}</span>
                  )}
                </Td>
                <Td align="right">
                  <Money cents={snapshot.overdueCents} blankZero />
                  {snapshot.overdueInvoices > 0 && (
                    <span className="block text-[0.75rem] text-muted-ink">{snapshot.overdueInvoices} invoices</span>
                  )}
                </Td>
                <Td className="text-[0.75rem]">
                  {snapshot.taxPeriod ? (
                    <>
                      <span className="text-ink-800">{snapshot.taxPeriod.name}</span>
                      <span className={snapshot.taxPeriod.daysToDue < 0 ? "block text-negative" : "block text-muted-ink"}>
                        due {formatDate(snapshot.taxPeriod.dueDate)}
                        {snapshot.taxPeriod.daysToDue < 0 && ` · ${-snapshot.taxPeriod.daysToDue}d late`}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-ink">nothing outstanding</span>
                  )}
                </Td>
                <Td className="text-[0.75rem] text-ink-700">
                  {snapshot.lastPostedAt ? (
                    <>
                      {formatDate(snapshot.lastPostedAt)}
                      <span className="block text-muted-ink">{relativeTime(snapshot.lastPostedAt)}</span>
                    </>
                  ) : (
                    <span className="text-muted-ink">nothing posted</span>
                  )}
                </Td>
                <Td align="right">
                  <OpenClient companyId={snapshot.client.id} href="/dashboard" variant="button">
                    Open
                  </OpenClient>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>

        <p className="mt-4 text-[0.75rem] leading-5 text-muted-ink">
          Access to each file comes from an explicit engagement on that company. Removing your membership removes the
          file from this list and every route into it at the same moment.
        </p>
      </Card>
    </>
  );
}

function Tile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "positive" | "caution" | "negative" }) {
  const color =
    tone === "negative" ? "text-negative" : tone === "caution" ? "text-caution" : tone === "positive" ? "text-positive" : "text-ink-950";
  return (
    <Card className="p-4">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p className={`tnum mt-1 text-[1.5rem] font-semibold leading-8 ${color}`}>{value}</p>
    </Card>
  );
}
