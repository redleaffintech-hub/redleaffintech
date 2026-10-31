"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { MAX_EXTRA_USERS_PER_REQUEST, SEAT_REQUEST_STATUS_LABELS, extraChargeCents } from "@/lib/seats";
import { cancelSeatRequestAction, requestExtraUsersAction } from "./seat-actions";

const money = (cents: number) => (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

export interface SeatRequestRow {
  id: string;
  extraUsers: number;
  totalCents: number;
  status: string;
  createdAt: string;
  decisionNote: string | null;
}

/**
 * "Need more than the default users?" — shows the charge BEFORE the company
 * submits, and then the state of its requests. Submitting only records a request;
 * nothing changes until a platform administrator approves it.
 */
export function SeatRequestCard({
  limit, used, unitPriceCents, requests,
}: {
  limit: number;
  used: number;
  unitPriceCents: number;
  requests: SeatRequestRow[];
}) {
  const router = useRouter();
  const [count, setCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const hasPending = requests.some((r) => r.status === "PENDING");
  const valid = Number.isInteger(count) && count >= 1 && count <= MAX_EXTRA_USERS_PER_REQUEST;

  return (
    <Card>
      <CardHeader title="Need more users?" subtitle={`${used} of ${limit} in use`} />
      <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
        Each company includes 2 users: the owner/admin and an accountant. More users cost {money(unitPriceCents)} per user
        per month and need approval from Red Leaf before they can be added.
      </p>

      {!hasPending && (
        <form
          action={(fd) => {
            setError(null);
            setSent(false);
            start(async () => {
              const res = await requestExtraUsersAction(fd);
              if ("error" in res && res.error) setError(res.error);
              else {
                setSent(true);
                router.refresh();
              }
            });
          }}
          className="mt-3 space-y-3"
        >
          <Field label="Additional users" required>
            <input
              name="extraUsers" type="number" min={1} max={MAX_EXTRA_USERS_PER_REQUEST} value={Number.isNaN(count) ? "" : count}
              onChange={(e) => setCount(e.target.valueAsNumber)} className={inputClass} required
            />
          </Field>
          <div className="rounded-lg bg-paper-100 p-3 text-[0.8125rem]">
            <div className="flex justify-between"><span>Total users after approval</span><span className="tnum">{valid ? limit + count : "—"}</span></div>
            <div className="flex justify-between font-medium">
              <span>Additional charge</span>
              <span className="tnum">{valid ? `${money(extraChargeCents(count, unitPriceCents))} / month` : "—"}</span>
            </div>
          </div>
          <Field label="Note for the administrator">
            <textarea name="note" rows={2} maxLength={500} className={inputClass} placeholder="Optional" />
          </Field>
          {error && <p role="alert" className="text-[0.8125rem] text-red-700">{error}</p>}
          {sent && <p role="status" className="text-[0.8125rem] text-green-800">Request sent for approval.</p>}
          <Button type="submit" disabled={pending || !valid}>{pending ? "Sending…" : "Submit request"}</Button>
        </form>
      )}
      {hasPending && <p className="mt-3 text-[0.8125rem] font-medium">You have a request waiting for approval.</p>}

      {requests.length > 0 && (
        <ul className="mt-4 divide-y divide-paper-300 border-t border-paper-300 text-[0.8125rem]">
          {requests.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
              <div>
                <div className="font-medium">+{r.extraUsers} user{r.extraUsers === 1 ? "" : "s"} · {money(r.totalCents)}/mo</div>
                <div className="text-muted-ink">{new Date(r.createdAt).toLocaleDateString("en-CA")}{r.decisionNote ? ` — ${r.decisionNote}` : ""}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={r.status === "APPROVED" ? "positive" : r.status === "PENDING" ? "info" : "negative"}>
                  {SEAT_REQUEST_STATUS_LABELS[r.status] ?? r.status}
                </Badge>
                {r.status === "PENDING" && (
                  <button
                    type="button" className="text-[0.75rem] underline"
                    onClick={() => start(async () => { await cancelSeatRequestAction(r.id); router.refresh(); })}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
