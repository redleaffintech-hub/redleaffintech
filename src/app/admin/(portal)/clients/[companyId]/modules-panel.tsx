"use client";

import { useState } from "react";
import { AdminForm, SubmitButton } from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import type { ModuleInfo } from "@/lib/plans";
import { updateClientModulesAction } from "../actions";

/**
 * Which products this client can use — independent of whatever their
 * assigned Plan's own module list says (see setClientModules in
 * server/admin/clients.ts). Enforced in the app: the sidebar hides a group
 * whose module isn't checked here, and the HR/Payroll/Inventory routes
 * redirect a direct hit on the URL too.
 */
export function ModulesPanel({
  csrfToken,
  companyId,
  modules,
  enabledModules,
}: {
  csrfToken: string;
  companyId: string;
  modules: ModuleInfo[];
  enabledModules: string[];
}) {
  const [selected, setSelected] = useState(new Set(enabledModules));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <AdminCard title="Modules" subtitle="What this client can use, regardless of what their plan includes">
      <AdminForm action={updateClientModulesAction} csrfToken={csrfToken}>
        <input type="hidden" name="companyId" value={companyId} />
        <div className="grid gap-2.5 sm:grid-cols-2">
          {modules.map((module) => (
            <label
              key={module.id}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-paper-300 bg-white p-3 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-soft"
            >
              <input
                type="checkbox"
                name="enabledModules"
                value={module.id}
                checked={module.id === "ACCOUNTING" || selected.has(module.id)}
                onChange={() => toggle(module.id)}
                disabled={module.id === "ACCOUNTING"}
                className="mt-0.5 h-4 w-4 rounded border-paper-400"
              />
              <span className="text-[0.8125rem] leading-5 text-ink-800">
                <span className="block font-medium text-ink-900">{module.name}</span>
                <span className="mt-0.5 block text-[0.75rem] text-muted-ink">{module.blurb}</span>
                {module.id === "ACCOUNTING" && (
                  <span className="mt-0.5 block text-[0.6875rem] text-muted-ink">
                    Always on — the dashboard and company settings live under it.
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4">
          <SubmitButton pendingLabel="Saving…">Save modules</SubmitButton>
        </div>
      </AdminForm>
    </AdminCard>
  );
}
