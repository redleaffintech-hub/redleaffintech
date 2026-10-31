"use client";

import { useState, useTransition } from "react";
import { Button, Card, CardHeader } from "@/components/ui";
import { importOpeningBalancesAction, type ImportResult } from "./actions";

const money = (cents: number) => (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

export function ImportCard({
  kind, title, subtitle, templateHref, partyLabel, note,
}: {
  kind: "CUSTOMER" | "VENDOR";
  title: string;
  subtitle: string;
  templateHref: string;
  partyLabel: string;
  note?: string;
}) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="mt-3 space-y-3 text-sm">
        <p>
          <a href={templateHref} className="font-medium underline">Download the CSV template</a>, fill in one row per {partyLabel}, then upload it.
          Columns: Name, Email, Phone, Address Line 1, Address Line 2, City, Province, Postal Code, Opening Balance, As of Date (YYYY-MM-DD).
          {kind === "CUSTOMER" && " The shipping address is set the same as the billing address."}
          {note ? ` ${note}` : ""}
        </p>
        <form
          action={(formData) => {
            setResult(null);
            start(async () => setResult(await importOpeningBalancesAction(formData)));
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <input type="hidden" name="kind" value={kind} />
          <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
          <Button type="submit" disabled={pending}>{pending ? "Importing…" : "Upload & import"}</Button>
        </form>

        {result && "error" in result && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
            <p className="font-medium">{result.error}</p>
            {result.rowErrors && (
              <ul className="mt-2 list-disc pl-5">
                {result.rowErrors.map((e, i) => (<li key={i}>Row {e.line}: {e.message}</li>))}
              </ul>
            )}
          </div>
        )}
        {result && "ok" in result && (
          <div role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900">
            <p className="font-medium">
              Imported {result.created.length} {partyLabel}{result.created.length === 1 ? "" : "s"} — total{" "}
              {money(result.created.reduce((s, c) => s + c.amountCents, 0))}.
            </p>
            {result.failed.length > 0 && (
              <div className="mt-2 text-red-800">
                <p className="font-medium">{result.failed.length} row(s) need attention:</p>
                <ul className="list-disc pl-5">
                  {result.failed.map((f, i) => (<li key={i}>Row {f.line} ({f.name}): {f.message}</li>))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
