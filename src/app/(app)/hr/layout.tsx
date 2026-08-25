import { requireModule } from "@/server/auth/context";

export default async function HrLayout({ children }: LayoutProps<"/hr">) {
  await requireModule("HR");
  return children;
}
