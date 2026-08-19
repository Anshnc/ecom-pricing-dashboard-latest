import { computeRowMetrics, deflectionPctFromNlc, demandMixPct, resolveGrnPerUnit } from "./pricingMetrics";

function assertClose(actual: number | null, expected: number | null, label: string, eps = 0.01) {
  if (actual === null && expected === null) return;
  if (actual === null || expected === null || Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

// Formula checks aligned with business spec:
// Impact PP = (Quoted PP − GRN/unit) × Total Demand %
// Impact GM = (NLC − GRN/unit) × Total Demand % = GM × Total Demand %
// Deflection = ((today NLC − prev NLC) / prev NLC) × 100

const totalDemand = 10_000;
const row = {
  demandUnits: 1_000,
  conversionFactor: 0.5,
  grnPricePerKg: 40,
  grnPricePerUnit: 20,
  prevDayGrnPerUnit: 18,
  quotedPp: 30,
  negotiatedPp: 28,
  packagingCost: 2,
  fmlCost: 1,
  processingCost: 1,
  blinkitSp: 50,
  prevDayNlc: 30,
};

const mixPct = demandMixPct(row.demandUnits, totalDemand);
assertClose(mixPct, 10, "Total Demand %");

const grnPerUnit = resolveGrnPerUnit({
  grnPricePerKg: row.grnPricePerKg,
  conversionFactor: row.conversionFactor,
  grnPricePerUnit: row.grnPricePerUnit,
});
assertClose(grnPerUnit, 20, "GRN/unit from kg × CF");

const calc = computeRowMetrics(row, totalDemand);
assertClose(calc.impactPpDiff, (30 - 20) * (mixPct / 100), "Impact PP");
assertClose(calc.gm, 32 - 20, "GM");
assertClose(calc.impactGm, calc.gm! * (mixPct / 100), "Impact GM");
assertClose(
  calc.deflectionPct,
  deflectionPctFromNlc(32, 30),
  "Deflection",
);

// Missing GRN/kg should fall back to stored unit (common Aug sheet case).
const fallback = computeRowMetrics(
  {
    ...row,
    grnPricePerKg: null,
    grnPricePerUnit: 22,
  },
  totalDemand,
);
assertClose(fallback.grnPerUnit, 22, "GRN/unit fallback");
assertClose(fallback.impactPpDiff, (30 - 22) * (mixPct / 100), "Impact PP with fallback GRN");

// Equal quoted PP and GRN → Impact PP is 0, not blank.
const zeroImpact = computeRowMetrics({ ...row, quotedPp: 20 }, totalDemand);
assertClose(zeroImpact.impactPpDiff, 0, "Zero Impact PP when quoted = GRN");

// No prior NLC → deflection null.
const noPrev = computeRowMetrics({ ...row, prevDayNlc: null }, totalDemand);
assertClose(noPrev.deflectionPct, null, "Deflection without prior NLC");

console.log("pricingMetrics.test.ts — all assertions passed");
