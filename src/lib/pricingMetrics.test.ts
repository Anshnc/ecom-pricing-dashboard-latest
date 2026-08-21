import {
  avgPiPctFromBkspMix,
  bkValueMixDemandWeightedAvg,
  bkspTotalDemandPctFromParts,
  computeRowMetrics,
  deflectionPctFromNlc,
  demandMixPct,
  displayNlcIsPresent,
  impactGmFromParts,
  impactPpDiffFromParts,
  meanBlinkitSpWhenBothPresent,
  piPctFromDisplayNlc,
  quotedPpIsPresent,
  resolveGrnPerUnit,
  simpleMean,
  totalGrnPerUnitFromParts,
} from "./pricingMetrics";

function assertClose(actual: number | null, expected: number | null, label: string, eps = 0.01) {
  if (actual === null && expected === null) return;
  if (actual === null || expected === null || Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

// Formula checks aligned with business spec:
// Impact PP = (Quoted PP − Total GRN/unit) × Total Demand %
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
const totalGrnPerUnit = totalGrnPerUnitFromParts(40, 0, 0.5);
assertClose(totalGrnPerUnit, 20, "Total GRN/unit");
assertClose(calc.totalGrnPerUnit, 20, "Total GRN/unit in calc");
assertClose(calc.impactPpDiff, impactPpDiffFromParts(30, 20, mixPct), "Impact PP");
assertClose(calc.impactPpDiff, (30 - 20) * (mixPct / 100), "Impact PP formula");
assertClose(calc.gm, 34 - 20, "GM");
assertClose(calc.grnMarkup, 30 - 20, "GRN Markup");
assertClose(calc.impactGm, impactGmFromParts(calc.gm, mixPct), "Impact GM");
assertClose(
  calc.deflectionPct,
  deflectionPctFromNlc(34, 30),
  "Deflection",
);
assertClose(calc.piPct, piPctFromDisplayNlc(50, 34), "PI% displayed NLC");
assertClose(calc.valueMix, 50 * 1_000, "BK Value Mix");
assertClose(calc.nlc, 34, "NLC is Quoted PP + costs");
assertClose(calc.nlcValueMix, 34 * 1_000, "NLC Value Mix matches displayed NLC");

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
assertClose(fallback.impactPpDiff, null, "Impact PP null without GRN/kg for Total GRN");

// Equal quoted PP and GRN → Impact PP is 0, not blank.
const zeroImpact = computeRowMetrics({ ...row, quotedPp: 20 }, totalDemand);
assertClose(zeroImpact.impactPpDiff, 0, "Zero Impact PP when quoted = Total GRN/unit");

// No prior NLC → deflection null (shows "—").
const noPrev = computeRowMetrics({ ...row, prevDayNlc: null }, totalDemand);
assertClose(noPrev.deflectionPct, null, "Deflection without prior NLC");

// Unchanged NLC vs yesterday → 0% deflection (valid).
const zeroDefl = computeRowMetrics({ ...row, prevDayNlc: 34 }, totalDemand);
assertClose(zeroDefl.deflectionPct, 0, "Zero deflection when NLC unchanged");

// Negative deflection when NLC drops vs yesterday (valid).
const negDefl = computeRowMetrics({ ...row, prevDayNlc: 40 }, totalDemand);
assertClose(negDefl.deflectionPct, deflectionPctFromNlc(34, 40), "Negative deflection");

// Missing quoted PP → NLC and all NLC-dependent columns blank.
const noQuoted = computeRowMetrics({ ...row, quotedPpIsSet: false, quotedPp: 0 }, totalDemand);
assertClose(noQuoted.nlc, null, "NLC null without quoted PP");
assertClose(noQuoted.gm, null, "GM null without quoted PP");
assertClose(noQuoted.deflectionPct, null, "Deflection null without quoted PP");
assertClose(noQuoted.piPct, null, "PI% null without quoted PP");
assertClose(noQuoted.nlcValueMix, null, "NLC Value Mix null without quoted PP");
assertClose(noQuoted.impactPpDiff, null, "Impact PP without quoted PP");

// Quoted PP = 0 is valid — NLC is costs only (unchanged).
const quotedZero = computeRowMetrics({ ...row, quotedPp: 0, quotedPpIsSet: true }, totalDemand);
assertClose(quotedZero.nlc, 0 + 2 + 1 + 1, "NLC with quoted PP zero");
assertClose(quotedZero.impactPpDiff, impactPpDiffFromParts(0, 20, mixPct), "Impact PP with quoted PP zero");

// Adjusted GRN shifts Total GRN/unit and GM, not Quoted PP.
const withAdj = computeRowMetrics({ ...row, adjustedGrn: 2 }, totalDemand);
assertClose(withAdj.totalGrnPerUnit, (40 + 2) * 0.5, "Total GRN/unit with adj");
assertClose(withAdj.gm, 34 - 21, "GM with adj");
assertClose(withAdj.grnMarkup, 30 - 21, "GRN Markup with adj");

// Zero GM → zero impact GM (valid).
const zeroGm = computeRowMetrics({ ...row, negotiatedPp: 16, quotedPp: 16 }, totalDemand);
assertClose(zeroGm.gm, 0, "GM zero baseline");
assertClose(zeroGm.impactGm, 0, "Zero Impact GM when GM is zero");

// Missing GRN/kg → no Total GRN/unit, GM null.
const noKg = computeRowMetrics({ ...row, grnPricePerKg: null }, totalDemand);
assertClose(noKg.totalGrnPerUnit, null, "Total GRN/unit without GRN/kg");
assertClose(noKg.gm, null, "GM without GRN/kg");

// PI% uses displayed NLC; when Negotiated was never set, NLC is Quoted + costs.
const noNeg = computeRowMetrics({ ...row, negotiatedPpIsSet: false }, totalDemand);
assertClose(noNeg.piPct, piPctFromDisplayNlc(50, 34), "PI% without negotiated PP uses Quoted NLC");
assertClose(noNeg.nlc, 34, "NLC uses Quoted PP when Negotiated was never set");

const noSp = computeRowMetrics({ ...row, blinkitSp: null }, totalDemand);
assertClose(noSp.piPct, null, "PI% blank when Blinkit SP is missing");
assertClose(noSp.bkspTotalDemandPct, 0, "bksp total demand% is 0 when Blinkit SP is missing");

const zeroSp = computeRowMetrics({ ...row, blinkitSp: 0 }, totalDemand);
assertClose(zeroSp.piPct, null, "PI% blank when Blinkit SP is 0");
assertClose(zeroSp.bkspTotalDemandPct, 0, "bksp total demand% is 0 when Blinkit SP is 0");
assertClose(
  computeRowMetrics(row, totalDemand).bkspTotalDemandPct,
  mixPct,
  "bksp total demand% equals Total Demand % when Blinkit SP is present",
);

// Simple mean of Blinkit SP / PI% / BK mix skips NA/blanks.
assertClose(simpleMean([50, 150, null]), 100, "Blinkit SP simple mean skips blank");
assertClose(simpleMean([10, 20, null]), 15, "PI% simple mean skips blank");
assertClose(
  bkValueMixDemandWeightedAvg([
    { totalDemandPct: 60, blinkitSp: 50 },
    { totalDemandPct: 40, blinkitSp: 100 },
  ]),
  (60 * 50 + 40 * 100) / 100,
  "BK Value Mix avg = SUMPRODUCT(demand %, Blinkit SP) / sum(demand %)",
);
assertClose(simpleMean([null, undefined, Number.NaN]), null, "All-blank average is null");
assertClose(simpleMean([0, 10]), 5, "Zero is data, not blank");

function assertTrue(actual: boolean, label: string) {
  if (!actual) throw new Error(`${label}: expected true, got ${actual}`);
}
function assertFalse(actual: boolean, label: string) {
  if (actual) throw new Error(`${label}: expected false, got ${actual}`);
}

assertTrue(displayNlcIsPresent({ quotedPp: 30, quotedPpIsSet: true }), "NLC present when Quoted PP is set");
assertTrue(displayNlcIsPresent({ quotedPp: 0, quotedPpIsSet: true }), "NLC present when Quoted PP is zero");
assertFalse(displayNlcIsPresent({ quotedPp: 0, quotedPpIsSet: false }), "NLC absent when Quoted PP not entered");
assertFalse(
  displayNlcIsPresent({ quotedPp: 0, quotedPpIsSet: false, negotiatedPp: 28, negotiatedPpIsSet: true }),
  "Negotiated PP alone does not make NLC present",
);

// Count / denominator is only rows where NLC and Blinkit SP are both present.
assertClose(
  meanBlinkitSpWhenBothPresent([
    { blinkitSp: 50, quotedPp: 30, quotedPpIsSet: true, negotiatedPp: 28, negotiatedPpIsSet: true },
    { blinkitSp: 150, quotedPp: 0, quotedPpIsSet: false, negotiatedPp: 0, negotiatedPpIsSet: false },
    { blinkitSp: null, quotedPp: 40, quotedPpIsSet: true, negotiatedPp: 40, negotiatedPpIsSet: true },
    { blinkitSp: 100, quotedPp: 20, quotedPpIsSet: true, negotiatedPp: 20, negotiatedPpIsSet: true },
    { blinkitSp: 0, quotedPp: 10, quotedPpIsSet: true, negotiatedPp: 10, negotiatedPpIsSet: true },
  ]),
  50,
  "Blinkit SP average counts only paired NLC+SP rows; 0 SP still counts",
);
assertClose(
  meanBlinkitSpWhenBothPresent([
    { blinkitSp: 80, quotedPp: 0, quotedPpIsSet: false, negotiatedPp: 0, negotiatedPpIsSet: false },
    { blinkitSp: null, quotedPp: 40, quotedPpIsSet: true, negotiatedPp: 40, negotiatedPpIsSet: true },
  ]),
  null,
  "Blinkit SP average is null when no paired NLC+SP rows",
);

// Avg PI% = SUMPRODUCT(PI%, bksp total demand%) / SUM(bksp total demand%)
assertClose(
  avgPiPctFromBkspMix([
    { piPct: 20, bkspTotalDemandPct: 50 },
    { piPct: 40, bkspTotalDemandPct: 30 },
    { piPct: null, bkspTotalDemandPct: 0 },
    { piPct: null, bkspTotalDemandPct: 0 },
  ]),
  (20 * 50 + 40 * 30) / 80,
  "Avg PI% = SUMPRODUCT(PI%, bksp mix) / SUM(bksp mix); missing/zero SP contribute 0",
);
assertClose(
  avgPiPctFromBkspMix([
    { piPct: 10, bkspTotalDemandPct: bkspTotalDemandPctFromParts(60, 50) },
    { piPct: 30, bkspTotalDemandPct: bkspTotalDemandPctFromParts(40, 0) },
  ]),
  10,
  "Avg PI% ignores mix of SKUs with Blinkit SP = 0",
);
assertClose(
  avgPiPctFromBkspMix([
    { piPct: null, bkspTotalDemandPct: 0 },
    { piPct: null, bkspTotalDemandPct: 0 },
  ]),
  null,
  "Avg PI% is null when SUM(bksp total demand%) is 0",
);

// Negotiated PP is never part of NLC, even when it is set and differs from Quoted.
const ignoresNeg = computeRowMetrics(
  { ...row, negotiatedPp: 897, negotiatedPpIsSet: true },
  totalDemand,
);
assertClose(ignoresNeg.nlc, 30 + 2 + 1 + 1, "NLC ignores Negotiated PP");
assertClose(ignoresNeg.nlcValueMix, 34 * 1_000, "NLC Value Mix follows Quoted NLC");

console.log("pricingMetrics.test.ts — all assertions passed");
