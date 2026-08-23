import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Badge, Card, LinkButton, LinkCell, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Pay runs" };

const STATUS_TONE: Record<string, "neutral" | "positive" | "negative"> = {
  DRAFT: "neutral",
  POSTED: "positive",
  VOID: "negative",
};

export default async function PayRunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, role } = await requireCapability(CAPABILITIES.PAYROLL);
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "";

  const payRuns = await db.payRun.findMany({
    where: { companyId: company.id, ...(status ? { status } : {}) },
    include: { lines: { select: { netPayCents: true } } },
    orderBy: { payDate: "desc" },
    take: 100,
  });

  const counts = {
    draft: payRuns.filter((p) => p.status === "DRAFT").length,
    posted: payRuns.filter((p) => p.status === "POSTED").length,
    void: payRuns.filter((p) => p.status === "VOID").length,
  };

  return (
    <>
      <PageHeader
        title="Pay runs"
        breadcrumb={[{ label: "Payroll" }, { label: "Pay runs" }]}
        description="CPP, EI and income tax are entered per employee, not calculated by this app. A posted pay run creates a real journal entry — wage expense, payroll liabilities, and net pay funded from the account you choose."
        actions={
          can(role, CAPABILITIES.PAYROLL) ? (
            <LinkButton href="/payroll/pay-runs/new" variant="primary">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New pay run
            </LinkButton>
          ) : undefined
        }
      />

      <FilterBar
        tabs={[
          { label: "All", value: "" },
          { label: "Draft", value: "DRAFT", count: counts.draft },
          { label: "Posted", value: "POSTED", count: counts.posted },
          { label: "Void", value: "VOID", count: counts.void },
        ]}
      />

      <Card className="p-5">
        <Table>
          <thead>
            <tr>
              <Th>Pay run</Th>
              <Th>Pay period</Th>
              <Th>Pay date</Th>
              <Th align="right">Employees</Th>
              <Th align="right">Net pay</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {payRuns.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="py-10 text-center text-muted-ink">
                  {status ? "No pay runs match this filter." : "No pay runs yet."}
                </Td>
              </Tr>
            ) : (
              payRuns.map((payRun) => (
                <Tr key={payRun.id}>
                  <Td><LinkCell href={`/payroll/pay-runs/${payRun.id}`}>{payRun.number}</LinkCell></Td>
                  <Td className="text-muted-ink">{formatDate(payRun.payPeriodStart)} – {formatDate(payRun.payPeriodEnd)}</Td>
                  <Td className="text-muted-ink">{formatDate(payRun.payDate)}</Td>
                  <Td align="right" className="tnum text-muted-ink">{payRun.lines.length}</Td>
                  <Td align="right" className="font-medium">
                    <Money cents={payRun.lines.reduce((s, l) => s + l.netPayCents, 0)} currency={company.baseCurrency} />
                  </Td>
                  <Td><Badge tone={STATUS_TONE[payRun.status] ?? "neutral"}>{payRun.status}</Badge></Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
