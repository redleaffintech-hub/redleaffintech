# Sources & Verification — CPP / CPP2 / EI Statutory Rates 2022–2026

Fetched: 2026-10-01. One row per calendar year; `effectiveTo` of year N is Jan 1 of year N+1 (half-open interval, same convention as the payroll tax brackets backfill), except 2026 which is ongoing (`effectiveTo` blank).

## Sources

- CPP (basic exemption, YMPE, rate, max contribution), all 5 years: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html (user-supplied link; fetched directly)
- EI (max insurable earnings, employee rate — both standard and Quebec, employer 1.4x multiplier), all 5 years: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html (user-supplied link; this page's full table runs 1998–2027 and includes a separate Quebec EI rate table, offset by QPIP — see "Quebec EI rate" below)
- CPP2 (YAMPE, rate, max contribution), 2024–2026: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html

## Quebec EI rate

Added as a new `eiRateMicroQuebec` column (migration `20261001120000_add_ei_quebec_rate`) — Quebec runs its own parental insurance plan (QPIP) instead of EI's maternity/parental benefits, so Quebec employees pay EI at a lower rate. Maximum insurable earnings and the 1.4x employer multiplier are the same figure for Quebec as for the rest of Canada; only the employee rate differs. `src/server/payroll/tax-engine.ts`'s `computeCppAndEi` now selects this rate when the employee's `provinceOfEmployment` is `QC`.

| Year | Standard rate | Quebec rate |
|---|---|---|
| 2022 | 1.58% | 1.20% |
| 2023 | 1.63% | 1.27% |
| 2024 | 1.66% | 1.32% |
| 2025 | 1.64% | 1.31% |
| 2026 | 1.63% | 1.30% |

Every Quebec max-employee-premium figure reconciles exactly against rate × max insurable earnings (e.g. 2026: $68,900 × 1.30% = $895.70, matching CRA's published figure).

## QPIP (Québec Parental Insurance Plan)

Added as new `qpipRateMicro` / `qpipEmployerRateMicro` / `qpipMaxInsurableEarningsCents` columns (migration `20261001130000_add_qpip`) — a separate premium Quebec employees pay ON TOP OF CPP and EI, with its own (higher) insurable-earnings maximum. Everyone outside Quebec computes 0. Source (user-supplied link): https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/calculating-source-deductions-and-contributions/qpip-premiums/maximum-insurable-earnings-and-premium-rate/ — this page returned HTTP 403 to automated fetch both times it was tried, so figures are sourced from a web search cross-referencing two independent payroll-reference sites, with the 2026 maximum insurable earnings ($103,000) independently confirmed directly from Quebec's own QPIP regulator site (rqap-lois.gouv.qc.ca), a primary source.

| Year | Max insurable earnings | Employee rate | Employer rate |
|---|---|---|---|
| 2022 | $88,000 | 0.494% | 0.692% |
| 2023 | $91,000 | 0.494% | 0.692% |
| 2024 | $94,000 | 0.494% | 0.692% |
| 2025 | $98,000 | 0.494% | 0.692% |
| 2026 | $103,000 | 0.430% | 0.602% |

Verification: every max-premium figure reconciles exactly against rate × max insurable earnings (e.g. 2026 employee: $103,000 × 0.430% = $442.90; 2026 employer: $103,000 × 0.602% = $620.06 — both match the published maximums). The 2026 rate cut is independently corroborated: Quebec's QPIP regulator announced a 13% rate reduction for 2026, and 0.494% × 0.87 ≈ 0.430%, 0.692% × 0.87 ≈ 0.602% — consistent with the stated cut. Confidence is good but not primary-source-confirmed for the rate percentages themselves (only the 2026 maximum insurable earnings was confirmed directly from revenuquebec.ca's sibling regulator site).

## 2027 — held back

The EI page publishes 2027 already (EI rate 1.64% / 1.29% QC, max insurable earnings $70,800) because EI's rate-setting mechanism runs ahead of CPP's. CPP and CPP2's 2027 figures are NOT yet published by CRA as of this fetch (2026-10-01) — CRA typically announces the next year's YMPE in November. Since this table requires CPP, CPP2 and EI together in one row, 2027 was deliberately left out of this backfill rather than guessing CPP/CPP2 figures; add it once CRA publishes 2027 CPP rates (expected November 2026).

## Verification

Every EI max employee premium reconciles exactly against rate × max insurable earnings (e.g. 2026: $68,900 × 1.63% = $1,123.07, matching CRA's own published maximum). CPP's basic exemption has been a flat $3,500/year since 1998 and is unchanged across 2022–2026.

## CPP2 — 2022 and 2023 (pre-CPP2)

CPP2 did not exist before January 1, 2024. For 2022 and 2023, `cpp2Rate` is set to 0% and `cpp2Max` is set equal to that year's CPP max (YMPE) rather than left blank — the schema's `cpp2MaxPensionableEarningsCents`/`cpp2RateMicro` columns are not nullable, and `cpp2Max == cppMax` makes `src/server/payroll/tax-engine.ts`'s CPP2 band computation `max(0, min(gross, cpp2Max) - cppMax)` always zero, which is the correct "no CPP2" result. This equality intentionally does NOT satisfy the admin single-row form's own validation rule ("CPP2 max must exceed CPP max") — that rule is correct for any year CPP2 actually applies and wasn't relaxed, since the admin UI is for entering current/future years, which will never predate 2024.

## Superseded data

The database previously had one row (2025-01-01, ongoing) from `prisma/seed-payroll-rates.ts`'s "best-effort snapshot... VERIFY" placeholder. Its figures were CPP 5.95%/$71,300, CPP2 4%/$81,200, EI 1.64%/$65,700 — identical to this backfill's sourced 2025 figures, so no discrepancy was found; it was deleted and replaced only to give 2025 a bounded `effectiveTo` (2026-01-01) so 2026's row can be the current, ongoing one without the two overlapping.
