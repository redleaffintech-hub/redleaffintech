"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { computeDocument, type RawLine } from "@/server/documents/lines";
import type { TaxCodeSpec } from "@/server/tax/engine";
import { formatMoney, toCents } from "@/lib/money";
import { PROVINCES } from "@/lib/enums";
import {
  codesForPlaceOfSupply,
  defaultCodeForPlaceOfSupply,
  isMissingProvincialCode,
  resolveLineCode,
} from "@/lib/place-of-supply";
import { Button, Field, inputClass } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { Modal } from "@/components/modal";
import {
  AddressEditor,
  EMPTY_ADDRESS,
  addressFromParty,
  isAddressEmpty,
  type DocumentAddress,
} from "@/components/document-address";
import { DocumentPreview, type PreviewCompany } from "@/components/document-preview";
import { CustomerForm, type CustomerFormTaxCode } from "@/components/customer-form";
import { addProvincialTaxCodesAction } from "@/app/(app)/tax/actions";

/**
 * The line-based document editor: invoices, sales quotes, customer credit notes
 * and bills.
 *
 * The running totals are produced by `computeDocument` — the same function the
 * posting engine calls on the server. The preview cannot drift from what gets
 * posted, because it is not a second implementation.
 */

export type DocumentKind = "INVOICE" | "QUOTE" | "CREDIT_NOTE" | "BILL";

interface KindConfig {
  /** What the document is called, in running text and on the preview. */
  noun: string;
  partyLabel: string;
  issueDateLabel: string;
  /** The second date, if the document has one. */
  secondDateLabel: string | null;
  /**
   * Whether that second date is derived from the party payment terms. True for a
   * due date; false for a quote, whose validity window is ours to set, not a
   * consequence of how long the customer takes to pay.
   */
  secondDateFromPartyTerms: boolean;
  numberLabel: string | null;
  referenceLabel: string;
  referencePlaceholder: string;
  /** Which side of the chart of accounts the lines post to. */
  accountSide: "REVENUE" | "EXPENSE";
  /** Whether the document can be kept back as a draft. */
  allowDraft: boolean;
  /** Whether it produces a journal entry at all — a quote does not. */
  postsToLedger: boolean;
  /** Bill-to and ship-to only belong on a document we issue. */
  showAddresses: boolean;
  /**
   * Whether the tax on this document is chosen by a place of supply at all.
   *
   * True for anything we issue: the destination decides the rate. False for a
   * bill, where the tax is simply whatever the vendor charged us — every code
   * stays on offer there, because the document is evidence of their decision, not
   * ours.
   */
  usesPlaceOfSupply: boolean;
}

const KINDS: Record<DocumentKind, KindConfig> = {
  INVOICE: {
    noun: "invoice",
    partyLabel: "Customer",
    issueDateLabel: "Invoice date",
    secondDateLabel: "Due date",
    secondDateFromPartyTerms: true,
    numberLabel: "Invoice #",
    referenceLabel: "Customer reference / PO",
    referencePlaceholder: "PO-4471",
    accountSide: "REVENUE",
    allowDraft: true,
    postsToLedger: true,
    showAddresses: true,
    usesPlaceOfSupply: true,
  },
  QUOTE: {
    noun: "quote",
    partyLabel: "Customer",
    issueDateLabel: "Quote date",
    secondDateLabel: "Valid until",
    secondDateFromPartyTerms: false,
    numberLabel: "Quote #",
    referenceLabel: "Customer reference",
    referencePlaceholder: "Their enquiry number",
    accountSide: "REVENUE",
    // A quote is not an accounting document; there is no draft/post distinction
    // to make because it never touches the ledger either way.
    allowDraft: false,
    postsToLedger: false,
    showAddresses: true,
    usesPlaceOfSupply: true,
  },
  CREDIT_NOTE: {
    noun: "credit note",
    partyLabel: "Customer",
    issueDateLabel: "Credit date",
    secondDateLabel: null,
    secondDateFromPartyTerms: false,
    numberLabel: null,
    referenceLabel: "Reason",
    referencePlaceholder: "Over-billed hours on INV-1008",
    accountSide: "REVENUE",
    // A credit note reverses a posted invoice; holding one as an unposted draft
    // would leave the receivable overstated for as long as it sat there.
    allowDraft: false,
    postsToLedger: true,
    showAddresses: false,
    usesPlaceOfSupply: true,
  },
  BILL: {
    noun: "bill",
    partyLabel: "Vendor",
    issueDateLabel: "Bill date",
    secondDateLabel: "Due date",
    secondDateFromPartyTerms: true,
    numberLabel: null,
    referenceLabel: "Vendor invoice number",
    referencePlaceholder: "Their invoice number",
    accountSide: "EXPENSE",
    allowDraft: true,
    postsToLedger: true,
    showAddresses: false,
    usesPlaceOfSupply: false,
  },
};

export interface PartyAddressFields {
  line1: string | null;
  line2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country?: string | null;
}

export interface PartyOption {
  id: string;
  name: string;
  taxCodeId: string | null;
  paymentTermsDays: number;
  /** Absent for vendors, whose documents carry no addresses of ours. */
  billTo?: PartyAddressFields | null;
  /** Null means "ship to the billing address". */
  shipTo?: PartyAddressFields | null;
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

export interface ItemOption {
  id: string;
  name: string;
  unitPriceCents: number;
  incomeAccountId: string | null;
  taxCodeId: string | null;
  unit: string;
}

interface EditorLine {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  accountId: string;
  taxCodeId: string;
  itemId?: string;
}

export function DocumentForm({
  kind,
  parties,
  accounts,
  taxCodes: taxCodesProp,
  items = [],
  defaultTaxInclusive,
  defaultTermsDays,
  onSubmitAction,
  cancelHref,
  suggestedNumber,
  companyProfile,
  companyProvince,
  customerCreation,
  provincesWithSalesTax = [],
  canManageTaxCodes = false,
}: {
  kind: DocumentKind;
  parties: PartyOption[];
  accounts: AccountOption[];
  taxCodes: TaxCodeSpec[];
  items?: ItemOption[];
  defaultTaxInclusive: boolean;
  defaultTermsDays: number;
  onSubmitAction: (payload: string) => Promise<{ error?: string; redirectTo?: string }>;
  cancelHref: string;
  /** The number this document would take, shown so it can be overridden. */
  suggestedNumber?: string;
  /** Letterhead for the preview. Without it, no preview is offered. */
  companyProfile?: PreviewCompany;
  /** Falls back as the place of supply when no ship-to province is set. */
  companyProvince?: string;
  /** Enables "add a new customer" inside the party list. */
  customerCreation?: { taxCodes: CustomerFormTaxCode[]; defaultTermsDays: number };
  /** Provinces a published provincial rate exists for, for the missing-code notice. */
  provincesWithSalesTax?: readonly string[];
  canManageTaxCodes?: boolean;
}) {
  const router = useRouter();
  const config = KINDS[kind];

  // Tax codes live in state because a cross-province sale can add one without
  // leaving the form.
  const [taxCodes, setTaxCodes] = useState<TaxCodeSpec[]>(taxCodesProp);
  const [partyList, setPartyList] = useState<PartyOption[]>(parties);

  /**
   * The accounts this kind of document may post to, and the default drawn from
   * them. This has to be resolved before the line state is initialised: a default
   * taken from the unfiltered list is one the dropdown does not offer, and a
   * <select> whose value is not among its options displays its first option
   * instead — showing a revenue account while holding a liability.
   */
  const sideAccounts = accounts.filter((account) =>
    config.accountSide === "REVENUE" ? account.type === "REVENUE" : account.type !== "REVENUE",
  );
  const accountChoices = sideAccounts.length > 0 ? sideAccounts : accounts;
  const defaultAccount = accountChoices[0]?.id ?? "";

  const [partyId, setPartyId] = useState(partyList[0]?.id ?? "");
  const [number, setNumber] = useState(suggestedNumber ?? "");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [secondDate, setSecondDate] = useState(
    new Date(Date.now() + defaultTermsDays * 86_400_000).toISOString().slice(0, 10),
  );
  const [taxInclusive, setTaxInclusive] = useState(defaultTaxInclusive);
  const [memo, setMemo] = useState("");
  const [reference, setReference] = useState("");
  const [postNow, setPostNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const firstParty = partyList[0];
  /** Where the first customer in the list takes delivery, before anything is edited. */
  const initialPlaceOfSupply = !config.usesPlaceOfSupply
    ? null
    : config.showAddresses
      ? (firstParty?.shipTo?.province ?? firstParty?.billTo?.province) || companyProvince || null
      : companyProvince || null;

  const [billTo, setBillTo] = useState<DocumentAddress>(
    firstParty ? addressFromParty(firstParty.name, firstParty.billTo ?? null) : EMPTY_ADDRESS,
  );
  const [shipTo, setShipTo] = useState<DocumentAddress>(
    firstParty?.shipTo ? addressFromParty(firstParty.name, firstParty.shipTo) : EMPTY_ADDRESS,
  );
  const [shipSameAsBill, setShipSameAsBill] = useState(!firstParty?.shipTo);

  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [addingCodes, startAddingCodes] = useTransition();
  const [codeNotice, setCodeNotice] = useState<string | null>(null);

  /**
   * Where the supply is delivered, which is what selects the tax code.
   *
   * Falls back through ship-to → bill-to → the company's own province. A
   * document that shows no addresses but is still one we issue — a credit note —
   * lands on the company's province, which is where the invoice it reverses was
   * almost certainly rated. A purchase document has no place of supply at all.
   */
  const placeOfSupply = !config.usesPlaceOfSupply
    ? null
    : config.showAddresses
      ? (shipSameAsBill ? billTo.province : shipTo.province) || billTo.province || companyProvince || null
      : companyProvince || null;

  const offeredCodes = useMemo(
    () => codesForPlaceOfSupply(taxCodes, placeOfSupply),
    [taxCodes, placeOfSupply],
  );
  const defaultTax = defaultCodeForPlaceOfSupply(taxCodes, placeOfSupply)?.id ?? "";

  const [lines, setLines] = useState<EditorLine[]>(() => [
    {
      key: crypto.randomUUID(),
      description: "",
      quantity: "1",
      unitPrice: "",
      discount: "",
      accountId: defaultAccount,
      taxCodeId: defaultCodeForPlaceOfSupply(taxCodesProp, initialPlaceOfSupply)?.id ?? "",
    },
  ]);

  const party = partyList.find((p) => p.id === partyId);

  const missingProvincialCode = isMissingProvincialCode(taxCodes, placeOfSupply, provincesWithSalesTax);

  /** Re-rate every line for a new place of supply. See `resolveLineCode`. */
  function repointLines(nextProvince: string | null, codes: TaxCodeSpec[] = taxCodes) {
    setLines((current) =>
      current.map((line) => ({
        ...line,
        taxCodeId: resolveLineCode(codes, nextProvince, line.taxCodeId),
      })),
    );
  }

  function selectParty(id: string) {
    setPartyId(id);
    const next = partyList.find((p) => p.id === id);
    if (!next) return;

    if (config.showAddresses) {
      const nextBill = addressFromParty(next.name, next.billTo ?? null);
      setBillTo(nextBill);
      setShipTo(next.shipTo ? addressFromParty(next.name, next.shipTo) : EMPTY_ADDRESS);
      setShipSameAsBill(!next.shipTo);

      const province = (next.shipTo?.province ?? nextBill.province) || companyProvince || null;
      repointLines(province);
    } else if (next.taxCodeId) {
      // Vendors carry a default code rather than a place of supply.
      setLines((current) => current.map((line) => ({ ...line, taxCodeId: next.taxCodeId! })));
    }

    if (config.secondDateFromPartyTerms) {
      setSecondDate(
        new Date(Date.parse(issueDate) + next.paymentTermsDays * 86_400_000).toISOString().slice(0, 10),
      );
    }
  }

  function setBillingProvince(province: string) {
    setBillTo((current) => ({ ...current, province }));
    if (shipSameAsBill) repointLines(province || companyProvince || null);
  }

  function setShippingProvince(province: string) {
    setShipTo((current) => ({ ...current, province }));
    repointLines(province || billTo.province || companyProvince || null);
  }

  function toggleShipSameAsBill(same: boolean) {
    setShipSameAsBill(same);
    const province = (same ? billTo.province : shipTo.province) || billTo.province || companyProvince || null;
    repointLines(province);
  }

  function addProvincialCodes() {
    if (!placeOfSupply) return;
    setCodeNotice(null);
    startAddingCodes(async () => {
      const result = await addProvincialTaxCodesAction(placeOfSupply);
      if (result?.error) return setCodeNotice(result.error);
      if (result?.taxCodes?.length) {
        const merged = [...taxCodes, ...result.taxCodes];
        setTaxCodes(merged);
        repointLines(placeOfSupply, merged);
        setCodeNotice(`Added ${result.taxCodes.map((code) => code.code).join(", ")}.`);
      }
    });
  }

  const taxCodeMap = useMemo(
    () =>
      new Map(
        taxCodes.map((code) => [
          code.id,
          {
            ...code,
            effectiveFrom: new Date(code.effectiveFrom),
            effectiveTo: code.effectiveTo ? new Date(code.effectiveTo) : null,
          },
        ]),
      ),
    [taxCodes],
  );

  /** Lines that carry an amount, in the shape the shared arithmetic wants. */
  const pricedLines = useMemo(() => lines.filter((line) => line.unitPrice.trim() !== ""), [lines]);

  const preview = useMemo(() => {
    const raw: RawLine[] = pricedLines.map((line) => ({
      accountId: line.accountId,
      description: line.description || "—",
      quantityMilli: Math.round((Number(line.quantity) || 0) * 1000),
      unitPriceCents: safeCents(line.unitPrice),
      discountPercentMicro: Math.round((Number(line.discount) || 0) * 1_000_000),
      taxCodeId: line.taxCodeId || null,
    }));
    if (raw.length === 0) {
      return { lines: [], subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0, taxByComponent: [] };
    }
    try {
      return computeDocument(raw, taxCodeMap, taxInclusive, new Date(`${issueDate}T00:00:00.000Z`));
    } catch {
      return { lines: [], subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0, taxByComponent: [] };
    }
  }, [pricedLines, taxCodeMap, taxInclusive, issueDate]);

  function updateLine(key: string, patch: Partial<EditorLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function applyItem(key: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return updateLine(key, { itemId: "" });
    updateLine(key, {
      itemId,
      description: item.name,
      unitPrice: (item.unitPriceCents / 100).toFixed(2),
      accountId: item.incomeAccountId ?? defaultAccount,
      // The item's own code only wins if it is valid where the supply lands.
      taxCodeId:
        item.taxCodeId && offeredCodes.some((code) => code.id === item.taxCodeId)
          ? item.taxCodeId
          : defaultTax,
    });
  }

  async function submit() {
    setError(null);
    setPreviewOpen(false);
    if (!partyId) return setError(`Choose a ${config.partyLabel.toLowerCase()}.`);
    const usable = lines.filter((line) => line.unitPrice.trim() !== "" && line.description.trim() !== "");
    if (usable.length === 0) return setError("Add at least one line with a description and an amount.");

    setSaving(true);
    const result = await onSubmitAction(
      JSON.stringify({
        partyId,
        number: config.numberLabel ? number.trim() : undefined,
        issueDate,
        // Kept as `dueDate` on the wire: it is the due date for an invoice or
        // bill and the expiry date for a quote, and each action names it.
        dueDate: config.secondDateLabel ? secondDate : undefined,
        taxInclusive,
        memo,
        reference,
        post: config.allowDraft ? postNow : true,
        billTo: config.showAddresses ? billTo : undefined,
        shipTo: config.showAddresses && !shipSameAsBill && !isAddressEmpty(shipTo) ? shipTo : null,
        lines: usable.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity) || 1,
          unitPrice: line.unitPrice,
          discountPercent: Number(line.discount) || 0,
          accountId: line.accountId,
          taxCodeId: line.taxCodeId || null,
          itemId: line.itemId || null,
        })),
      }),
    );
    setSaving(false);
    if (result?.error) setError(result.error);
    else if (result?.redirectTo) router.push(result.redirectTo);
  }

  const accountName = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    return account ? `${account.code} · ${account.name}` : "Unknown account";
  };

  const primaryLabel = config.allowDraft && !postNow ? "Save draft" : `Save ${config.noun}`;
  const shipToForPreview = shipSameAsBill || isAddressEmpty(shipTo) ? null : shipTo;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="space-y-4">
        {/* Header fields */}
        <section className="rounded-[--radius-card] border border-paper-300 bg-white p-5">
          <div className={clsx("grid gap-4 sm:grid-cols-2", HEADER_GRID[kind])}>
            <Field
              label={config.partyLabel}
              required
              className="sm:col-span-2"
              action={
                customerCreation ? (
                  <button
                    type="button"
                    onClick={() => setCustomerDialogOpen(true)}
                    className="text-[0.75rem] font-medium text-brand-700 hover:underline"
                  >
                    + New customer
                  </button>
                ) : undefined
              }
            >
              <select
                value={partyId}
                onChange={(event) => {
                  if (event.target.value === NEW_PARTY) return setCustomerDialogOpen(true);
                  selectParty(event.target.value);
                }}
                className={clsx(inputClass, "pr-8")}
              >
                {partyList.length === 0 && (
                  <option value="">{customerCreation ? "No customers yet — add one" : "No records yet"}</option>
                )}
                {partyList.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
                {customerCreation && <option value={NEW_PARTY}>+ Add a new customer…</option>}
              </select>
            </Field>

            {config.numberLabel ? (
              <Field
                label={config.numberLabel}
                required
                hint="Type over it to use your own."
              >
                <input
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                  className={clsx(inputClass, "tnum")}
                />
              </Field>
            ) : null}

            <Field label={config.issueDateLabel} required>
              <input
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
                className={inputClass}
              />
            </Field>

            {config.secondDateLabel && (
              <Field label={config.secondDateLabel} required>
                <input
                  type="date"
                  value={secondDate}
                  onChange={(event) => setSecondDate(event.target.value)}
                  className={inputClass}
                />
              </Field>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={config.referenceLabel}>
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                className={inputClass}
                placeholder={config.referencePlaceholder}
              />
            </Field>
            <Field label="Memo" hint="Appears on the document and on the journal entry.">
              <input
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                className={inputClass}
                placeholder="Professional services — August"
              />
            </Field>
          </div>
        </section>

        {/* Addresses — and with them, the place of supply */}
        {config.showAddresses && (
          <section className="rounded-[--radius-card] border border-paper-300 bg-white">
            <div className="border-b border-paper-200 px-5 py-3">
              <h2 className="text-[0.9375rem] font-semibold text-ink-900">Addresses</h2>
              <p className="mt-0.5 text-[0.75rem] leading-5 text-muted-ink">
                Sales tax follows the place of supply, so the ship-to province is what decides which codes the lines
                below can use. Both addresses are stored on the document, not read back off the customer.
              </p>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                  Bill to
                </p>
                <AddressEditor value={billTo} onChange={setBillTo} onProvinceChange={setBillingProvince} />
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                    Ship to
                  </p>
                  <label className="flex cursor-pointer items-center gap-2 text-[0.75rem] text-ink-700">
                    <input
                      type="checkbox"
                      checked={shipSameAsBill}
                      onChange={(event) => toggleShipSameAsBill(event.target.checked)}
                      className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
                    />
                    Same as bill to
                  </label>
                </div>
                {shipSameAsBill ? (
                  <p className="rounded-lg bg-paper-100 px-3 py-2.5 text-[0.8125rem] leading-6 text-muted-ink">
                    Delivered to the billing address
                    {billTo.province ? ` in ${provinceName(billTo.province)}` : ""}.
                  </p>
                ) : (
                  <AddressEditor
                    value={shipTo}
                    onChange={setShipTo}
                    onProvinceChange={setShippingProvince}
                    provinceHint="This is the place of supply for sales tax."
                  />
                )}
              </div>
            </div>

            {(placeOfSupply || missingProvincialCode) && (
              <div className="border-t border-paper-200 px-5 py-3">
                {missingProvincialCode ? (
                  <div className="rounded-lg border border-[color:var(--color-caution)]/30 bg-caution-soft p-3">
                    <p className="flex items-start gap-2 text-[0.8125rem] leading-5 text-ink-800">
                      <Icon name="warning" className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
                      <span>
                        This company has no sales tax code for {provinceName(placeOfSupply!)}. Charging the federal
                        rate alone would under-collect on a supply delivered there.
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {canManageTaxCodes ? (
                        <Button onClick={addProvincialCodes} disabled={addingCodes}>
                          {addingCodes ? "Adding…" : `Add the ${placeOfSupply} tax code`}
                        </Button>
                      ) : (
                        <span className="text-[0.75rem] text-muted-ink">
                          Ask someone with tax settings access to add it under Tax Centre → Tax codes.
                        </span>
                      )}
                      <a href="/tax/codes" className="text-[0.75rem] font-medium text-brand-700 hover:underline">
                        Open Tax codes
                      </a>
                    </div>
                    {codeNotice && <p className="mt-2 text-[0.75rem] text-ink-700">{codeNotice}</p>}
                  </div>
                ) : (
                  <p className="text-[0.75rem] text-muted-ink">
                    Place of supply: <span className="font-medium text-ink-800">{provinceName(placeOfSupply!)}</span> ·
                    codes offered below: {offeredCodes.map((code) => code.code).join(", ") || "none"}
                    {codeNotice && <span className="ml-2 text-ink-700">{codeNotice}</span>}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* Lines */}
        <section className="rounded-[--radius-card] border border-paper-300 bg-white">
          <div className="flex items-center justify-between border-b border-paper-200 px-5 py-3">
            <h2 className="text-[0.9375rem] font-semibold text-ink-900">Lines</h2>
            <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink-700">
              <input
                type="checkbox"
                checked={taxInclusive}
                onChange={(event) => setTaxInclusive(event.target.checked)}
                className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
              />
              Amounts include tax
            </label>
          </div>

          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[52rem] text-[0.8125rem]">
              <thead>
                <tr className="border-b border-paper-200">
                  {items.length > 0 && <Head w="9rem">Service</Head>}
                  <Head>Description</Head>
                  <Head w="6rem" align="right">Qty</Head>
                  <Head w="7.5rem" align="right">Unit price</Head>
                  <Head w="5rem" align="right">Disc %</Head>
                  <Head w="11rem">Account</Head>
                  <Head w="9rem">Tax</Head>
                  <Head w="7.5rem" align="right">Amount</Head>
                  <Head w="2rem" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  // Index within the priced subset, which is what `preview` holds.
                  const computedIndex = pricedLines.findIndex((priced) => priced.key === line.key);
                  const computed = computedIndex === -1 ? undefined : preview.lines[computedIndex];
                  return (
                    <tr key={line.key} className="border-b border-paper-100 last:border-0">
                      {items.length > 0 && (
                        <Cell>
                          <select
                            value={line.itemId ?? ""}
                            onChange={(event) => applyItem(line.key, event.target.value)}
                            className={clsx(inputClass, "pr-7 text-[0.75rem]")}
                          >
                            <option value="">Custom</option>
                            {items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </Cell>
                      )}
                      <Cell>
                        <input
                          value={line.description}
                          onChange={(event) => updateLine(line.key, { description: event.target.value })}
                          className={inputClass}
                          placeholder="What are you charging for?"
                        />
                      </Cell>
                      <Cell>
                        <input
                          value={line.quantity}
                          onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                          inputMode="decimal"
                          className={clsx(inputClass, "tnum text-right")}
                        />
                      </Cell>
                      <Cell>
                        <input
                          value={line.unitPrice}
                          onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                          inputMode="decimal"
                          placeholder="0.00"
                          className={clsx(inputClass, "tnum text-right")}
                        />
                      </Cell>
                      <Cell>
                        <input
                          value={line.discount}
                          onChange={(event) => updateLine(line.key, { discount: event.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          className={clsx(inputClass, "tnum text-right")}
                        />
                      </Cell>
                      <Cell>
                        <select
                          value={line.accountId}
                          onChange={(event) => updateLine(line.key, { accountId: event.target.value })}
                          className={clsx(inputClass, "pr-7 text-[0.75rem]")}
                        >
                          {accountChoices.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} · {account.name}
                            </option>
                          ))}
                        </select>
                      </Cell>
                      <Cell>
                        <select
                          value={line.taxCodeId}
                          onChange={(event) => updateLine(line.key, { taxCodeId: event.target.value })}
                          className={clsx(inputClass, "pr-7 text-[0.75rem]")}
                        >
                          {offeredCodes.map((code) => (
                            <option key={code.id} value={code.id}>
                              {code.code}
                            </option>
                          ))}
                        </select>
                      </Cell>
                      <Cell align="right">
                        <span className="tnum block pt-1.5 font-medium text-ink-900">
                          {computed ? formatMoney(computed.totalCents) : "—"}
                        </span>
                        {computed && computed.taxCents > 0 && (
                          <span className="tnum block text-[0.6875rem] text-muted-ink">
                            incl. {formatMoney(computed.taxCents)} tax
                          </span>
                        )}
                      </Cell>
                      <Cell>
                        <button
                          type="button"
                          onClick={() =>
                            setLines((current) =>
                              current.length === 1 ? current : current.filter((l) => l.key !== line.key),
                            )
                          }
                          disabled={lines.length === 1}
                          className="grid h-7 w-7 place-items-center rounded text-ink-400 transition-colors hover:bg-negative-soft hover:text-negative disabled:opacity-30 disabled:hover:bg-transparent"
                          aria-label="Remove line"
                        >
                          <Icon name="x" className="h-3.5 w-3.5" />
                        </button>
                      </Cell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3">
            <Button
              onClick={() =>
                setLines((current) => [
                  ...current,
                  {
                    key: crypto.randomUUID(),
                    description: "",
                    quantity: "1",
                    unitPrice: "",
                    discount: "",
                    accountId: current[current.length - 1]?.accountId ?? defaultAccount,
                    taxCodeId: current[current.length - 1]?.taxCodeId ?? defaultTax,
                  },
                ])
              }
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              Add line
            </Button>
          </div>
        </section>
      </div>

      {/* Summary rail */}
      <aside className="space-y-4 sticky-below-header">
        <section className="rounded-[--radius-card] border border-paper-300 bg-white p-5">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">Summary</h2>
          <dl className="mt-3 space-y-1.5 text-[0.8125rem]">
            <SummaryRow label="Subtotal" value={preview.subtotalCents} />
            {preview.discountCents > 0 && <SummaryRow label="Discounts" value={-preview.discountCents} />}
            {preview.taxByComponent.map((component) => (
              <SummaryRow
                key={component.componentId}
                label={`${component.name} ${(component.rateMicro / 10_000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`}
                value={component.taxCents}
              />
            ))}
            <div className="flex items-center justify-between border-t border-paper-300 pt-2 text-[0.9375rem] font-semibold">
              <dt className="text-ink-900">Total</dt>
              <dd className="tnum text-ink-950">{formatMoney(preview.totalCents)}</dd>
            </div>
          </dl>

          {config.postsToLedger ? (
            <div className="mt-4 rounded-lg bg-paper-100 p-3">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                Journal preview
              </p>
              <ul className="mt-1.5 space-y-1 text-[0.75rem] text-ink-700">
                <JournalPreview kind={kind} preview={preview} accountName={accountName} />
              </ul>
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-paper-100 p-3 text-[0.75rem] leading-5 text-muted-ink">
              A quote posts nothing. No balance changes and it appears in no financial statement until it is
              converted to an invoice.
            </p>
          )}

          {config.allowDraft && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-paper-300 p-3">
              <input
                type="checkbox"
                checked={postNow}
                onChange={(event) => setPostNow(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
              />
              <span className="text-[0.8125rem] leading-5 text-ink-800">
                Post to the ledger now
                <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
                  Leave unticked to save a draft. A draft affects no report until it is posted.
                </span>
              </span>
            </label>
          )}

          {error && (
            <p className="mt-3 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
              {error}
            </p>
          )}

          <div className="mt-4 space-y-2">
            {companyProfile && (
              <Button
                variant="primary"
                onClick={() => setPreviewOpen(true)}
                disabled={saving}
                className="w-full"
              >
                <Icon name="search" className="h-3.5 w-3.5" />
                Preview {config.noun}
              </Button>
            )}
            <div className="flex gap-2">
              <Button
                variant={companyProfile ? "secondary" : "primary"}
                onClick={submit}
                disabled={saving}
                className="flex-1"
              >
                {saving ? "Saving…" : primaryLabel}
              </Button>
              <a
                href={cancelHref}
                className="inline-flex items-center rounded-md border border-paper-400 px-3 py-1.5 text-[0.8125rem] text-ink-700 hover:bg-paper-100"
              >
                Cancel
              </a>
            </div>
          </div>
        </section>
      </aside>

      {customerCreation && (
        <Modal
          open={customerDialogOpen}
          onClose={() => setCustomerDialogOpen(false)}
          title="New customer"
          description="Saved straight away, then selected on this document."
          size="lg"
        >
          <CustomerForm
            compact
            taxCodes={customerCreation.taxCodes}
            defaultTermsDays={customerCreation.defaultTermsDays}
            onCancel={() => setCustomerDialogOpen(false)}
            onCreated={(customer) => {
              setPartyList((current) => [...current, customer].sort((a, b) => a.name.localeCompare(b.name)));
              setCustomerDialogOpen(false);
              // Selecting it pulls its addresses and terms onto the document.
              setPartyId(customer.id);
              const nextBill = addressFromParty(customer.name, customer.billTo);
              setBillTo(nextBill);
              setShipTo(customer.shipTo ? addressFromParty(customer.name, customer.shipTo) : EMPTY_ADDRESS);
              setShipSameAsBill(!customer.shipTo);
              repointLines((customer.shipTo?.province ?? nextBill.province) || companyProvince || null);
              if (config.secondDateFromPartyTerms) {
                setSecondDate(
                  new Date(Date.parse(issueDate) + customer.paymentTermsDays * 86_400_000)
                    .toISOString()
                    .slice(0, 10),
                );
              }
            }}
          />
        </Modal>
      )}

      {companyProfile && (
        <Modal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={`Preview — ${config.noun}`}
          description={
            config.postsToLedger
              ? "Nothing has been saved or posted yet. Check it, then post from here."
              : "Nothing has been saved yet."
          }
          size="xl"
          footer={
            <>
              <Button onClick={() => setPreviewOpen(false)} disabled={saving}>
                Back to editing
              </Button>
              <Button variant="primary" onClick={submit} disabled={saving}>
                {saving ? "Saving…" : primaryLabel}
              </Button>
            </>
          }
        >
          <DocumentPreview
            title={config.noun.toUpperCase()}
            number={config.numberLabel ? number : "Allocated on save"}
            company={companyProfile}
            billTo={config.showAddresses ? billTo : addressFromParty(party?.name ?? "", null)}
            shipTo={config.showAddresses ? shipToForPreview : null}
            issueDate={issueDate}
            secondDateLabel={config.secondDateLabel}
            secondDate={config.secondDateLabel ? secondDate : null}
            reference={reference}
            referenceLabel={config.referenceLabel}
            memo={memo}
            taxInclusive={taxInclusive}
            accountName={accountName}
            computed={preview}
          />
        </Modal>
      )}
    </div>
  );
}

/** Sentinel value for the "add a new customer" row in the party dropdown. */
const NEW_PARTY = "__new__";

/**
 * Header columns per kind: the party takes two, then one each for the number and
 * the two dates, as the kind has them. Written out as literal class names because
 * Tailwind cannot see a computed one.
 */
const HEADER_GRID: Record<DocumentKind, string> = {
  INVOICE: "lg:grid-cols-5",
  QUOTE: "lg:grid-cols-5",
  CREDIT_NOTE: "lg:grid-cols-3",
  BILL: "lg:grid-cols-4",
};

function provinceName(code: string) {
  return PROVINCES.find((province) => province.code === code)?.name ?? code;
}

function JournalPreview({
  kind,
  preview,
  accountName,
}: {
  kind: DocumentKind;
  preview: ReturnType<typeof computeDocument>;
  accountName: (accountId: string) => string;
}) {
  const net = groupNet(preview);

  if (kind === "BILL") {
    return (
      <>
        {net.map(([accountId, cents]) => (
          <JournalRow key={accountId} side="Dr" label={accountName(accountId)} value={cents} />
        ))}
        {preview.taxByComponent
          .filter((c) => c.taxCents !== 0 && c.isRecoverable)
          .map((c) => (
            <JournalRow key={c.componentId} side="Dr" label={`${c.name} recoverable`} value={c.taxCents} />
          ))}
        <JournalRow side="Cr" label="Accounts payable" value={preview.totalCents} />
      </>
    );
  }

  // A credit note is the invoice posting run backwards: revenue and the tax that
  // went with it are reversed, and the receivable comes down.
  if (kind === "CREDIT_NOTE") {
    return (
      <>
        {net.map(([accountId, cents]) => (
          <JournalRow key={accountId} side="Dr" label={accountName(accountId)} value={cents} />
        ))}
        {preview.taxByComponent
          .filter((c) => c.taxCents !== 0)
          .map((c) => (
            <JournalRow key={c.componentId} side="Dr" label={`${c.name} payable`} value={c.taxCents} />
          ))}
        <JournalRow side="Cr" label="Accounts receivable" value={preview.totalCents} />
      </>
    );
  }

  return (
    <>
      <JournalRow side="Dr" label="Accounts receivable" value={preview.totalCents} />
      {net.map(([accountId, cents]) => (
        <JournalRow key={accountId} side="Cr" label={accountName(accountId)} value={cents} />
      ))}
      {preview.taxByComponent
        .filter((c) => c.taxCents !== 0)
        .map((c) => (
          <JournalRow key={c.componentId} side="Cr" label={`${c.name} payable`} value={c.taxCents} />
        ))}
    </>
  );
}

function groupNet(preview: ReturnType<typeof computeDocument>) {
  const map = new Map<string, number>();
  for (const line of preview.lines) map.set(line.accountId, (map.get(line.accountId) ?? 0) + line.netCents);
  return [...map.entries()];
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-700">{label}</dt>
      <dd className="tnum text-ink-900">{formatMoney(value)}</dd>
    </div>
  );
}

function JournalRow({ side, label, value }: { side: "Dr" | "Cr"; label: string; value: number }) {
  if (value === 0) return null;
  return (
    <li className="flex items-center gap-2">
      <span className={clsx("w-5 font-semibold", side === "Dr" ? "text-info" : "text-maple-600")}>{side}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="tnum">{formatMoney(value)}</span>
    </li>
  );
}

function Head({ children, w, align = "left" }: { children?: React.ReactNode; w?: string; align?: "left" | "right" }) {
  return (
    <th
      style={w ? { width: w } : undefined}
      className={clsx(
        "px-2 pb-2 pt-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink first:pl-5 last:pr-5",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Cell({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td className={clsx("px-2 py-1.5 align-top first:pl-5 last:pr-5", align === "right" && "text-right")}>{children}</td>;
}

function safeCents(value: string): number {
  try {
    return toCents(value);
  } catch {
    return 0;
  }
}
