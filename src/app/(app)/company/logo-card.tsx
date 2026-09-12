"use client";

import { useState } from "react";
import { Card, CardHeader, Button } from "@/components/ui";
import { CompanyLogoModal } from "@/components/company-logo-modal";

/**
 * Shows the current company logo on the profile page and, for roles that can
 * change company settings, a button that opens the same upload modal the
 * topbar's quick-change menu uses — one save path, shown wherever the logo
 * appears in the app.
 */
export function CompanyLogoCard({
  logoUrl,
  editable,
}: {
  logoUrl: string | null;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader title="Company logo" subtitle="Shown in the topbar and on invoices, estimates and other documents" />
      <div className="mt-3 flex items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a resized data URL, not an optimizable remote asset
          <img src={logoUrl} alt="Company logo" className="h-16 w-16 rounded-md border border-paper-300 bg-white object-contain p-1" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-paper-400 text-[0.6875rem] text-muted-ink">
            No logo
          </div>
        )}
        {editable && (
          <Button onClick={() => setOpen(true)}>{logoUrl ? "Change logo" : "Upload logo"}</Button>
        )}
      </div>

      {open && <CompanyLogoModal onClose={() => setOpen(false)} currentLogoUrl={logoUrl} />}
    </Card>
  );
}
