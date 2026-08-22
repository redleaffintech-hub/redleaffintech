"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { changePlanAction } from "../actions";

export function PlanPicker({
  plan,
  planName,
  seats,
  isCurrent,
  seatsUsed,
}: {
  plan: string;
  planName: string;
  seats: number;
  isCurrent: boolean;
  seatsUsed: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const tooSmall = seatsUsed > seats;

  if (isCurrent) {
    return (
      <Button disabled className="w-full">
        Current plan
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        className="w-full"
        disabled={pending || tooSmall}
        title={tooSmall ? `${seatsUsed} people already have access — ${planName} includes ${seats} seats.` : undefined}
        onClick={() =>
          startTransition(async () => {
            const result = await changePlanAction(plan);
            if (result?.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Switching…" : tooSmall ? "Too few seats" : `Switch to ${planName}`}
      </Button>
      {error && <p className="mt-1.5 text-[0.75rem] leading-4 text-negative">{error}</p>}
    </>
  );
}
