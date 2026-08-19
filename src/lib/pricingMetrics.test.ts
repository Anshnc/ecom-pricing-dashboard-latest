import {
  computeRowMetrics,
  deflectionPctFromNlc,
  demandMixPct,
  impactGmFromParts,
  impactPpDiffFromParts,
  resolveGrnPerUnit,
} from "./pricingMetrics";

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
  grnPricePerKg: 40,
  conversionFactor: 0.5,
  grnPricePerUnit: 22,
});
assertClose(grnPerUnit, 22, "GRN/unit prefers stored unit over kg × CF");

const calc = computeRowMetrics(row, totalDemand);
assertClose(calc.impactPpDiff, impactPpDiffFromParts(30, 20, mixPct), "Impact PP");
assertClose(calc.gm, 32 - 20, "GM");
assertClose(calc.impactGm, impactGmFromParts(calc.gm, mixPct), "Impact GM");
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

// No prior NLC → deflection null (shows "—").
const noPrev = computeRowMetrics({ ...row, prevDayNlc: null }, totalDemand);
assertClose(noPrev.deflectionPct, null, "Deflection without prior NLC");

// Unchanged NLC vs yesterday → 0% deflection (valid).
const zeroDefl = computeRowMetrics({ ...row, prevDayNlc: 32 }, totalDemand);
assertClose(zeroDefl.deflectionPct, 0, "Zero deflection when NLC unchanged");

// Negative deflection when NLC drops vs yesterday (valid).
const negDefl = computeRowMetrics({ ...row, prevDayNlc: 40 }, totalDemand);
assertClose(negDefl.deflectionPct, deflectionPctFromNlc(32, 40), "Negative deflection");

// Missing quoted PP → impact PP null (shows "—"), not a fake zero.
const noQuoted = computeRowMetrics({ ...row, quotedPpIsSet: false }, totalDemand);
assertClose(noQuoted.impactPpDiff, null, "Impact PP without quoted PP");

// Zero GM → zero impact GM (valid).
const zeroGm = computeRowMetrics({ ...row, negotiatedPp: 16, quotedPp: 16 }, totalDemand);
assertClose(zeroGm.gm, 0, "GM zero baseline");
assertClose(zeroGm.impactGm, 0, "Zero Impact GM when GM is zero");

console.log("pricingMetrics.test.ts — all assertions passed");
