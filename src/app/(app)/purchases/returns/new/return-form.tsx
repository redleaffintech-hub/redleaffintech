"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, Table, Td, Th, Tr, inputClass } from "@/components/ui";
import { useMoney } from "@/components/currency-context";
import { createPurchaseReturnAction } from "../actions";

interface ReturnableLine {
  id: string;
  description: string;
  itemCode: string | null;
  quantityMilli: number;
  remainingMilli: number;
  unitPriceCents: number;
  netCents: number;
}

/** Pick quantities to return to a vendor from a specific posted bill (issue
 * 4) — stock reduction (original receipt cost) and any credit-vs-book-value
 * variance both happen server-side; this form only chooses lines/quantities. */
export function PurchaseReturnForm({
  billId,
  billNumber,
  lines,
}: {
  billId: string;
  billNumber: string;
  lines: ReturnableLine[];
}) {
  const money = useMoney();
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const requested = lines
    .map((line) => ({ line, qty: Number(quantities[line.id]) || 0 }))
    .filter((r) => r.qty > 0);

  function submit() {
    setError(null);
    if (requested.length === 0) return setError("Enter a quantity to return on at least one line.");
    for (const r of requested) {
      if (r.qty > r.line.remainingMilli / 1000) {
        return setError(`Only ${r.line.remainingMilli / 1000} unit(s) of "${r.line.description}" remain returnable.`);
      }
    }
    startTransition(async () => {
      const result = await createPurchaseReturnAction(
        JSON.stringify({
          billId,
          issueDate,
          reason,
          returns: requested.map((r) => ({ billLineId: r.line.id, quantity: r.qty })),
        }),
      );
      if (result?.error) setError(result.error);
      else if (result?.redirectTo) router.push(result.redirectTo);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Return date" required>
          <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} className={inputClass} required />
        </Field>
        <Field label="Reason">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={inputClass}
            placeholder="Damaged, wrong item, over-shipped…"
          />
        </Field>
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Line</Th>
            <Th width="6rem" align="right">Received</Th>
            <Th width="7rem" align="right">Remaining</Th>
            <Th width="8rem" align="right">Return qty</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <Tr key={line.id}>
              <Td>
                <span className="font-medium text-ink-900">
                  {line.itemCode ? `${line.itemCode} · ` : ""}
                  {line.description}
                </span>
                <span className="block text-[0.75rem] text-muted-ink">{money.format(line.unitPriceCents)} each</span>
              </Td>
              <Td align="right" className="tnum">{line.quantityMilli / 1000}</Td>
              <Td align="right" className="tnum">{line.remainingMilli / 1000}</Td>
              <Td align="right">
                <input
                  value={quantities[line.id] ?? ""}
                  onChange={(event) => setQuantities((c) => ({ ...c, [line.id]: event.target.value }))}
                  disabled={line.remainingMilli <= 0}
                  inputMode="decimal"
                  placeholder="0"
                  className={clsx(inputClass, "tnum text-right", line.remainingMilli <= 0 && "opacity-40")}
                />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      {error && (
        <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button variant="primary" onClick={submit} disabled={pending}>
          {pending ? "Creating…" : `Create return against ${billNumber}`}
        </Button>
      </div>
    </div>
  );
}
