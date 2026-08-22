"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { createRuleAction, deleteRuleAction } from "../actions";

export function RuleForm({
  accounts,
  taxCodes,
}: {
  accounts: { id: string; code: string; name: string; type: string }[];
  taxCodes: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Card>
      <CardHeader title="New rule" subtitle="Match on the bank description" />
      <form
        action={async (formData) => {
          setError(null);
          const result = await createRuleAction(formData);
          if (result?.error) setError(result.error);
          else {
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            router.refresh();
          }
        }}
        className="mt-3 space-y-3"
      >
        <Field label="Rule name" required>
          <input name="name" className={inputClass} placeholder="Atlas Cloud → Software" required />
        </Field>

        <div className="grid grid-cols-[8rem_1fr] gap-2">
          <Field label="Match">
            <select name="matchType" className={clsx(inputClass, "pr-7")} defaultValue="CONTAINS">
              <option value="CONTAINS">contains</option>
              <option value="STARTS_WITH">starts with</option>
              <option value="EQUALS">is exactly</option>
              <option value="REGEX">regex</option>
            </select>
          </Field>
          <Field label="Text" required>
            <input name="matchValue" className={inputClass} placeholder="ATLAS CLOUD" required />
          </Field>
        </div>

        <Field label="Direction">
          <select name="direction" className={clsx(inputClass, "pr-8")} defaultValue="OUT">
            <option value="ANY">Any transaction</option>
            <option value="OUT">Money out only</option>
            <option value="IN">Money in only</option>
          </select>
        </Field>

        <Field label="Post to account" required>
          <select name="setAccountId" className={clsx(inputClass, "pr-8")} required>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} · {account.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Tax code">
          <select name="setTaxCodeId" className={clsx(inputClass, "pr-8")}>
            <option value="">No tax</option>
            {taxCodes.map((code) => (
              <option key={code.id} value={code.id}>
                {code.code} — {code.name}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-paper-300 p-3">
          <input type="checkbox" name="autoConfirm" className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-brand-600)]" />
          <span className="text-[0.8125rem] leading-5 text-ink-800">
            Auto-confirm matching transactions
            <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
              Posts without review. Use only where the description is unambiguous, like a fixed monthly subscription.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
        {saved && <p className="rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">Rule saved.</p>}

        <Button type="submit" variant="primary" className="w-full">
          Create rule
        </Button>
      </form>
    </Card>
  );
}

export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await deleteRuleAction(ruleId);
          router.refresh();
        })
      }
      className="grid h-7 w-7 place-items-center rounded text-ink-400 transition-colors hover:bg-negative-soft hover:text-negative"
      aria-label="Delete rule"
    >
      <Icon name="x" className="h-3.5 w-3.5" />
    </button>
  );
}
