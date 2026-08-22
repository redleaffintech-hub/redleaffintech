import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Page not found" };

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/products/accounting", label: "Red Leaf Accounting" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact us" },
];

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper-200 px-6 py-16">
      <div className="w-full max-w-lg text-center">
        <Link href="/" className="inline-block" aria-label="Red Leaf Fintech home">
          <Image src="/brand/lockup.png" alt="Red Leaf Fintech" width={1000} height={256} className="mx-auto h-9 w-auto" />
        </Link>

        <p className="tnum font-display mt-10 text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-brand-700">
          Error 404
        </p>
        <h1 className="font-display mt-3 text-[1.875rem] font-semibold leading-[1.15] tracking-[-0.02em] text-ink-950">
          We could not find that page
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-7 text-muted-ink">
          The link may be out of date, or the page may have moved. If you were signed in, your books are exactly
          where you left them.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex items-center gap-1.5 rounded-lg border border-paper-400 bg-white px-4 py-2.5 text-[0.875rem] font-medium text-ink-800 transition-colors hover:border-ink-300 hover:bg-paper-100"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <Link
          href="/login"
          className="mt-8 inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-brand-700 hover:underline"
        >
          Sign in to your account
          <Icon name="chevron" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
