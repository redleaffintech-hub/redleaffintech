/**
 * One-time seed for the payroll statutory rate tables (PayrollStatutoryRate,
 * PayrollTaxBracket) — NOT wired into prisma/seed.ts's main() because, like
 * RegionalTaxRate, these are platform-wide reference rows normally entered by
 * hand through the admin UI (/admin/payroll-rates/statutory,
 * /admin/payroll-rates/tax-brackets), not part of a company's demo data.
 *
 * This gives a new environment a starting point so the payroll calculation
 * engine (src/server/payroll/tax-engine.ts) has something to compute with
 * immediately. The figures below are a best-effort snapshot of 2025 CRA and
 * Ontario published rates — VERIFY against the current CRA/provincial
 * publication before relying on this for a real pay run. Every other province
 * is deliberately left unseeded; add it through the admin UI once confirmed.
 *
 * Run with: npx tsx prisma/seed-payroll-rates.ts
 */
import "../scripts/load-env"; // must precede any import that reads process.env
import { db } from "../src/lib/db";

const EFFECTIVE_FROM = new Date("2025-01-01T00:00:00.000Z");
const REASON_STATUTORY = "2025 CRA-published CPP/CPP2/EI rates — VERIFY against the current CRA publication before relying on this for a real pay run.";
const REASON_BRACKET = "2025 published income-tax brackets — VERIFY against the current CRA/provincial publication before relying on this for a real pay run.";

async function main() {
  const existingStatutory = await db.payrollStatutoryRate.findFirst({ where: { effectiveFrom: EFFECTIVE_FROM } });
  if (!existingStatutory) {
    await db.payrollStatutoryRate.create({
      data: {
        cppRateMicro: 5_950_000, // 5.95%
        cppBasicExemptionCents: 350_000, // $3,500
        cppMaxPensionableEarningsCents: 7_130_000, // $71,300 (YMPE)
        cpp2RateMicro: 4_000_000, // 4%
        cpp2MaxPensionableEarningsCents: 8_120_000, // $81,200 (YAMPE)
        eiRateMicro: 1_640_000, // 1.64%
        eiEmployerMultiplierMicro: 1_400_000, // 1.4x
        eiMaxInsurableEarningsCents: 6_570_000, // $65,700
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
        isActive: true,
        reason: REASON_STATUTORY,
      },
    });
    console.log("Seeded PayrollStatutoryRate for 2025.");
  } else {
    console.log("PayrollStatutoryRate for 2025 already exists — skipped.");
  }

  const federalBrackets = [
    { minCents: 0, maxCents: 5_737_500, rateMicro: 15_00_000 },
    { minCents: 5_737_500, maxCents: 11_475_000, rateMicro: 20_50_000 },
    { minCents: 11_475_000, maxCents: 17_788_200, rateMicro: 26_00_000 },
    { minCents: 17_788_200, maxCents: 25_341_400, rateMicro: 29_00_000 },
    { minCents: 25_341_400, maxCents: null, rateMicro: 33_00_000 },
  ];
  const federalBpaCents = 1_612_900; // $16,129

  const ontarioBrackets = [
    { minCents: 0, maxCents: 5_288_600, rateMicro: 5_05_000 },
    { minCents: 5_288_600, maxCents: 10_577_500, rateMicro: 9_15_000 },
    { minCents: 10_577_500, maxCents: 15_000_000, rateMicro: 11_16_000 },
    { minCents: 15_000_000, maxCents: 22_000_000, rateMicro: 12_16_000 },
    { minCents: 22_000_000, maxCents: null, rateMicro: 13_16_000 },
  ];
  const ontarioBpaCents = 1_274_700; // $12,747

  for (const [jurisdiction, brackets, bpaCents] of [
    ["FEDERAL", federalBrackets, federalBpaCents],
    ["ON", ontarioBrackets, ontarioBpaCents],
  ] as const) {
    const existing = await db.payrollTaxBracket.findFirst({ where: { jurisdiction, effectiveFrom: EFFECTIVE_FROM } });
    if (existing) {
      console.log(`PayrollTaxBracket rows for ${jurisdiction} 2025 already exist — skipped.`);
      continue;
    }
    for (const bracket of brackets) {
      await db.payrollTaxBracket.create({
        data: {
          jurisdiction,
          minCents: bracket.minCents,
          maxCents: bracket.maxCents,
          rateMicro: bracket.rateMicro,
          basicPersonalAmountCents: bpaCents,
          effectiveFrom: EFFECTIVE_FROM,
          effectiveTo: null,
          isActive: true,
          reason: REASON_BRACKET,
        },
      });
    }
    console.log(`Seeded ${brackets.length} PayrollTaxBracket rows for ${jurisdiction} 2025.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
