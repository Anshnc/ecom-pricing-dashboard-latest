import {
  computeRowMetrics,
  demandMixPct,
  displayNlcIsPresent,
  impactGmFromParts,
  impactPpDiffFromParts,
  piPctFromDisplayNlc,
  quotedNlcFromParts,
  totalGrnPerUnitFromParts,
  type RowMetricsInput,
} from "@/lib/pricingMetrics";
import type { PricingSheetRow } from "@/lib/supabase";

const EPS = 0.02;

export type ColumnBug = {
  column: string;
  hypothesisId: string;
  fsnId: string;
  weightUnit: string;
  message: string;
  expected: number | null;
  actual: number | null;
  dbValue?: number | null;
};

export type ColumnSummary = {
  column: string;
  ok: number;
  bugs: number;
  sampleBug?: ColumnBug;
};

export type SheetValidationReport = {
  deliveryDate: string;
  city: string;
  rowCount: number;
  totalDemand: number;
  columnSummaries: ColumnSummary[];
  bugs: ColumnBug[];
};

type SkuLike = {
  fsnId: string;
  weightUnit: string;
  demandUnits: number;
  conversionFactor: number;
  grnPricePerKg: number | null;
  grnPricePerUnit: number | null;
  prevDayGrnPerUnit: number | null;
  t3GrnPricePerUnit: number | null;
  adjustedGrn: number;
  quotedPp: number;
  quotedPpIsSet: boolean;
  negotiatedPp: number;
  negotiatedPpIsSet: boolean;
  packagingCost: number;
  fmlCost: number;
  processingCost: number;
  blinkitSp: number | null;
  prevDayNlc: number | null;
};

function close(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= EPS;
}

function pushBug(
  bugs: ColumnBug[],
  column: string,
  hypothesisId: string,
  row: SkuLike,
  message: string,
  expected: number | null,
  actual: number | null,
  dbValue?: number | null,
) {
  bugs.push({
    column,
    hypothesisId,
    fsnId: row.fsnId,
    weightUnit: row.weightUnit,
    message,
    expected,
    actual,
    dbValue,
  });
}

export function dbRowToSkuLike(r: PricingSheetRow): SkuLike {
  return {
    fsnId: r.fsn_id ?? r.id ?? "",
    weightUnit: r.weight_unit ?? "",
    demandUnits: r.demand_units ?? 0,
    conversionFactor: r.cf ?? 1,
    grnPricePerKg: r.grn_price_per_kg,
    grnPricePerUnit: r.grn_price_per_unit,
    prevDayGrnPerUnit: r.prev_grn_price_per_unit,
    t3GrnPricePerUnit: r.t3_grn_price_per_unit,
    adjustedGrn: r.adjusted_grn ?? 0,
    quotedPp: r.quoted_pp ?? 0,
    quotedPpIsSet: r.quoted_pp != null,
    negotiatedPp:
      r.negotiated_pp != null && r.negotiated_pp !== 0 ? r.negotiated_pp : (r.quoted_pp ?? 0),
    negotiatedPpIsSet: r.negotiated_pp != null && r.negotiated_pp !== 0,
    packagingCost: r.pm_cost ?? 0,
    fmlCost: r.fml_dump ?? 0,
    processingCost: r.pc ?? 0,
    blinkitSp: r.blinkit_sp,
    prevDayNlc: r.prev_day_nlc ?? null,
  };
}

export function validatePricingSheetRows(
  rows: PricingSheetRow[],
  opts?: { deliveryDate?: string; city?: string },
): SheetValidationReport {
  const skus = rows.map(dbRowToSkuLike);
  const totalDemand = skus.reduce((s, r) => s + r.demandUnits, 0);
  const bugs: ColumnBug[] = [];
  const columnOk = new Map<string, number>();
  const columnBugCount = new Map<string, number>();

  const bump = (column: string, ok: boolean) => {
    if (ok) columnOk.set(column, (columnOk.get(column) ?? 0) + 1);
    else columnBugCount.set(column, (columnBugCount.get(column) ?? 0) + 1);
  };

  for (let i = 0; i < rows.length; i++) {
    const db = rows[i]!;
    const sku = skus[i]!;
    const input: RowMetricsInput = {
      demandUnits: sku.demandUnits,
      conversionFactor: sku.conversionFactor,
      grnPricePerKg: sku.grnPricePerKg,
      grnPricePerUnit: sku.grnPricePerUnit,
      prevDayGrnPerUnit: sku.prevDayGrnPerUnit,
      t3GrnPricePerUnit: sku.t3GrnPricePerUnit,
      adjustedGrn: sku.adjustedGrn,
      quotedPp: sku.quotedPp,
      quotedPpIsSet: sku.quotedPpIsSet,
      negotiatedPp: sku.negotiatedPp,
      negotiatedPpIsSet: sku.negotiatedPpIsSet,
      packagingCost: sku.packagingCost,
      fmlCost: sku.fmlCost,
      processingCost: sku.processingCost,
      blinkitSp: sku.blinkitSp,
      prevDayNlc: sku.prevDayNlc,
    };
    const calc = computeRowMetrics(input, totalDemand);

    // A — Total Demand %
    const expMix = demandMixPct(sku.demandUnits, totalDemand);
    const mixOk = close(calc.totalDemandPct, expMix);
    bump("Total Demand %", mixOk);
    if (!mixOk) {
      pushBug(bugs, "Total Demand %", "A", sku, "Live mix % mismatch", expMix, calc.totalDemandPct, db.demand_pct);
    }

    // B — Total GRN ₹/unit
    const expTotalGrn = totalGrnPerUnitFromParts(sku.grnPricePerKg, sku.adjustedGrn, sku.conversionFactor);
    const totalGrnOk = close(calc.totalGrnPerUnit, expTotalGrn);
    bump("Total GRN ₹/unit", totalGrnOk);
    if (!totalGrnOk) {
      pushBug(
        bugs,
        "Total GRN ₹/unit",
        "B",
        sku,
        "Total GRN formula mismatch",
        expTotalGrn,
        calc.totalGrnPerUnit,
        db.total_grn_per_unit,
      );
    }

    // C — NLC absent until Quoted PP entered (Negotiated PP ignored)
    const nlcPresent = displayNlcIsPresent(sku);
    const expNlc = nlcPresent
      ? quotedNlcFromParts(sku.quotedPp, sku.packagingCost, sku.fmlCost, sku.processingCost)
      : null;
    const nlcAbsentOk = nlcPresent ? calc.nlc !== null : calc.nlc === null;
    bump("NLC until Quoted PP entered", nlcAbsentOk);
    if (!nlcAbsentOk) {
      pushBug(
        bugs,
        "NLC",
        "C",
        sku,
        nlcPresent ? "NLC missing when Quoted PP entered" : "NLC shown before Quoted PP entered",
        expNlc,
        calc.nlc,
        db.nlc,
      );
    }

    // D — NLC formula when Quoted PP is present
    const nlcFormulaOk = close(calc.nlc, expNlc);
    bump("NLC formula", nlcFormulaOk);
    if (!nlcFormulaOk) {
      pushBug(bugs, "NLC formula", "D", sku, "NLC != Quoted PP + costs", expNlc, calc.nlc, db.nlc);
    }

    // E — PI %
    const expPi = piPctFromDisplayNlc(sku.blinkitSp, calc.nlc);
    const piOk = close(calc.piPct, expPi);
    bump("PI %", piOk);
    if (!piOk) {
      pushBug(bugs, "PI %", "E", sku, "PI% display rule mismatch", expPi, calc.piPct, db.pi_pct);
    }

    // F — GM
    const expGm =
      calc.nlc !== null && calc.totalGrnPerUnit != null ? calc.nlc - calc.totalGrnPerUnit : null;
    const gmOk = close(calc.gm, expGm);
    bump("GM", gmOk);
    if (!gmOk) {
      pushBug(bugs, "GM", "F", sku, "GM != NLC − Total GRN/unit", expGm, calc.gm, db.gm);
    }

    // G — GRN Markup
    const expMarkup = calc.totalGrnPerUnit != null ? sku.quotedPp - calc.totalGrnPerUnit : null;
    const markupOk = close(calc.grnMarkup, expMarkup);
    bump("GRN Markup", markupOk);
    if (!markupOk) {
      pushBug(bugs, "GRN Markup", "G", sku, "GRN Markup != Quoted PP − Total GRN", expMarkup, calc.grnMarkup, null);
    }

    // H — Impact PP Diff
    const quotedForImpact = sku.quotedPpIsSet === false ? null : sku.quotedPp;
    const expImpactPp = impactPpDiffFromParts(quotedForImpact, calc.totalGrnPerUnit, calc.totalDemandPct);
    const impactPpOk = close(calc.impactPpDiff, expImpactPp);
    bump("Impact PP Diff", impactPpOk);
    if (!impactPpOk) {
      pushBug(
        bugs,
        "Impact PP Diff",
        "H",
        sku,
        "Impact PP formula mismatch",
        expImpactPp,
        calc.impactPpDiff,
        db.impact_pp_diff,
      );
    }

    // I — Impact GM
    const expImpactGm = impactGmFromParts(calc.gm, calc.totalDemandPct);
    const impactGmOk = close(calc.impactGm, expImpactGm);
    bump("Impact GM", impactGmOk);
    if (!impactGmOk) {
      pushBug(
        bugs,
        "Impact GM",
        "I",
        sku,
        "Impact GM != GM × Total Demand %",
        expImpactGm,
        calc.impactGm,
        db.impact_gm,
      );
    }

    // J — UI calc vs DB stored derived columns
    const dbPairs: Array<[string, number | null | undefined, number | null, string]> = [
      ["DB total_grn_per_unit", db.total_grn_per_unit, calc.totalGrnPerUnit, "B"],
      ["DB nlc", db.nlc, calc.nlc, "D"],
      ["DB gm", db.gm, calc.gm, "F"],
      ["DB impact_gm", db.impact_gm, calc.impactGm, "I"],
      ["DB impact_pp_diff", db.impact_pp_diff, calc.impactPpDiff, "H"],
      ["DB pi_pct", db.pi_pct, calc.piPct, "E"],
      ["DB grn_diff", db.grn_diff, calc.grnDiff, "B"],
      ["DB bk_value_mix", db.bk_value_mix, calc.valueMix, "K"],
    ];
    for (const [col, dbVal, uiVal, hid] of dbPairs) {
      const ok = close(dbVal ?? null, uiVal);
      bump(`${col} vs UI`, ok);
      if (!ok) {
        pushBug(bugs, col, hid, sku, `${col} differs from UI recomputation`, uiVal, dbVal ?? null, dbVal ?? null);
      }
    }

    // K — BK Value Mix
    const expBk = sku.blinkitSp != null ? sku.blinkitSp * sku.demandUnits : null;
    const bkOk = close(calc.valueMix, expBk);
    bump("BK Value Mix", bkOk);
    if (!bkOk) {
      pushBug(bugs, "BK Value Mix", "K", sku, "BK Value Mix != SP × demand", expBk, calc.valueMix, db.bk_value_mix);
    }

    // L — NLC Value Mix
    const expNlcMix = calc.nlc !== null ? calc.nlc * sku.demandUnits : null;
    const nlcMixOk = close(calc.nlcValueMix, expNlcMix);
    bump("NLC Value Mix", nlcMixOk);
    if (!nlcMixOk) {
      pushBug(bugs, "NLC Value Mix", "L", sku, "NLC Value Mix != NLC × demand", expNlcMix, calc.nlcValueMix, null);
    }
  }

  const allColumns = new Set([...columnOk.keys(), ...columnBugCount.keys()]);
  const columnSummaries: ColumnSummary[] = [...allColumns]
    .sort()
    .map((column) => {
      const ok = columnOk.get(column) ?? 0;
      const bugN = columnBugCount.get(column) ?? 0;
      const sampleBug = bugs.find((b) => b.column === column || b.column.startsWith(column));
      return { column, ok, bugs: bugN, sampleBug };
    });

  return {
    deliveryDate: opts?.deliveryDate ?? rows[0]?.delivery_date ?? "",
    city: opts?.city ?? rows[0]?.city ?? "",
    rowCount: rows.length,
    totalDemand,
    columnSummaries,
    bugs,
  };
}
