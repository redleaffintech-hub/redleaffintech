import { AgingReport } from "../ar-aging/page";

export const metadata = { title: "A/P aging" };

export default async function ApAgingPage({ searchParams }: PageProps<"/reports/ap-aging">) {
  return AgingReport({ searchParams, kind: "AP" });
}
