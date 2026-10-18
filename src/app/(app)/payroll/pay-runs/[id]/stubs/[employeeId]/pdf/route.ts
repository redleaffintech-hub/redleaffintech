import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { getCompanyProfile } from "@/server/companies/profile";
import { payrollYtd } from "@/server/payroll/ytd";
import { formatDate, formatDateLong } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/** The standard PDF fonts are WinAnsi only — fold anything outside it to ASCII. */
function ascii(text: string): string {
  return text
    .replace(/[  ]/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?");
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; employeeId: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.PAYROLL);
  const { id, employeeId } = await params;

  const line = await db.payRunLine.findFirst({
    where: { payRunId: id, employeeId, companyId: company.id },
    include: { payRun: true, employee: true },
  });
  if (!line || line.payRun.status !== "POSTED") return new NextResponse("Pay stub not found", { status: 404 });

  const [profile, ytd] = await Promise.all([
    getCompanyProfile(company.id),
    payrollYtd(company.id, employeeId, line.payRun.payDate.getUTCFullYear(), line.payRun.payDate),
  ]);
  const currency = company.baseCurrency;
  const fmt = (cents: number) => ascii(formatMoney(cents, { currency }));
  const { employee, payRun } = line;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.4, 0.43, 0.48);
  const accent = rgb(0.18, 0.36, 0.55);

  const left = 48;
  const right = 564;
  let y = 744;

  const text = (p: PDFPage, s: string, x: number, yy: number, f: PDFFont = font, size = 10, color = ink) =>
    p.drawText(ascii(s), { x, y: yy, size, font: f, color });
  const textRight = (s: string, xRight: number, yy: number, f: PDFFont = font, size = 10) => {
    const t = ascii(s);
    page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y: yy, size, font: f, color: ink });
  };
  const rule = (yy: number, color = rgb(0.85, 0.87, 0.9), thickness = 0.75) =>
    page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness, color });

  // Header
  text(page, profile.legalName ?? profile.name, left, y, bold, 14);
  text(page, "PAY STUB", right - bold.widthOfTextAtSize("PAY STUB", 20), y - 2, bold, 20, accent);
  y -= 16;
  for (const l of [
    profile.addressLine1,
    [profile.city, profile.province, profile.postalCode].filter(Boolean).join(", "),
  ]) {
    if (l) {
      text(page, l, left, y, font, 9, muted);
      y -= 12;
    }
  }
  rule(y - 4, accent, 1.5);
  y -= 22;

  // Pay-run facts, right column; employee, left column
  const facts: [string, string][] = [
    ["Pay run", payRun.number],
    ["Period", `${formatDate(payRun.payPeriodStart)} - ${formatDate(payRun.payPeriodEnd)}`],
    ["Pay date", formatDateLong(payRun.payDate)],
  ];
  let fy = y;
  for (const [k, v] of facts) {
    text(page, k, 380, fy, font, 9, muted);
    textRight(v, right, fy, bold, 9);
    fy -= 13;
  }
  let ey = y;
  text(page, "EMPLOYEE", left, ey, bold, 8, muted);
  ey -= 13;
  text(page, `${employee.legalFirstName} ${employee.legalLastName}`, left, ey, bold, 10);
  ey -= 12;
  if (employee.jobTitle) {
    text(page, employee.jobTitle, left, ey, font, 9);
    ey -= 12;
  }
  text(page, `Employee #: ${employee.employeeNumber}`, left, ey, font, 9, muted);
  ey -= 12;
  if (employee.sinLast3) {
    text(page, `SIN: *** *** ${employee.sinLast3}`, left, ey, font, 9, muted);
    ey -= 12;
  }
  y = Math.min(ey, fy) - 14;

  // Table helper
  const header = (title: string, cols: { label: string; xRight: number }[]) => {
    page.drawRectangle({ x: left, y: y - 4, width: right - left, height: 18, color: rgb(0.93, 0.95, 0.97) });
    text(page, title, left + 6, y, bold, 9);
    for (const c of cols) textRight(c.label, c.xRight - 6, y, bold, 9);
    y -= 20;
  };
  const row = (label: string, cells: { v: string; xRight: number }[], f: PDFFont = font) => {
    text(page, label, left + 6, y, f, 10);
    for (const c of cells) textRight(c.v, c.xRight - 6, y, f, 10);
    y -= 15;
  };

  // Earnings
  header("EARNINGS", [
    { label: "Hours", xRight: 390 },
    { label: "Current", xRight: right },
  ]);
  const earnings: { label: string; hours: number | null; cents: number }[] = [
    { label: "Regular", hours: line.regularHours, cents: line.regularPayCents },
    ...[
      { label: "Overtime", hours: line.overtimeHours, cents: line.overtimePayCents },
      { label: "Vacation pay", hours: null, cents: line.vacationPayCents },
      { label: "Sick pay", hours: null, cents: line.sickPayCents },
      { label: "Bonus", hours: null, cents: line.bonusCents },
      { label: "Retroactive pay", hours: null, cents: line.retroactivePayCents },
      { label: "Statutory holiday pay", hours: null, cents: line.statutoryHolidayPayCents },
    ].filter((r) => r.cents !== 0),
  ];
  for (const e of earnings) {
    row(e.label, [
      ...(e.hours !== null ? [{ v: String(e.hours), xRight: 390 }] : []),
      { v: fmt(e.cents), xRight: right },
    ]);
  }
  rule(y + 9);
  row("Gross pay", [{ v: fmt(line.grossPayCents), xRight: right }], bold);
  y -= 10;

  // Deductions
  header("DEDUCTIONS", [
    { label: "Current", xRight: 430 },
    { label: "Year to date", xRight: right },
  ]);
  const deductions: { label: string; cur: number; ytd: number | null }[] = [
    { label: "CPP", cur: line.cppCents, ytd: ytd.cppCents },
    { label: "CPP2", cur: line.cpp2Cents, ytd: ytd.cpp2Cents },
    { label: "EI", cur: line.eiCents, ytd: ytd.eiCents },
    ...(line.qpipCents !== 0 || ytd.qpipCents !== 0 ? [{ label: "QPIP", cur: line.qpipCents, ytd: ytd.qpipCents }] : []),
    { label: "Federal tax", cur: line.federalTaxCents, ytd: ytd.federalTaxCents },
    { label: "Provincial tax", cur: line.provincialTaxCents, ytd: ytd.provincialTaxCents },
    ...(line.otherDeductionsCents !== 0
      ? [{ label: line.otherDeductionsNote || "Other deductions", cur: line.otherDeductionsCents, ytd: null }]
      : []),
  ];
  for (const d of deductions) {
    row(d.label, [
      { v: fmt(d.cur), xRight: 430 },
      { v: d.ytd === null ? "-" : fmt(d.ytd), xRight: right },
    ]);
  }
  y -= 8;

  // Net pay + YTD
  page.drawRectangle({ x: 330, y: y - 6, width: right - 330, height: 22, color: accent });
  page.drawText("NET PAY", { x: 338, y: y, size: 11, font: bold, color: rgb(1, 1, 1) });
  const net = fmt(line.netPayCents);
  page.drawText(net, { x: right - 8 - bold.widthOfTextAtSize(net, 11), y, size: 11, font: bold, color: rgb(1, 1, 1) });
  y -= 24;
  for (const [k, v] of [
    ["Year to date gross", fmt(ytd.grossCents)],
    ["Year to date net", fmt(ytd.netCents)],
  ] as const) {
    text(page, k, 338, y, font, 9, muted);
    textRight(v, right - 8, y, font, 9);
    y -= 13;
  }

  // Employer contributions (informational)
  if (line.employerCppCents > 0 || line.employerCpp2Cents > 0 || line.employerEiCents > 0 || line.employerQpipCents > 0) {
    let cy = y + 13 * 2 + 24;
    text(page, "EMPLOYER CONTRIBUTIONS (INFORMATIONAL)", left, cy, bold, 8, muted);
    cy -= 13;
    for (const [k, v] of [
      ["Employer CPP", line.employerCppCents],
      ["Employer CPP2", line.employerCpp2Cents],
      ["Employer EI", line.employerEiCents],
      ...(line.employerQpipCents > 0 ? [["Employer QPIP", line.employerQpipCents] as const] : []),
    ] as const) {
      text(page, `${k}: ${fmt(v)}`, left, cy, font, 9);
      cy -= 12;
    }
    y = Math.min(y, cy);
  }

  if (line.notes) {
    y -= 16;
    for (const l of line.notes.split("\n").slice(0, 6)) {
      text(page, l, left, y, font, 9, muted);
      y -= 12;
    }
  }

  const bytes = await pdf.save();
  const name = ascii(`PayStub-${payRun.number}-${employee.legalLastName}-${employee.legalFirstName}`).replace(/[^A-Za-z0-9._-]+/g, "_");
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
