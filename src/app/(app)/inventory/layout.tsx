import { requireModule } from "@/server/auth/context";

export default async function InventoryLayout({ children }: LayoutProps<"/inventory">) {
  await requireModule("INVENTORY");
  return children;
}
