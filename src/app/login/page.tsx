import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listAllUsers } from "@/server/db/users";
import { listMembershipsForUser } from "@/server/db/company-users";
import { getCompany } from "@/server/db/companies";
import { getCurrentUser } from "@/server/auth/context";
import { Icon } from "@/components/shell/icons";
import { LoginForm } from "./login-form";
import type { CompanyRole } from "@/lib/enums";

export const metadata = { title: "Sign in" };

/**
 * The seeded demo accounts are only ever listed when DEMO_ACCOUNTS=1 — this is
 * a public sign-in page and enumerating users would leak every customer's
 * name, email and company.
 */
const SHOW_DEMO_ACCOUNTS = process.env.DEMO_ACCOUNTS === "1";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  const demoUsers = SHOW_DEMO_ACCOUNTS
    ? await Promise.all(
        (await listAllUsers()).map(async (u) => {
          const memberships = await listMembershipsForUser(u.id);
          const companyUsers = await Promise.all(
            memberships.map(async (m) => ({
              role: m.role,
              company: { name: (await getCompany(m.companyId))?.name ?? "No company" },
            })),
          );
          return { email: u.email, name: u.name, companyUsers };
        }),
      )
    : [];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-950 p-10 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 12%, #c62828 0, transparent 42%), radial-gradient(circle at 82% 78%, #3b82b6 0, transparent 46%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />

        <Link href="/" className="relative w-fit">
          <Image src="/brand/lockup-dark.png" alt="Red Leaf Fintech" width={1000} height={256} className="h-11 w-auto" priority />
        </Link>

        <div className="relative max-w-lg">
          <h1 className="font-display text-[2.5rem] font-semibold leading-[1.12] tracking-[-0.03em] text-white">
            Books your accountant
            <br />
            can actually trust.
          </h1>
          <p className="mt-5 text-[0.9375rem] leading-7 text-ink-300">
            Red Leaf Accounting runs on a real double-entry ledger. Every invoice, bill, expense and bank
            line posts a balanced journal entry — and every figure on every report drills straight back to
            it.
          </p>

          <ul className="mt-8 grid gap-3 text-[0.875rem] text-ink-300">
            {[
              "GST/HST, PST, RST and QST as an effective-dated engine — never hard-coded rates",
              "Bank feeds, rules, matching and a reconciliation that must reach zero",
              "Period close, year-end and an immutable audit trail",
              "Multi-company access, with a separate workspace for accounting firms",
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-maple-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[0.75rem] leading-5 text-ink-500">
          Canadian tax rules vary by province, registration and transaction type — a qualified CPA should
          validate the tax engine and chart of accounts before any filing use.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 block w-fit lg:hidden">
            <Image src="/brand/lockup.png" alt="Red Leaf Fintech" width={1000} height={256} className="h-9 w-auto" priority />
          </Link>

          <h2 className="text-[1.5rem] font-semibold tracking-[-0.02em] text-ink-950">Sign in</h2>
          <p className="mt-1 text-[0.875rem] text-muted-ink">Welcome back. Pick up where the books left off.</p>

          <LoginForm
            demoAccounts={demoUsers.map((u) => ({
              email: u.email,
              name: u.name,
              description:
                u.companyUsers.length > 1
                  ? `${u.companyUsers.length} companies · ${u.companyUsers[0].role.toLowerCase()}`
                  : (u.companyUsers[0]?.company.name ?? "No company"),
              role: (u.companyUsers[0]?.role ?? "PRIMARY") as CompanyRole,
            }))}
          />

          <p className="mt-8 border-t border-paper-300 pt-6 text-[0.8125rem] text-muted-ink">
            New to Red Leaf?{" "}
            <Link href="/pricing" className="font-medium text-brand-700 hover:underline">
              Choose a plan
            </Link>{" "}
            to create an account.
          </p>
        </div>
      </div>
    </div>
  );
}
