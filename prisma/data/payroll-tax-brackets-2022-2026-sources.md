# Sources & Verification — Canadian Payroll Tax Brackets 2022–2026

Fetched: 2026-10-01. All dollar figures are marginal income tax bracket thresholds/rates and Basic Personal Amount (BPA) only — provincial surtaxes, health premiums and other levies are intentionally excluded per spec. Quebec uses the same FEDERAL bracket numbers as every other jurisdiction (no federal abatement applied).

## Primary sources used

- CRA "All years" bracket table (federal + all PT except QC, years 2022–2024): https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/all-years.html
- CRA "Current year" (2026) bracket table (federal + all PT except QC): https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years/current-year.html
- CRA "Last year" (2025) bracket table (federal + all PT except QC): https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/last-year.html
- CRA T4032-ON payroll deductions general info (cross-check for 2026 federal + Ontario): https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032on-jan/t4032on-january-general-information.html
- TaxTips.ca "Non-Refundable Personal Tax Credits — Base Amounts" (BPA by jurisdiction, used for ALL jurisdictions' BPA, all 5 years — CRA's own bracket pages do not list BPA): https://www.taxtips.ca/nrcredits/tax-credits-2022-base.htm, tax-credits-2023-base.htm, tax-credits-2024-base.htm, tax-credits-2025-base.htm, tax-credits-2026.htm
- TaxTips.ca Quebec bracket pages (Quebec runs its own system via Revenu Québec; TaxTips cites Revenu Québec's published parameters): https://www.taxtips.ca/priortaxrates/tax-rates-2022-2023/qc.htm (2022, 2023), search-derived figures cross-checked for 2024, https://www.taxtips.ca/taxrates/qc.htm (2025, 2026)
- Revenu Québec official site (revenuquebec.ca) income tax rates page returned HTTP 403 to automated fetch — could not fetch directly; relied on TaxTips.ca as a secondary source that explicitly cites Revenu Québec's official indexed parameters, and cross-checked the indexation-factor arithmetic across years for internal consistency (each year's BPA/threshold increase matches the publicly reported annual indexation factor).

## Per jurisdiction/year notes

### FEDERAL
- 2022, 2023, 2024: brackets confirmed via CRA all-years page; matches figures supplied in the task prompt exactly.
- 2025: 14.5% lowest-bracket rate (not 15%) — this is the CRA-published BLENDED full-year rate reflecting the mid-year cut from 15% to 14% effective July 1, 2025. Confirmed via CRA "last-year" page and cross-checked by independent web search.
- 2026: lowest bracket is 14% (the new rate in full effect for the full year). Confirmed via CRA "current-year" page and the T4032-ON payroll table.
- BPA is income-tested since 2020 (full enhanced amount for lower incomes, clawed back to a base amount at higher incomes). Per task instruction, used the MAXIMUM/lower-income BPA figure for each year: 2022 $14,398; 2023 $15,000; 2024 $15,705; 2025 $16,129; 2026 $16,452 (source: TaxTips.ca BPA tables, consistent with CRA's own cited 2025/2026 figures).

### AB (Alberta)
- 2022–2024: 5 brackets (10/12/13/14/15%), confirmed via CRA all-years page.
- 2025, 2026: Alberta introduced a NEW lowest 8% bracket (new tax cut), making it 6 brackets. Confirmed via CRA current-year/last-year pages.
- BPA confirmed via TaxTips.ca for all 5 years.

### BC (British Columbia)
- 2022–2025: lowest rate 5.06%, confirmed via CRA.
- 2026: lowest rate increased to 5.6% — confirmed via CRA current-year page (genuine rate change, not a transcription artifact).
- BPA confirmed via TaxTips.ca for all 5 years.

### MB (Manitoba)
- 2022: BPA $10,145 — notably lower than 2023's $15,000 (Manitoba significantly raised its BPA starting 2023; both figures confirmed via TaxTips.ca and are consistent with known MB budget history).
- 2025 and 2026 brackets AND BPA are IDENTICAL to each other ($47,564/$101,200 thresholds, $15,780 BPA) — Manitoba did not index thresholds/BPA for 2026; confirmed via CRA current-year page (2026) matching last-year page (2025) exactly. Flagging as verified-but-unusual, not an error.

### NB (New Brunswick)
- 2022: 5-bracket structure (9.4/14.82/16.52/17.84/20.3%) — NB simplified to 4 brackets starting 2023 (9.4/14/16/19.5%). Both confirmed via CRA all-years page.

### NL (Newfoundland and Labrador)
- All 5 years confirmed via CRA (8-bracket structure, consistent across years, confirmed with indexed thresholds).

### NS (Nova Scotia)
- 2022–2024: brackets AND BPA ($8,481) are FROZEN/identical across all three years — Nova Scotia did not index brackets or BPA until 2025. Confirmed via CRA (brackets) and TaxTips.ca (BPA, which shows $8,481 flat for 2022/2023/2024).
- 2025, 2026: NS began indexing; BPA jumped to $11,744 (2025) and $11,932 (2026). Confirmed via CRA (brackets) and TaxTips.ca (BPA).

### NT (Northwest Territories)
- All 5 years confirmed via CRA (4-bracket structure, consistently indexed).

### NU (Nunavut)
- All 5 years confirmed via CRA (4-bracket structure, consistently indexed; several thresholds mirror federal thresholds by design).

### ON (Ontario)
- All 5 years confirmed via CRA (5-bracket structure, consistently indexed) and cross-checked against the T4032-ON payroll table for 2026.
- Note: Ontario's additional "surtax" (20%/36% on ON tax payable above certain thresholds) is excluded per spec — only core brackets/BPA included.

### PE (Prince Edward Island)
- 2022, 2023: 3-bracket structure (9.8/13.8/16.7%), identical thresholds both years (frozen, unindexed) — confirmed via CRA.
- 2024: PEI restructured to 5 brackets (9.65/13.63/16.65/18.00/18.75%) — confirmed via CRA.
- 2025: 5 brackets again but with DIFFERENT rates (9.5/13.47/16.6/17.62/19%) than 2024 — confirmed via CRA last-year page; this reflects a further PEI rate reduction, not a data error.
- 2026: PEI added a NEW top bracket (6 brackets total: 9.5/13.47/16.6/17.62/19/20%, new top threshold $200,000) — confirmed via CRA current-year page.
- Note: PEI's surtax is excluded per spec.

### QC (Quebec)
- Quebec runs its own system via Revenu Québec, not CRA. Direct fetch of revenuquebec.ca returned HTTP 403 (blocked automated access); all QC figures sourced from TaxTips.ca, which explicitly cites Revenu Québec's official indexed parameters.
- 2022: 4 brackets, 15/20/24/25.75% (pre-2023 rate-cut structure).
- 2023 onward: Quebec's 2023 budget cut the bottom two rates to 14%/19% — confirmed via TaxTips.ca, consistent across 2023–2026 bracket progression (only thresholds move, rates stay 14/19/24/25.75%).
- BPA progression (16,143 → 17,183 → 18,056 → 18,571 → 18,952) was cross-checked arithmetically against each year's publicly reported indexation factor (e.g. 2024's 5.08% factor: 17,183 × 1.0508 ≈ 18,055, matches) — internally consistent, moderate confidence (secondary source, not the official PDF, which could not be parsed as it returned binary/encoded content).
- Per task instruction, did NOT attempt to compute/apply the Quebec federal abatement — FEDERAL rows for QC are identical to the FEDERAL rows for every other jurisdiction.

### SK (Saskatchewan)
- All 5 years confirmed via CRA (3-bracket structure, consistently indexed).

### YT (Yukon)
- All 5 years confirmed via CRA. Yukon's first three bracket thresholds are set equal to the FEDERAL thresholds by territorial design (confirmed consistent in source data for every year).

## Items NOT fully confirmed from a primary government source (lower confidence)

- **Quebec (all years)**: sourced from TaxTips.ca (secondary) rather than revenuquebec.ca directly, because the official site blocked automated fetch (403) and the official PDF parameter document could not be parsed (returned corrupted/binary text to the fetch tool). Cross-checked internally via indexation-factor arithmetic across consecutive years — all factors reconcile cleanly, giving reasonable confidence despite the secondary sourcing.
- All other jurisdiction/year combinations (FEDERAL, AB, BC, MB, NB, NL, NS, NT, NU, ON, PE, SK, YT for 2022–2026) were confirmed directly from canada.ca (CRA) official bracket pages. BPA figures for these jurisdictions came from TaxTips.ca (CRA's own bracket pages do not publish BPA figures on the same pages), but TaxTips.ca's BPA tables are a well-established, frequently-cited compilation and the federal 2025/2026 BPA figures matched independently via CRA-adjacent search results.

## 2026 availability

2026 figures WERE available and used for all 14 jurisdictions, including Quebec. No jurisdiction had to fall back to a 2025-as-latest row.
