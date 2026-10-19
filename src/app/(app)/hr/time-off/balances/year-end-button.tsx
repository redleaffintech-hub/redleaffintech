"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { runLeaveYearEndAction } from "../policies/actions";

/** Runs the idempotent carry-forward / expiry job on demand; reports what it wrote. */
export function RunYearEndButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-[0.75rem] text-muted-ink">{message}</span>}
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await runLeaveYearEndAction();
          setBusy(false);
          setMessage(
            result.carried === 0 && result.expired === 0
              ? "Nothing new to process."
              : `${result.carried} carry-forward, ${result.expired} expiry record(s) written.`,
          );
          router.refresh();
        }}
      >
        {busy ? "Processing…" : "Run year-end processing"}
      </Button>
    </div>
  );
}
