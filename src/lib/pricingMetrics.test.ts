import {
  basketPiPctAvg,
  computeRowMetrics,
  deflectionPctFromNlc,
  demandMixPct,
  displayNlcIsPresent,
  impactGmFromParts,
  impactPpDiffFromParts,
  meanBlinkitSpWhenBothPresent,
  piPctFromDisplayNlc,
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
assertClose(calc.gm, 32 - 20, "GM");
assertClose(calc.grnMarkup, 30 - 20, "GRN Markup");
assertClose(calc.impactGm, impactGmFromParts(calc.gm, mixPct), "Impact GM");
assertClose(
  calc.deflectionPct,
  deflectionPctFromNlc(32, 30),
  "Deflection",
);
assertClose(calc.piPct, piPctFromDisplayNlc(50, 32), "PI% displayed NLC");
assertClose(calc.valueMix, 50 * 1_000, "BK Value Mix");

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
const zeroDefl = computeRowMetrics({ ...row, prevDayNlc: 32 }, totalDemand);
assertClose(zeroDefl.deflectionPct, 0, "Zero deflection when NLC unchanged");

// Negative deflection when NLC drops vs yesterday (valid).
const negDefl = computeRowMetrics({ ...row, prevDayNlc: 40 }, totalDemand);
assertClose(negDefl.deflectionPct, deflectionPctFromNlc(32, 40), "Negative deflection");

// Missing quoted PP → impact PP null (shows "—"), not a fake zero.
const noQuoted = computeRowMetrics({ ...row, quotedPpIsSet: false }, totalDemand);
assertClose(noQuoted.impactPpDiff, null, "Impact PP without quoted PP");

// Adjusted GRN shifts Total GRN/unit and GM, not Quoted PP.
const withAdj = computeRowMetrics({ ...row, adjustedGrn: 2 }, totalDemand);
assertClose(withAdj.totalGrnPerUnit, (40 + 2) * 0.5, "Total GRN/unit with adj");
assertClose(withAdj.gm, 32 - 21, "GM with adj");
assertClose(withAdj.grnMarkup, 30 - 21, "GRN Markup with adj");

// Zero GM → zero impact GM (valid).
const zeroGm = computeRowMetrics({ ...row, negotiatedPp: 16, quotedPp: 16 }, totalDemand);
assertClose(zeroGm.gm, 0, "GM zero baseline");
assertClose(zeroGm.impactGm, 0, "Zero Impact GM when GM is zero");

// Missing GRN/kg → no Total GRN/unit, GM null.
const noKg = computeRowMetrics({ ...row, grnPricePerKg: null }, totalDemand);
assertClose(noKg.totalGrnPerUnit, null, "Total GRN/unit without GRN/kg");
assertClose(noKg.gm, null, "GM without GRN/kg");

// PI% uses displayed NLC; still calculated when Negotiated PP was never set.
const noNeg = computeRowMetrics({ ...row, negotiatedPpIsSet: false }, totalDemand);
assertClose(noNeg.piPct, piPctFromDisplayNlc(50, 32), "PI% without negotiated PP still uses displayed NLC");
assertClose(noNeg.nlc, 32, "NLC still uses the displayed PP path");

const noSp = computeRowMetrics({ ...row, blinkitSp: null }, totalDemand);
assertClose(noSp.piPct, null, "PI% blank when Blinkit SP is missing");

// Simple mean of Blinkit SP / PI% / BK mix skips NA/blanks.
assertClose(simpleMean([50, 150, null]), 100, "Blinkit SP simple mean skips blank");
assertClose(simpleMean([10, 20, null]), 15, "PI% simple mean skips blank");
assertClose(simpleMean([5000, 120000, null]), 62500, "BK Value Mix simple mean skips blank");
assertClose(simpleMean([null, undefined, Number.NaN]), null, "All-blank average is null");
assertClose(simpleMean([0, 10]), 5, "Zero is data, not blank");

function assertTrue(actual: boolean, label: string) {
  if (!actual) throw new Error(`${label}: expected true, got ${actual}`);
}
function assertFalse(actual: boolean, label: string) {
  if (actual) throw new Error(`${label}: expected false, got ${actual}`);
}

assertTrue(displayNlcIsPresent({ quotedPp: 30, quotedPpIsSet: true, negotiatedPp: 0, negotiatedPpIsSet: false }), "NLC present when Quoted PP is set");
assertTrue(displayNlcIsPresent({ quotedPp: 0, quotedPpIsSet: false, negotiatedPp: 28, negotiatedPpIsSet: true }), "NLC present when only Negotiated PP is set");
assertFalse(displayNlcIsPresent({ quotedPp: 0, quotedPpIsSet: false, negotiatedPp: 0, negotiatedPpIsSet: false }), "NLC absent when neither PP is entered");
assertFalse(displayNlcIsPresent({ quotedPp: 0, quotedPpIsSet: true, negotiatedPp: 0, negotiatedPpIsSet: false }), "Quoted PP of 0 is not NLC");

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

// PI% average = ((Σ demand×BK SP) − (Σ demand×NLC)) / (Σ demand×BK SP) × 100
assertClose(
  basketPiPctAvg([
    { demandUnits: 10, blinkitSp: 50, nlc: 30 },
    { demandUnits: 20, blinkitSp: 80, nlc: 40 },
    { demandUnits: 100, blinkitSp: null, nlc: 10 },
  ]),
  ((10 * 50 + 20 * 80) - (10 * 30 + 20 * 40)) / (10 * 50 + 20 * 80) * 100,
  "PI% avg uses demand×SP and demand×NLC; missing BK SP excluded",
);
assertClose(
  basketPiPctAvg([
    { demandUnits: 10, blinkitSp: 50, nlc: 30 },
    { demandUnits: 20, blinkitSp: 80, nlc: null },
  ]),
  ((10 * 50) - (10 * 30)) / (10 * 50) * 100,
  "PI% avg excludes rows missing NLC",
);
assertClose(
  basketPiPctAvg([
    { demandUnits: 10, blinkitSp: null, nlc: 30 },
    { demandUnits: 20, blinkitSp: 0, nlc: 40 },
  ]),
  null,
  "PI% avg is null when no BK SP value to divide by",
);

console.log("pricingMetrics.test.ts — all assertions passed");
