import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { ExpenseForm } from "./expense-form";
import { expenseFormOptions } from "../actions";

export const metadata = { title: "New expense" };

export default async function NewExpensePage() {
  await requireCapability(CAPABILITIES.EXPENSES);
  const options = await expenseFormOptions();

  return (
    <>
      <PageHeader
        title="New expense"
        breadcrumb={[{ label: "Expenses", href: "/expenses" }, { label: "New" }]}
        description="For money paid directly by card, debit or cash. If a supplier invoiced you and you will pay later, record a bill instead so the payable is tracked."
      />
      <ExpenseForm {...options} />
    </>
  );
}
