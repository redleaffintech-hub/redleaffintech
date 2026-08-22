import Image from "next/image";
import Link from "next/link";
import { MODULE_CATALOG } from "@/lib/plans";
import { Container } from "./ui";

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Platform",
    links: [
      { label: "Products", href: "/products" },
      { label: "Red Leaf Accounting", href: "/products/accounting" },
      { label: "Pricing", href: "/pricing" },
      { label: "Solutions", href: "/solutions" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About Us", href: "/about" },
      { label: "Resources", href: "/resources" },
      { label: "Contact Us", href: "/contact" },
      { label: "Sign in", href: "/login" },
    ],
  },
];

export function SiteFooter() {
  const year = new Date().getUTCFullYear();

  return (
    <footer className="border-t border-ink-800 bg-ink-950">
      <Container className="py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" aria-label="Red Leaf Fintech home">
              <Image
                src="/brand/lockup-dark.png"
                alt="Red Leaf Fintech"
                width={1000}
                height={256}
                className="h-9 w-auto"
              />
            </Link>
            <p className="mt-5 max-w-sm text-[0.875rem] leading-6 text-ink-400">
              One platform for accounting, payroll, HR, tax, payments, banking and inventory. Built in Canada,
              for Canadian businesses and the accountants who serve them.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h3 className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-500">
                {column.heading}
              </h3>
              <ul className="mt-4 grid gap-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-[0.875rem] text-ink-300 transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-500">Modules</h3>
            <ul className="mt-4 grid gap-2.5">
              {MODULE_CATALOG.map((module) => (
                <li key={module.id} className="text-[0.875rem] text-ink-300">
                  {module.name.replace("Red Leaf ", "")}
                  {!module.available && <span className="ml-1.5 text-[0.6875rem] text-ink-500">soon</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-ink-800 pt-6 text-[0.75rem] leading-5 text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Red Leaf Fintech Inc. All rights reserved.</p>
          <p className="max-w-xl sm:text-right">
            Red Leaf Accounting is accounting software, not tax advice. Canadian rates and filing obligations
            vary by province and registration — have a qualified CPA review your setup before filing.
          </p>
        </div>
      </Container>
    </footer>
  );
}
