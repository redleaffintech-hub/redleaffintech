import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { loadPayStub } from "@/server/payroll/pay-stub-data";
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

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 48;
const RIGHT = 564;
const MIN_Y = 70;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; employeeId: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.PAYROLL);
  const { id, employeeId } = await params;

  const stub = await loadPayStub(company.id, id, employeeId);
  if (!stub) return new NextResponse("Pay stub not found", { status: 404 });
  const { line, employee, payRun, profile, ytd, earnings, deductions, totalDeductions, employerContributions, leaveSummary } = stub;

  const currency = company.baseCurrency;
  const fmt = (cents: number) => ascii(formatMoney(cents, { currency }));

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.4, 0.43, 0.48);
  const accent = rgb(0.18, 0.36, 0.55);
  const band = rgb(0.93, 0.95, 0.97);
  const hair = rgb(0.85, 0.87, 0.9);

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = 744;

  const text = (s: string, x: number, yy: number, f: PDFFont = font, size = 10, color = ink) =>
    page.drawText(ascii(s), { x, y: yy, size, font: f, color });
  const textRight = (s: string, xRight: number, yy: number, f: PDFFont = font, size = 10, color = ink) => {
    const t = ascii(s);
    page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y: yy, size, font: f, color });
  };
  const rule = (yy: number, color = hair, thickness = 0.75) =>
    page.drawLine({ start: { x: LEFT, y: yy }, end: { x: RIGHT, y: yy }, thickness, color });

  /** A long stub (many earnings / deduction rows) flows onto a second page rather than running off the bottom. */
  const ensureSpace = (needed: number) => {
    if (y - needed >= MIN_Y) return;
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = 744;
  };

  // ── Header ────────────────────────────────────────────────────────────────
  text(profile.legalName ?? profile.name, LEFT, y, bold, 14);
  textRight("PAY STUB", RIGHT, y - 2, bold, 20, accent);
  y -= 16;
  for (const l of [profile.addressLine1, [profile.city, profile.province, profile.postalCode].filter(Boolean).join(", ")]) {
    if (l) {
      text(l, LEFT, y, font, 9, muted);
      y -= 12;
    }
  }
  rule(y - 4, accent, 1.5);
  y -= 22;

  // ── Pay-run facts (right) and employee (left) ─────────────────────────────
  const facts: [string, string][] = [
    ["Pay run", payRun.number],
    ["Period", `${formatDate(payRun.payPeriodStart)} - ${formatDate(payRun.payPeriodEnd)}`],
    ["Pay date", formatDateLong(payRun.payDate)],
  ];
  let fy = y;
  for (const [k, v] of facts) {
    text(k, 380, fy, font, 9, muted);
    textRight(v, RIGHT, fy, bold, 9);
    fy -= 13;
  }
  let ey = y;
  text("EMPLOYEE", LEFT, ey, bold, 8, muted);
  ey -= 13;
  text(`${employee.legalFirstName} ${employee.legalLastName}`, LEFT, ey, bold, 10);
  ey -= 12;
  if (employee.jobTitle) {
    text(employee.jobTitle, LEFT, ey, font, 9);
    ey -= 12;
  }
  text(`Employee #: ${employee.employeeNumber}`, LEFT, ey, font, 9, muted);
  ey -= 12;
  if (employee.sinLast3) {
    text(`SIN: *** *** ${employee.sinLast3}`, LEFT, ey, font, 9, muted);
    ey -= 12;
  }
  y = Math.min(ey, fy) - 14;

  // ── Tables ────────────────────────────────────────────────────────────────
  type Col = { label: string; xRight: number };
  const header = (title: string, cols: Col[]) => {
    ensureSpace(60);
    page.drawRectangle({ x: LEFT, y: y - 4, width: RIGHT - LEFT, height: 18, color: band });
    text(title, LEFT + 6, y, bold, 9);
    for (const c of cols) textRight(c.label, c.xRight - 6, y, bold, 9);
    y -= 20;
  };
  const row = (label: string, cells: { v: string; xRight: number }[], f: PDFFont = font) => {
    ensureSpace(20);
    text(label, LEFT + 6, y, f, 10);
    for (const c of cells) textRight(c.v, c.xRight - 6, y, f, 10);
    y -= 15;
  };

  // Earnings: Hours | Rate | Current | Year to date
  const eHours = 318;
  const eRate = 384;
  const eCur = 474;
  const eYtd = RIGHT;
  header("EARNINGS", [
    { label: "Hours", xRight: eHours },
    { label: "Rate", xRight: eRate },
    { label: "Current", xRight: eCur },
    { label: "Year to date", xRight: eYtd },
  ]);
  for (const e of earnings) {
    row(e.label, [
      ...(e.hours !== null ? [{ v: String(e.hours), xRight: eHours }] : []),
      ...(e.rateCents ? [{ v: fmt(e.rateCents), xRight: eRate }] : []),
      { v: fmt(e.currentCents), xRight: eCur },
      { v: fmt(e.ytdCents), xRight: eYtd },
    ]);
  }
  ensureSpace(24);
  rule(y + 9);
  row("Gross pay", [{ v: fmt(line.grossPayCents), xRight: eCur }, { v: fmt(ytd.grossCents), xRight: eYtd }], bold);
  y -= 10;

  // Deductions: Current | Year to date
  const dCur = 474;
  const dYtd = RIGHT;
  header("DEDUCTIONS", [
    { label: "Current", xRight: dCur },
    { label: "Year to date", xRight: dYtd },
  ]);
  for (const d of deductions) {
    row(d.label, [{ v: fmt(d.currentCents), xRight: dCur }, { v: fmt(d.ytdCents), xRight: dYtd }]);
  }
  ensureSpace(24);
  rule(y + 9);
  row("Total deductions", [{ v: fmt(totalDeductions.currentCents), xRight: dCur }, { v: fmt(totalDeductions.ytdCents), xRight: dYtd }], bold);
  y -= 8;

  // ── Net pay + YTD ─────────────────────────────────────────────────────────
  ensureSpace(90);
  const blockTop = y;
  page.drawRectangle({ x: 330, y: y - 6, width: RIGHT - 330, height: 22, color: accent });
  page.drawText("NET PAY", { x: 338, y, size: 11, font: bold, color: rgb(1, 1, 1) });
  const net = fmt(line.netPayCents);
  page.drawText(net, { x: RIGHT - 8 - bold.widthOfTextAtSize(net, 11), y, size: 11, font: bold, color: rgb(1, 1, 1) });
  y -= 24;
  for (const [k, v] of [
    ["Year to date gross", fmt(ytd.grossCents)],
    ["Year to date net", fmt(ytd.netCents)],
  ] as const) {
    text(k, 338, y, font, 9, muted);
    textRight(v, RIGHT - 8, y, font, 9);
    y -= 13;
  }

  // Employer contributions (informational), beside the net-pay block.
  if (employerContributions.some((c) => c.currentCents > 0 || c.ytdCents > 0)) {
    let cy = blockTop;
    const eCur = 215;
    const eYtd = 315;
    text("EMPLOYER CONTRIBUTIONS (INFORMATIONAL)", LEFT, cy, bold, 8, muted);
    cy -= 13;
    textRight("Current", eCur, cy, bold, 8, muted);
    textRight("Year to date", eYtd, cy, bold, 8, muted);
    cy -= 12;
    for (const c of employerContributions) {
      text(c.label, LEFT, cy, font, 9);
      textRight(fmt(c.currentCents), eCur, cy, font, 9);
      textRight(fmt(c.ytdCents), eYtd, cy, font, 9);
      cy -= 12;
    }
    y = Math.min(y, cy);
  }

  // ── Leave balance summary (hours, as of the pay date) ─────────────────────
  y -= 18;
  ensureSpace(80);
  const lh = (v: number | null) => (v === null ? "N/A" : v.toFixed(2));
  const lCar = 330;
  const lAcc = 410;
  const lUse = 488;
  const lRem = RIGHT;
  header("LEAVE BALANCE SUMMARY (HOURS)", [
    { label: "Carried/adj.", xRight: lCar },
    { label: "Accrued YTD", xRight: lAcc },
    { label: "Availed YTD", xRight: lUse },
    { label: "Remaining", xRight: lRem },
  ]);
  for (const l of leaveSummary) {
    row(l.label, [
      { v: lh(l.carriedHours), xRight: lCar },
      { v: lh(l.accruedHours), xRight: lAcc },
      { v: lh(l.availedHours), xRight: lUse },
      { v: lh(l.remainingHours), xRight: lRem },
    ]);
  }
  text(`Balances as of the pay date, ${formatDate(payRun.payDate)}. Remaining = carried/adj. + accrued - availed; pending requests are not deducted.`, LEFT, y + 2, font, 7.5, muted);
  y -= 12;

  if (line.notes) {
    y -= 16;
    for (const l of line.notes.split("\n").slice(0, 6)) {
      ensureSpace(14);
      text(l, LEFT, y, font, 9, muted);
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
