"use client";

import { Button } from "@/components/ui";

export function PayStubActions() {
  return (
    <div className="no-print flex items-center gap-2">
      <Button onClick={() => window.print()}>Print / PDF</Button>
    </div>
  );
}
