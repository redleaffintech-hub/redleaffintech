import { NextResponse } from "next/server";
import { requireCompany } from "@/server/auth/context";
import { formatMoney } from "@/lib/money";
import { listCustomers } from "@/server/db/customers";
import { listVendors } from "@/server/db/vendors";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { bills as billsRepo } from "@/server/db/bills";
import { listAccounts } from "@/server/db/accounts";

/**
 * ⌘K search. Scoped to the caller's active company on the server — a company id
 * is never accepted from the client (§3, §27). Firestore has no text search, so
 * each collection is read and matched in memory.
 */
export async function GET(request: Request) {
  const { company } = await requireCompany();
  const currency = company.baseCurrency;
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json([]);
  const q = query.toLowerCase();

  const [allCustomers, allVendors, allInvoices, allBills, allAccounts] = await Promise.all([
    listCustomers(company.id),
    listVendors(company.id),
    invoicesRepo.list(company.id),
    billsRepo.list(company.id),
    listAccounts(company.id),
  ]);

  const customerName = new Map(allCustomers.map((c) => [c.id, c.name]));
  const vendorName = new Map(allVendors.map((v) => [v.id, v.name]));

  const customers = allCustomers.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 4);
  const vendors = allVendors.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 3);
  const invoices = allInvoices
    .filter(
      (i) =>
        i.number.toLowerCase().includes(q) ||
        (customerName.get(i.customerId) ?? "").toLowerCase().includes(q),
    )
    .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())
    .slice(0, 5);
  const bills = allBills
    .filter(
      (b) =>
        b.number.toLowerCase().includes(q) ||
        (vendorName.get(b.vendorId) ?? "").toLowerCase().includes(q),
    )
    .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime())
    .slice(0, 4);
  const accounts = allAccounts
    .filter((a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q))
    .slice(0, 4);

  return NextResponse.json([
    ...invoices.map((i) => ({
      type: "Invoice",
      label: `${i.number} — ${customerName.get(i.customerId) ?? "—"}`,
      sublabel: i.status.replace(/_/g, " ").toLowerCase(),
      href: `/sales/invoices/${i.id}`,
      amount: formatMoney(i.totalCents, { currency }),
    })),
    ...bills.map((b) => ({
      type: "Bill",
      label: `${b.number} — ${vendorName.get(b.vendorId) ?? "—"}`,
      sublabel: b.status.replace(/_/g, " ").toLowerCase(),
      href: `/purchases/bills/${b.id}`,
      amount: formatMoney(b.totalCents, { currency }),
    })),
    ...customers.map((c) => ({
      type: "Customer",
      label: c.name,
      sublabel: c.email ?? "Customer record",
      href: `/sales/customers/${c.id}`,
    })),
    ...vendors.map((v) => ({
      type: "Vendor",
      label: v.name,
      sublabel: "Vendor record",
      href: `/purchases/vendors/${v.id}`,
    })),
    ...accounts.map((a) => ({
      type: "Account",
      label: `${a.code} · ${a.name}`,
      sublabel: `${a.type.toLowerCase()} — open ledger`,
      href: `/accounting/general-ledger?account=${a.id}`,
    })),
  ]);
}
