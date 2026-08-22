"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { inputClass } from "@/components/ui";

export function AccountPicker({
  accounts,
  value,
}: {
  accounts: { id: string; code: string; name: string; type: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(next: string) {
    const search = new URLSearchParams(params.toString());
    if (next) search.set("account", next);
    else search.delete("account");
    startTransition(() => router.replace(`${pathname}?${search.toString()}`, { scroll: false }));
  }

  return (
    <select
      value={value}
      onChange={(event) => apply(event.target.value)}
      className={clsx(inputClass, "w-auto min-w-[16rem] pr-8", pending && "opacity-70")}
      aria-label="Account"
    >
      <option value="">All accounts with activity</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.code} · {account.name}
        </option>
      ))}
    </select>
  );
}
