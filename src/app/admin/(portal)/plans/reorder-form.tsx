"use client";

import { AdminForm, adminInputClass, SubmitButton } from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import { reorderPlansAction } from "./actions";

/**
 * Reordering the pricing cards.
 *
 * Numbers in boxes rather than drag-and-drop: the order has to survive a
 * keyboard, a screen reader and a phone, and a "10, 20, 30" convention lets
 * somebody slot a new plan between two others without renumbering the rest.
 *
 * Ordering is a publication control, so it takes effect on the public page
 * immediately — no publish step.
 */
export function ReorderForm({
  csrfToken,
  plans,
}: {
  csrfToken: string;
  plans: { id: string; name: string; sortOrder: number }[];
}) {
  return (
    <AdminCard title="Display order" subtitle="Lower numbers appear first. Applies to the public page immediately.">
      <AdminForm action={reorderPlansAction} csrfToken={csrfToken}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <div key={plan.id}>
              <input type="hidden" name="planId" value={plan.id} />
              <label
                htmlFor={`order-${plan.id}`}
                className="mb-1 block text-[0.75rem] font-medium text-ink-800"
              >
                {plan.name}
              </label>
              <input
                id={`order-${plan.id}`}
                name={`sortOrder_${plan.id}`}
                type="number"
                min={0}
                step={10}
                defaultValue={plan.sortOrder}
                className={adminInputClass}
              />
            </div>
          ))}
        </div>
        <div className="mt-4">
          <SubmitButton tone="secondary">Save order</SubmitButton>
        </div>
      </AdminForm>
    </AdminCard>
  );
}
