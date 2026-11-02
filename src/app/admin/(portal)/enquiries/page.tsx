import Link from "next/link";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { formatDate } from "@/lib/dates";
import { Badge, Table, Td, Th, Tr } from "@/components/ui";
import { AdminCard, AdminPageHeader, EmptyRow } from "@/components/admin/ui";
import { EnquiryRowActions } from "./row-actions";

export const metadata = { title: "Enquiries" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePlatformAdmin();
  const status = first((await searchParams).status);
  const filter = status === "NEW" || status === "HANDLED" ? status : undefined;
  const enquiries = await db.contactEnquiry.findMany({
    where: filter ? { status: filter } : {},
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <>
      <AdminPageHeader
        title="Enquiries"
        description="Messages sent through the public Contact page. Reply from your own mailbox using the address shown."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Enquiries" }]}
      />

      <div className="mb-3 flex flex-wrap gap-2 text-[0.8125rem]">
        {[undefined, "NEW", "HANDLED"].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/admin/enquiries?status=${s}` : "/admin/enquiries"}
            className={`rounded-full border px-3 py-1 ${filter === s ? "border-brand-600 bg-brand-soft font-medium" : "border-paper-400 bg-white hover:bg-paper-100"}`}
          >
            {s === "NEW" ? "New" : s === "HANDLED" ? "Handled" : "All"}
          </Link>
        ))}
      </div>

      <AdminCard>
        <Table>
          <thead>
            <tr>
              <Th width="9rem">Received</Th>
              <Th width="16rem">From</Th>
              <Th>Message</Th>
              <Th width="7rem">Status</Th>
              <Th width="9rem" align="right">{""}</Th>
            </tr>
          </thead>
          <tbody>
            {enquiries.length === 0 && <EmptyRow colSpan={5}>No enquiries yet.</EmptyRow>}
            {enquiries.map((e) => (
              <Tr key={e.id}>
                <Td>{formatDate(e.createdAt)}</Td>
                <Td>
                  <div className="font-medium">{e.name}</div>
                  <a href={`mailto:${e.email}`} className="text-[0.8125rem] text-brand-700 hover:underline">{e.email}</a>
                  {e.phone && <div className="text-[0.75rem] text-muted-ink">{e.phone}</div>}
                  {e.company && <div className="text-[0.75rem] text-muted-ink">{e.company}</div>}
                </Td>
                <Td>
                  {e.topic && <div className="mb-0.5 text-[0.75rem] uppercase tracking-wide text-muted-ink">{e.topic}</div>}
                  <div className="whitespace-pre-wrap text-[0.8125rem] leading-5">{e.message}</div>
                </Td>
                <Td>
                  <Badge tone={e.status === "NEW" ? "info" : "positive"}>{e.status === "NEW" ? "New" : "Handled"}</Badge>
                  {e.handledBy && <div className="mt-0.5 text-[0.75rem] text-muted-ink">{e.handledBy}</div>}
                </Td>
                <Td align="right">
                  {e.status === "NEW" && <EnquiryRowActions csrfToken={actor.csrfToken} enquiryId={e.id} name={e.name} />}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </AdminCard>
    </>
  );
}
