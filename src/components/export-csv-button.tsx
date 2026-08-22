"use client";

import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/shell/icons";

/**
 * CSV download, styled to sit beside `PrintButton` as one toolbar group.
 *
 * It is a plain link to a server route, not a client-side serialiser, and that
 * is deliberate:
 *
 *  - The company is resolved from the session on the server. Nothing here sends
 *    a company id, so nothing here can ask for another tenant's data.
 *  - The export re-runs the same report the page ran, so it contains the whole
 *    filtered result set rather than the page of rows that happen to be in the
 *    DOM.
 *
 * The current query string is forwarded verbatim, which is what keeps the file
 * matching what the reader is looking at: same period, same filters, same
 * search. The server validates it again regardless.
 */
export function ExportCsvButton({
  report,
  label = "Export CSV",
  params: extra,
}: {
  /** Registry key in src/server/reports/exports.ts. */
  report: string;
  label?: string;
  /** Extra parameters not in the URL, e.g. the id of the record being viewed. */
  params?: Record<string, string>;
}) {
  const searchParams = useSearchParams();

  const query = new URLSearchParams(searchParams.toString());
  for (const [key, value] of Object.entries(extra ?? {})) query.set(key, value);
  const suffix = query.toString();

  return (
    <a
      href={`/api/export/${report}${suffix ? `?${suffix}` : ""}`}
      // The response is an attachment, so the browser downloads rather than
      // navigates; no `download` attribute is needed and adding one would
      // override the server's filename.
      className="no-print inline-flex items-center gap-1.5 rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 transition-colors hover:bg-paper-100"
    >
      <Icon name="download" className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}
