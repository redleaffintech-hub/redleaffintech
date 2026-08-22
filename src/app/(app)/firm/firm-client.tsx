"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Button, inputClass } from "@/components/ui";
import { firmClosePeriodAction, openClientAction } from "./actions";

/**
 * Every route into a client file goes through the server action, so the active
 * company is switched before the destination renders.
 */
export function OpenClient({
  companyId,
  href = "/",
  children,
  variant = "link",
}: {
  companyId: string;
  href?: string;
  children: React.ReactNode;
  variant?: "link" | "button";
}) {
  const [pending, startTransition] = useTransition();

  const open = () => startTransition(() => openClientAction(companyId, href));

  if (variant === "button") {
    return (
      <Button disabled={pending} onClick={open} className="text-[0.75rem]">
        {pending ? "Opening…" : children}
      </Button>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={open}
      className={clsx(
        "text-left font-medium text-ink-900 transition-colors hover:text-brand-700 hover:underline",
        pending && "opacity-60",
      )}
    >
      {children}
    </button>
  );
}

/** Client and period selectors for the close checklist, driven by the URL. */
export function ClosePicker({
  clients,
  periods,
  activeClient,
  activePeriod,
}: {
  clients: { id: string; name: string }[];
  periods: { id: string; name: string; status: string }[];
  activeClient: string;
  activePeriod: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key: string, value: string, clearPeriod = false) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    if (clearPeriod) next.delete("period");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <select
        value={activeClient}
        onChange={(event) => setParam("client", event.target.value, true)}
        aria-label="Client"
        className={clsx(inputClass, "w-auto pr-8")}
      >
        {clients.map((client) => (
          <option key={client.id} value={client.id}>{client.name}</option>
        ))}
      </select>

      <select
        value={activePeriod}
        onChange={(event) => setParam("period", event.target.value)}
        aria-label="Period"
        className={clsx(inputClass, "w-auto pr-8")}
      >
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {period.name}
            {period.status !== "OPEN" ? ` (${period.status.toLowerCase()})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ClosePeriodButton({
  companyId,
  periodId,
  periodName,
  readyToClose,
}: {
  companyId: string;
  periodId: string;
  periodName: string;
  readyToClose: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        disabled={pending || !readyToClose}
        title={readyToClose ? undefined : "Clear the failing checks first."}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await firmClosePeriodAction(companyId, periodId);
            if (result?.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Closing…" : `Close ${periodName}`}
      </Button>
      {error && <span className="text-[0.75rem] text-negative">{error}</span>}
    </div>
  );
}
