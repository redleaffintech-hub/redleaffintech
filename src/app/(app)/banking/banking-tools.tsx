"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, inputClass } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { confirmTransfersAction, importAction } from "./actions";

export function TransferButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="primary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await confirmTransfersAction();
          router.refresh();
        })
      }
    >
      {pending ? "Recording…" : `Record ${count} as transfer${count === 1 ? "" : "s"}`}
    </Button>
  );
}

/** CSV / OFX import. Parsing happens server-side; this only reads the file. */
export function ImportPanel({
  bankAccounts,
}: {
  bankAccounts: { id: string; name: string; type: string; accountNumberMasked: string | null }[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; duplicates: number; warnings?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    const content = await file.text();
    const response = await importAction(bankAccountId, file.name, content);
    setBusy(false);
    if ("error" in response && response.error) setError(response.error);
    else if ("imported" in response) {
      setResult({ imported: response.imported ?? 0, duplicates: response.duplicates ?? 0, warnings: response.warnings });
      router.refresh();
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card>
      <CardHeader title="Import statement" subtitle="CSV or OFX/QFX from any Canadian bank" />

      <label className="mt-3 block">
        <span className="mb-1 block text-[0.75rem] font-medium text-ink-700">Account</span>
        <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} className={clsx(inputClass, "pr-8")}>
          {bankAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} {account.accountNumberMasked ?? ""}
            </option>
          ))}
        </select>
      </label>

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className="mt-3 rounded-lg border border-dashed border-paper-400 px-4 py-6 text-center"
      >
        <Icon name="download" className="mx-auto h-5 w-5 rotate-180 text-ink-300" />
        <p className="mt-2 text-[0.8125rem] text-ink-700">Drop a file here</p>
        <p className="mt-0.5 text-[0.75rem] text-muted-ink">or</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="mt-2 rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100 disabled:opacity-50"
        >
          {busy ? "Importing…" : "Choose file"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.ofx,.qfx,.txt"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </div>

      {result && (
        <div className="mt-3 rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">
          Imported {result.imported} transaction{result.imported === 1 ? "" : "s"}.
          {result.duplicates > 0 && ` ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped.`}
          {result.warnings && result.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-[0.75rem] opacity-90">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p className="mt-3 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      <p className="mt-3 text-[0.75rem] leading-5 text-muted-ink">
        Column headers are matched loosely: a single signed <span className="font-medium">Amount</span> column works, and
        so does a separate <span className="font-medium">Debit</span>/<span className="font-medium">Credit</span> pair.
        Re-importing an overlapping date range is safe — duplicates are detected and skipped.
      </p>
    </Card>
  );
}
