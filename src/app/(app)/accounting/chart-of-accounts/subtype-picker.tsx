"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { subtypeLabel } from "@/lib/enums";
import { reclassifyAccountAction } from "./actions";

/**
 * Inline classification control on the chart of accounts.
 *
 * Rendered as the subtype cell rather than behind an edit screen: the whole
 * point is to let someone scan the expense accounts and spot the one that is
 * sitting on the wrong side of EBITDA, so changing it has to be possible right
 * there in the list.
 */
export function SubtypePicker({
  accountId,
  subtype,
  options,
  disabled,
}: {
  accountId: string;
  subtype: string;
  options: string[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(subtype);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (disabled) {
    return <span className="text-[0.75rem] text-muted-ink">{subtypeLabel(subtype)}</span>;
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      <select
        aria-label="Account classification"
        value={value}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          const previous = value;
          setValue(next);
          setError(null);
          const data = new FormData();
          data.set("accountId", accountId);
          data.set("subtype", next);
          startTransition(async () => {
            const result = await reclassifyAccountAction(data);
            if (result?.error) {
              setValue(previous); // put the control back where it was
              setError(result.error);
            } else {
              router.refresh();
            }
          });
        }}
        className={clsx(
          "-ml-1 max-w-[11rem] cursor-pointer truncate rounded border border-transparent bg-transparent px-1 py-0.5",
          "text-[0.75rem] text-muted-ink transition-colors hover:border-paper-400 hover:bg-white",
          "focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600",
          pending && "opacity-60",
        )}
      >
        {options.map((option) => (
          <option key={option} value={option}>{subtypeLabel(option)}</option>
        ))}
      </select>
      {error && <span className="text-[0.6875rem] text-negative">{error}</span>}
    </span>
  );
}
