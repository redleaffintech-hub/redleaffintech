/**
 * Marketing-site primitives.
 *
 * The application primitives in `src/components/ui.tsx` are deliberately dense
 * — 13px type, tight leading, table-first. A marketing page needs a larger
 * scale, so it gets its own small set of components here. They consume the same
 * design tokens, so both halves of the product stay one visual system.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Icon } from "@/components/shell/icons";

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-[76rem] px-5 sm:px-8", className)}>{children}</div>;
}

export function Section({
  children,
  className,
  tone = "canvas",
  id,
}: {
  children: ReactNode;
  className?: string;
  tone?: "canvas" | "white" | "soft" | "ink";
  id?: string;
}) {
  const tones = {
    canvas: "bg-paper-200 text-ink-900",
    white: "bg-white text-ink-900",
    soft: "bg-brand-soft text-ink-900",
    ink: "bg-ink-950 text-white",
  } as const;
  return (
    <section id={id} className={clsx("py-16 sm:py-20 lg:py-24", tones[tone], className)}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "maple" | "light" }) {
  const tones = {
    brand: "text-brand-700",
    maple: "text-maple-600",
    light: "text-brand-200",
  } as const;
  return (
    <p className={clsx("text-[0.75rem] font-semibold uppercase tracking-[0.14em]", tones[tone])}>{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  tone = "dark",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <header
      className={clsx(
        align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl",
        className,
      )}
    >
      {eyebrow && <Eyebrow tone={tone === "light" ? "light" : "brand"}>{eyebrow}</Eyebrow>}
      <h2
        className={clsx(
          "font-display mt-3 text-[1.75rem] font-semibold leading-[1.18] tracking-[-0.02em] sm:text-[2.125rem]",
          tone === "light" ? "text-white" : "text-ink-950",
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={clsx(
            "mt-4 text-[1rem] leading-7",
            tone === "light" ? "text-ink-300" : "text-muted-ink",
          )}
        >
          {description}
        </p>
      )}
    </header>
  );
}

const CTA_STYLES = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-[0_1px_2px_rgba(30,70,100,0.28)]",
  secondary: "bg-white text-ink-800 border border-paper-400 hover:border-ink-300 hover:bg-paper-100",
  maple: "bg-maple-500 text-white hover:bg-maple-600 shadow-[0_1px_2px_rgba(142,25,25,0.3)]",
  onInk: "bg-white text-ink-900 hover:bg-paper-200",
  ghostOnInk: "border border-white/25 text-white hover:bg-white/10",
} as const;

export function Cta({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof CTA_STYLES;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        size === "lg" ? "px-5 py-3 text-[0.9375rem]" : "px-4 py-2.5 text-[0.875rem]",
        CTA_STYLES[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function FeatureCard({
  icon,
  title,
  children,
  badge,
  muted = false,
}: {
  icon: string;
  title: string;
  children: ReactNode;
  badge?: string;
  muted?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-(--radius-card) border p-5",
        muted ? "border-paper-300 bg-paper-100" : "border-paper-300 bg-white shadow-[0_1px_2px_rgba(38,50,56,0.04)]",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
            muted ? "bg-paper-300 text-ink-500" : "bg-brand-soft text-brand-700",
          )}
        >
          <Icon name={icon} className="h-[1.15rem] w-[1.15rem]" />
        </span>
        <h3 className={clsx("text-[0.9375rem] font-semibold", muted ? "text-ink-700" : "text-ink-900")}>{title}</h3>
        {badge && (
          <span className="ml-auto shrink-0 rounded-full bg-paper-200 px-2 py-0.5 text-[0.6875rem] font-medium text-ink-600">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-3 text-[0.875rem] leading-6 text-muted-ink">{children}</p>
    </div>
  );
}

export function CheckList({ items, tone = "dark" }: { items: string[]; tone?: "dark" | "light" }) {
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <Icon
            name="check"
            className={clsx("mt-0.5 h-4 w-4 shrink-0", tone === "light" ? "text-brand-400" : "text-positive")}
          />
          <span className={clsx("text-[0.9375rem] leading-6", tone === "light" ? "text-ink-300" : "text-ink-700")}>
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CtaBand({
  title,
  description,
  primary,
  secondary,
}: {
  title: string;
  description: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <Section tone="ink">
      <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <h2 className="font-display text-[1.625rem] font-semibold leading-[1.2] tracking-[-0.02em] text-white sm:text-[2rem]">
            {title}
          </h2>
          <p className="mt-3 text-[0.9375rem] leading-7 text-ink-300">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Cta href={primary.href} variant="onInk" size="lg">
            {primary.label}
          </Cta>
          {secondary && (
            <Cta href={secondary.href} variant="ghostOnInk" size="lg">
              {secondary.label}
            </Cta>
          )}
        </div>
      </div>
    </Section>
  );
}

export function PageHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-paper-300 bg-white">
      <Container className="py-14 sm:py-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="font-display mt-3 max-w-3xl text-[2.125rem] font-semibold leading-[1.12] tracking-[-0.03em] text-ink-950 sm:text-[2.75rem]">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-[1.0625rem] leading-8 text-muted-ink">{description}</p>
        {children && <div className="mt-8">{children}</div>}
      </Container>
    </div>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-(--radius-card) border border-paper-300 bg-white p-5">
      <p className="tnum font-display text-[1.75rem] font-semibold leading-none tracking-[-0.02em] text-brand-700">
        {value}
      </p>
      <p className="mt-2 text-[0.8125rem] leading-5 text-muted-ink">{label}</p>
    </div>
  );
}
