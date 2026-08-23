import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminActor } from "@/server/admin/guard";
import { AdminLoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

/**
 * The platform console's own front door.
 *
 * Nothing on this page hints at who holds an account, how many administrators
 * there are, or that the console exists for any particular organisation beyond
 * Red Leaf itself. There is no demo-account list here — the accounting app's
 * `/login` has one behind `DEMO_ACCOUNTS`, and that would be an outright
 * disclosure on this side.
 */
export default async function AdminLoginPage() {
  const actor = await getAdminActor();
  if (actor) redirect(actor.mustChangePassword ? "/admin/change-password" : "/admin");

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-[24rem]">
        <div className="mb-7 flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-md bg-maple-500 text-[0.8125rem] font-bold text-white"
          >
            RL
          </span>
          <span className="font-display text-[1rem] font-semibold tracking-[-0.01em] text-white">
            Red Leaf Fintech
          </span>
        </div>

        <div className="rounded-(--radius-card) border border-ink-800 bg-white p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)]">
          <h1 className="font-display text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-950">
            Platform administration
          </h1>
          <p className="mt-1.5 text-[0.8125rem] leading-6 text-muted-ink">
            This console manages Red Leaf&rsquo;s plans, clients and subscriptions. It is not the accounting
            application.
          </p>

          <AdminLoginForm />
        </div>

        <p className="mt-5 text-center text-[0.75rem] leading-6 text-ink-400">
          Looking for your books?{" "}
          <Link href="/login" className="font-medium text-ink-100 hover:underline">
            Sign in to Red Leaf Accounting
          </Link>
        </p>
      </div>
    </div>
  );
}
