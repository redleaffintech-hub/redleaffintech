import { clientSnapshot, requireFirmAccess, type AttentionItem, type Severity } from "@/server/firm/portfolio";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Table, Td, Th, Tr, type Tone } from "@/components/ui";
import { OpenClient } from "../firm-client";

export const metadata = { title: "Review queue" };

const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "negative",
  warning: "caution",
  info: "info",
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Exception",
  warning: "Needs work",
  info: "Worth a look",
};

export default async function FirmReviewPage() {
  const { clients } = await requireFirmAccess();
  const snapshots = await Promise.all(clients.map((client) => clientSnapshot(client)));

  const items: AttentionItem[] = snapshots
    .flatMap((snapshot) => snapshot.attention)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.companyName.localeCompare(b.companyName),
    );

  const counts = {
    critical: items.filter((item) => item.severity === "critical").length,
    warning: items.filter((item) => item.severity === "warning").length,
    info: items.filter((item) => item.severity === "info").length,
  };

  return (
    <>
      <PageHeader
        title="Review queue"
        breadcrumb={[{ label: "Firm workspace", href: "/firm" }, { label: "Review queue" }]}
        description="Everything across your client files that wants an accountant's eye, worst first. Opening an item switches to that client and takes you straight to the screen that fixes it."
        actions={<LinkButton href="/firm/close">Close checklist</LinkButton>}
      />

      {items.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            title="Nothing needs attention"
            description="Every client file balances, the bank feeds are clear and no return is near its due date."
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone="negative">{counts.critical} exceptions</Badge>
            <Badge tone="caution">{counts.warning} need work</Badge>
            <Badge tone="info">{counts.info} worth a look</Badge>
          </div>

          <Card className="p-5">
            <CardHeader title="Queue" subtitle={`${items.length} items across ${clients.length} files`} />
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th width="9rem">Severity</Th>
                  <Th width="14rem">Client</Th>
                  <Th>What needs doing</Th>
                  <Th width="7rem" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <Tr key={`${item.companyId}-${item.title}-${index}`}>
                    <Td>
                      <Badge tone={SEVERITY_TONE[item.severity]}>{SEVERITY_LABEL[item.severity]}</Badge>
                    </Td>
                    <Td>
                      <OpenClient companyId={item.companyId} href="/dashboard">
                        {item.companyName}
                      </OpenClient>
                    </Td>
                    <Td>
                      <span className="font-medium text-ink-900">{item.title}</span>
                      <span className="block text-[0.75rem] leading-5 text-muted-ink">{item.detail}</span>
                    </Td>
                    <Td align="right">
                      <OpenClient companyId={item.companyId} href={item.href} variant="button">
                        Fix
                      </OpenClient>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>

            <p className="mt-4 text-[0.75rem] leading-5 text-muted-ink">
              An <span className="font-medium text-ink-700">exception</span> is something with a cost attached — a
              ledger that disagrees with itself, or a return already past its filing date. Take those first: every
              report downstream of an unbalanced ledger is wrong until it is fixed, and interest on a late return runs
              daily.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
