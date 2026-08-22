import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompany } from "@/server/auth/context";
import { formatMoney } from "@/lib/money";
import { contains } from "@/lib/search";

/**
 * ⌘K search. Scoped to the caller's active company on the server — a company id
 * is never accepted from the client (§3, §27).
 */
export async function GET(request: Request) {
  const { company } = await requireCompany();
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json([]);

  const [customers, vendors, invoices, bills, accounts] = await Promise.all([
    db.customer.findMany({
      where: { companyId: company.id, name: contains(query) },
      take: 4,
      select: { id: true, name: true, email: true },
    }),
    db.vendor.findMany({
      where: { companyId: company.id, name: contains(query) },
      take: 3,
      select: { id: true, name: true },
    }),
    db.invoice.findMany({
      where: {
        companyId: company.id,
        OR: [{ number: contains(query) }, { customer: { name: contains(query) } }],
      },
      take: 5,
      orderBy: { issueDate: "desc" },
      select: { id: true, number: true, totalCents: true, status: true, customer: { select: { name: true } } },
    }),
    db.bill.findMany({
      where: {
        companyId: company.id,
        OR: [{ number: contains(query) }, { vendor: { name: contains(query) } }],
      },
      take: 4,
      orderBy: { issueDate: "desc" },
      select: { id: true, number: true, totalCents: true, status: true, vendor: { select: { name: true } } },
    }),
    db.account.findMany({
      where: { companyId: company.id, OR: [{ name: contains(query) }, { code: contains(query) }] },
      take: 4,
      select: { id: true, code: true, name: true, type: true },
    }),
  ]);

  return NextResponse.json([
    ...invoices.map((i) => ({
      type: "Invoice",
      label: `${i.number} — ${i.customer.name}`,
      sublabel: i.status.replace(/_/g, " ").toLowerCase(),
      href: `/sales/invoices/${i.id}`,
      amount: formatMoney(i.totalCents),
    })),
    ...bills.map((b) => ({
      type: "Bill",
      label: `${b.number} — ${b.vendor.name}`,
      sublabel: b.status.replace(/_/g, " ").toLowerCase(),
      href: `/purchases/bills/${b.id}`,
      amount: formatMoney(b.totalCents),
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
