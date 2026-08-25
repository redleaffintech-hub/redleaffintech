import { requireModule } from "@/server/auth/context";

export default async function PayrollLayout({ children }: LayoutProps<"/payroll">) {
  await requireModule("PAYROLL");
  return children;
}
