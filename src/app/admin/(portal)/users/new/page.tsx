import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminPageHeader } from "@/components/admin/ui";
import { NewUserForm } from "./user-form";

export const metadata = { title: "Create user" };

export default async function NewUserPage() {
  const actor = await requirePlatformAdmin();

  return (
    <>
      <AdminPageHeader
        title="Create user"
        description="Add a person to the platform. Granting them access to a company is a separate step."
        breadcrumb={[{ label: "Users", href: "/admin/users" }, { label: "New" }]}
      />
      <NewUserForm csrfToken={actor.csrfToken} />
    </>
  );
}
