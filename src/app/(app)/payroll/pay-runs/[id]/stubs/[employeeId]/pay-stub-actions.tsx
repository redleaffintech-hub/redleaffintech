"use client";

import { Button } from "@/components/ui";

export function PayStubActions({ pdfHref }: { pdfHref: string }) {
  return (
    <div className="no-print flex items-center gap-2">
      <a
        href={pdfHref}
        download
        className="inline-flex items-center rounded-md bg-brand-700 px-3 py-1.5 text-[0.8125rem] font-medium text-white hover:bg-brand-800"
      >
        Download PDF
      </a>
      <Button variant="secondary" onClick={() => window.print()}>Print</Button>
    </div>
  );
}
