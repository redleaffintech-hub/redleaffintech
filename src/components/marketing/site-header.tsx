"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Icon } from "@/components/shell/icons";
import { Container, Cta } from "./ui";

/** The client's requested main navigation, in their order. */
export const SITE_NAV = [
  { label: "Home", href: "/" },
  { label: "About Us", href: "/about" },
  { label: "Products", href: "/products" },
  { label: "Pricing", href: "/pricing" },
  { label: "Solutions", href: "/solutions" },
  { label: "Resources", href: "/resources" },
  { label: "Contact Us", href: "/contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-paper-300 bg-white/92 backdrop-blur-md">
      <Container className="flex h-16 items-center gap-6">
        <Link href="/" className="shrink-0" aria-label="Red Leaf Fintech home">
          <Image src="/brand/lockup.png" alt="Red Leaf Fintech" width={1000} height={256} className="h-8 w-auto" priority />
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
          {SITE_NAV.slice(1).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "rounded-md px-3 py-2 text-[0.875rem] font-medium transition-colors",
                isActive(item.href) ? "bg-brand-soft text-brand-700" : "text-ink-700 hover:bg-paper-200 hover:text-ink-900",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-[0.875rem] font-medium text-ink-700 transition-colors hover:text-brand-700"
          >
            Login
          </Link>
          <Cta href="/pricing">Get Started</Cta>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="ml-auto grid h-10 w-10 place-items-center rounded-md border border-paper-300 text-ink-700 lg:hidden"
        >
          <Icon name={open ? "x" : "menu"} className="h-5 w-5" />
        </button>
      </Container>

      {open && (
        <div className="border-t border-paper-300 bg-white lg:hidden">
          <Container className="grid gap-1 py-4">
            {SITE_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={clsx(
                  "rounded-md px-3 py-2.5 text-[0.9375rem] font-medium",
                  isActive(item.href) ? "bg-brand-soft text-brand-700" : "text-ink-700",
                )}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 grid gap-2 border-t border-paper-300 pt-4">
              <Cta href="/login" variant="secondary">
                Login
              </Cta>
              <Cta href="/pricing">Get Started</Cta>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
