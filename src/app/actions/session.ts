"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { destroySession } from "@/server/auth/session";
import { switchCompany } from "@/server/auth/context";

export async function switchCompanyAction(companyId: string) {
  await switchCompany(companyId);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
