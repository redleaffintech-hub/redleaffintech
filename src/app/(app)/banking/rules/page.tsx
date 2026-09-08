import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { RuleForm, DeleteRuleButton } from "./rule-form";
import { bankingOptions } from "../actions";

export const metadata = { title: "Bank rules" };

export default async function BankRulesPage() {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  const { accounts, taxCodes } = await bankingOptions();

  const rules = await db.bankRule.findMany({
    where: { companyId: company.id },
    include: { setAccount: true, setTaxCode: true, setVendor: true, bankAccount: true },
    orderBy: { priority: "asc" },
  });

  return (
    <>
      <PageHeader
        title="Categorisation rules"
        breadcrumb={[{ label: "Bank Reconciliation", href: "/banking" }, { label: "Rules" }]}
        description="Rules pre-fill the review queue. They suggest an account and tax code; nothing posts until you confirm, unless a rule is set to auto-confirm."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        <Card className="p-5">
          <CardHeader title="Rules" subtitle={`${rules.length} configured — evaluated in priority order`} />
          {rules.length === 0 ? (
            <EmptyState title="No rules yet" description="Add a rule to stop categorising the same vendor every month." />
          ) : (
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th width="3.5rem">Order</Th>
                  <Th>Rule</Th>
                  <Th width="8rem">When</Th>
                  <Th width="13rem">Then post to</Th>
                  <Th width="6rem" align="right">Used</Th>
                  <Th width="4rem" />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <Tr key={rule.id}>
                    <Td className="tnum text-muted-ink">{rule.priority}</Td>
                    <Td>
                      <span className="font-medium text-ink-900">{rule.name}</span>
                      <span className="block text-[0.75rem] text-muted-ink">
                        description {rule.matchType.replace(/_/g, " ").toLowerCase()} &ldquo;{rule.matchValue}&rdquo;
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={rule.direction === "IN" ? "positive" : rule.direction === "OUT" ? "neutral" : "info"}>
                        {rule.direction === "ANY" ? "any" : rule.direction === "IN" ? "money in" : "money out"}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="text-ink-800">
                        {rule.setAccount.code} · {rule.setAccount.name}
                      </span>
                      <span className="block text-[0.75rem] text-muted-ink">
                        {rule.setTaxCode?.code ?? "no tax"}
                        {rule.autoConfirm && " · auto-confirms"}
                      </span>
                    </Td>
                    <Td align="right" className="tnum text-muted-ink">{rule.timesApplied}</Td>
                    <Td><DeleteRuleButton ruleId={rule.id} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}

          <p className="mt-4 text-[0.75rem] leading-5 text-muted-ink">
            Auto-confirming rules still create a normal, reversible journal entry and appear in the audit log — an
            automated posting is never invisible.
          </p>
        </Card>

        <RuleForm accounts={accounts} taxCodes={taxCodes} />
      </div>
    </>
  );
}
