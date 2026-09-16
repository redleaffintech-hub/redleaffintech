"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, LinkButton, inputClass } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { Dialog } from "../../invoices/[id]/invoice-actions";
import { convertQuoteAction } from "../actions";

/**
 * Edit / convert-to-invoice / print (issue 11, 15 Sep 2026 review). Convert
 * offers the ordinary draft/issue choice and shows the invoice dates before
 * committing, per the spec's explicit requirement.
 */
export function QuoteActions({
  quoteId,
  status,
  convertedInvoiceId,
  canEdit,
}: {
  quoteId: string;
  status: string;
  convertedInvoiceId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10),
  );
  const [post, setPost] = useState(true);

  if (status === "CONVERTED") {
    return (
      <div className="no-print flex flex-wrap items-center gap-2">
        {convertedInvoiceId && (
          <LinkButton href={`/sales/invoices/${convertedInvoiceId}`} variant="primary">
            View invoice
          </LinkButton>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 transition-colors hover:bg-paper-100"
        >
          <Icon name="download" className="h-3.5 w-3.5" />
          Print / PDF
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="no-print flex flex-wrap items-center gap-2">
        {canEdit && <LinkButton href={`/sales/quotes/${quoteId}/edit`}>Edit</LinkButton>}
        {status !== "DECLINED" && status !== "EXPIRED" && (
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            Convert to invoice
          </Button>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 transition-colors hover:bg-paper-100"
        >
          <Icon name="download" className="h-3.5 w-3.5" />
          Print / PDF
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      {dialogOpen && (
        <Dialog title="Convert to invoice" onClose={() => setDialogOpen(false)}>
          <div className="space-y-3">
            <p className="text-[0.8125rem] leading-6 text-ink-700">
              Creates a new invoice with this quote&apos;s customer, lines, discounts and terms. The quote is then marked
              converted and cannot be edited further.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice date" required>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(event) => setIssueDate(event.target.value)}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="Due date" required>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className={inputClass}
                  required
                />
              </Field>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-paper-300 p-3">
              <input
                type="checkbox"
                checked={post}
                onChange={(event) => setPost(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
              />
              <span className="text-[0.8125rem] leading-5 text-ink-800">
                Post to the ledger immediately
                <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
                  Leave unchecked to create it as a draft invoice — nothing posts until you post it separately.
                </span>
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setDialogOpen(false)} disabled={pending}>Cancel</Button>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await convertQuoteAction(quoteId, { issueDate, dueDate, post });
                    if (result?.error) setError(result.error);
                    else if (result?.invoiceId) router.push(`/sales/invoices/${result.invoiceId}`);
                  })
                }
              >
                {pending ? "Converting…" : "Convert"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
