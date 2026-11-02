"use client";

import { ConfirmAction } from "@/components/admin/forms";
import { markEnquiryHandledAction } from "./actions";

export function EnquiryRowActions({ csrfToken, enquiryId, name }: { csrfToken: string; enquiryId: string; name: string }) {
  return (
    <ConfirmAction
      action={markEnquiryHandledAction}
      csrfToken={csrfToken}
      label="Mark handled"
      title={`Mark ${name}'s enquiry as handled`}
      description="It moves out of the New list. Nothing is deleted."
      confirmLabel="Mark handled"
      hidden={{ id: enquiryId }}
    />
  );
}
