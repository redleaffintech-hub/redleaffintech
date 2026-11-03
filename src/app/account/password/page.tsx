import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/server/auth/context";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper-100 px-6 py-12">
      <div className="w-full max-w-sm rounded-xl border border-paper-300 bg-white p-7 shadow-sm">
        <Image src="/brand/lockup.png" alt="Red Leaf Fintech" width={1000} height={256} className="mb-6 h-9 w-auto" priority />
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-950">
          {user.mustChangePassword ? "Choose your own password" : "Change password"}
        </h1>
        <p className="mt-1 text-[0.875rem] text-muted-ink">
          {user.mustChangePassword
            ? "You signed in with a temporary password. Set a new one to continue."
            : `Signed in as ${user.email}.`}
        </p>
        <PasswordForm />
        {!user.mustChangePassword && (
          <p className="mt-5 text-[0.8125rem]">
            <Link href="/dashboard" className="text-brand-700 hover:underline">Back to dashboard</Link>
          </p>
        )}
      </div>
    </div>
  );
}
