/** Inputs for per-row pricing sheet derived metrics (UI + audit). */
export type RowMetricsInput = {
  demandUnits: number;
  conversionFactor: number;
  grnPricePerKg: number | null;
  /** Stored GRN ₹/unit from DB (MySQL T-1 unit or trigger coalesce) — fallback when GRN/kg is missing. */
  grnPricePerUnit?: number | null;
  prevDayGrnPerUnit?: number | null;
  t3GrnPricePerUnit?: number | null;
  adjustedGrn?: number;
  quotedPp: number;
  /** False when DB quoted_pp is null — impact PP must show "—", not a coerced zero. */
  quotedPpIsSet?: boolean;
  negotiatedPp: number;
  /** False when DB negotiated_pp is null/0 — used for presence checks, not NLC. */
  negotiatedPpIsSet?: boolean;
  packagingCost: number;
  fmlCost: number;
  processingCost: number;
  blinkitSp: number | null;
  /** Prior-day displayed NLC from calendar yesterday; required for deflection. */
  prevDayNlc?: number | null;
};

export type RowMetrics = {
  grnPerUnit: number | null;
  /** (GRN/kg + Adjusted GRN) × CF — used for GM, GRN Markup, GRN Diff. */
  totalGrnPerUnit: number | null;
  prevDayGrnPerUnit: number | null;
  grnDiff: number | null;
  /** Null until Quoted PP is entered (Negotiated PP never affects NLC). */
  nlc: number | null;
  piPct: number | null;
  gm: number | null;
  totalDemandPct: number;
  quotedNlc: number | null;
  impactPpDiff: number | null;
  impactGm: number | null;
  deflectionPct: number | null;
  valueMix: number | null;
  nlcValueMix: number | null;
  grnMarkup: number | null;
};

/** Demand-weighted mix % for impact columns — always from live basket totals. */
export function demandMixPct(demandUnits: number, totalDemand: number): number {
  return totalDemand > 0 ? (demandUnits / totalDemand) * 100 : 0;
}

/** Display NLC = Quoted PP + PM + FML + PC. Negotiated PP is never part of NLC. */
export function displayNlcFromParts(
  quotedPp: number,
  _negotiatedPp: number,
  packagingCost: number,
  fmlCost: number,
  processingCost: number,
): number {
  return quotedNlcFromParts(quotedPp, packagingCost, fmlCost, processingCost);
}

/** Quoted NLC = quoted PP + fixed cost components (matches DB trigger). */
export function quotedNlcFromParts(
  quotedPp: number,
  packagingCost: number,
  fmlCost: number,
  processingCost: number,
): number {
  return quotedPp + packagingCost + fmlCost + processingCost;
}

/** Total GRN/kg = GRN/kg + Adjusted GRN (backend column; null when GRN/kg missing). */
export function totalGrnFromParts(grnPricePerKg: number | null, adjustedGrn = 0): number | null {
  if (grnPricePerKg === null) return null;
  return grnPricePerKg + adjustedGrn;
}

/** Total GRN ₹/unit = Total GRN × CF. */
export function totalGrnPerUnitFromParts(
  grnPricePerKg: number | null,
  adjustedGrn: number,
  conversionFactor: number,
): number | null {
  const totalGrn = totalGrnFromParts(grnPricePerKg, adjustedGrn);
  if (totalGrn === null) return null;
  return totalGrn * conversionFactor;
}

/** Resolve GRN ₹/unit — prefer stored unit (matches DB trigger), else GRN/kg × CF, then fallbacks. */
export function resolveGrnPerUnit(args: {
  grnPricePerKg: number | null;
  conversionFactor: number;
  grnPricePerUnit?: number | null;
  prevGrnPricePerUnit?: number | null;
  t3GrnPricePerUnit?: number | null;
}): number | null {
  if (args.grnPricePerUnit != null) {
    return args.grnPricePerUnit;
  }
  if (args.grnPricePerKg !== null) {
    return args.grnPricePerKg * args.conversionFactor;
  }
  return (
    args.prevGrnPricePerUnit ??
    args.t3GrnPricePerUnit ??
    null
  );
}

/** Deflection vs prior-day NLC: ((today NLC − prev NLC) / prev NLC) × 100. */
export function deflectionPctFromNlc(
  currentNlc: number | null,
  prevNlc: number | null | undefined,
): number | null {
  if (currentNlc == null || prevNlc == null || prevNlc === 0) return null;
  return ((currentNlc - prevNlc) / prevNlc) * 100;
}

/** True when Quoted PP was entered on the sheet (null = not entered; 0 is valid). */
export function quotedPpIsPresent(row: {
  quotedPp?: number;
  quotedPpIsSet?: boolean;
}): boolean {
  if (row.quotedPpIsSet === false) return false;
  if (row.quotedPpIsSet === true) return true;
  return row.quotedPp != null;
}

/** Impact PP Diff = (Quoted PP − Total GRN ₹/unit) × Total Demand %. */
export function impactPpDiffFromParts(
  quotedPp: number | null | undefined,
  totalGrnPerUnit: number | null,
  mixPct: number,
): number | null {
  if (quotedPp == null || totalGrnPerUnit == null) return null;
  return (quotedPp - totalGrnPerUnit) * (mixPct / 100);
}

/** Impact GM = GM × Total Demand %. */
export function impactGmFromParts(gm: number | null, mixPct: number): number | null {
  if (gm == null) return null;
  return gm * (mixPct / 100);
}

/** True when Negotiated PP was actually entered (not copied from Quoted PP). */
export function negotiatedPpIsPresent(negotiatedPp: number, negotiatedPpIsSet?: boolean): boolean {
  if (negotiatedPpIsSet === false) return false;
  if (negotiatedPpIsSet === true) return true;
  return negotiatedPp !== 0;
}

/**
 * Displayed NLC is present only when Quoted PP was entered.
 * Negotiated PP is never part of NLC. Quoted PP = 0 is a valid entry.
 */
export function displayNlcIsPresent(row: {
  quotedPp?: number;
  quotedPpIsSet?: boolean;
  negotiatedPp?: number;
  negotiatedPpIsSet?: boolean;
}): boolean {
  return quotedPpIsPresent(row);
}

/** Averages-row BK Value Mix = SUMPRODUCT(Total Demand %, Blinkit SP) / Σ Total Demand %. */
export function bkValueMixDemandWeightedAvg(
  rows: Array<{ totalDemandPct: number; blinkitSp: number | null | undefined }>,
): number | null {
  let weightedSum = 0;
  let weightSum = 0;
  for (const r of rows) {
    const sp = r.blinkitSp;
    if (sp === null || sp === undefined || Number.isNaN(sp)) continue;
    weightedSum += r.totalDemandPct * sp;
    weightSum += r.totalDemandPct;
  }
  return weightSum > 0 ? weightedSum / weightSum : null;
}

/**
 * Price Upload Blinkit SP average: simple mean of SP on rows where
 * Blinkit SP and displayed NLC are both present. Denominator is that paired count only.
 * 0 is a real Blinkit SP; blank/NA SP or missing NLC is skipped.
 */
export function meanBlinkitSpWhenBothPresent(
  rows: Array<{
    blinkitSp: number | null | undefined;
    quotedPp?: number;
    quotedPpIsSet?: boolean;
    negotiatedPp: number;
    negotiatedPpIsSet?: boolean;
  }>,
): number | null {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (!displayNlcIsPresent(r)) continue;
    const sp = r.blinkitSp;
    if (sp === null || sp === undefined || Number.isNaN(sp)) continue;
    sum += sp;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

/**
 * PI% = (Blinkit SP − Negotiated NLC) / Blinkit SP × 100.
 * Blank when Blinkit SP or Negotiated PP is missing (do not fall back to quoted NLC).
 */
export function piPctFromNegotiatedNlc(
  blinkitSp: number | null,
  negotiatedNlc: number | null,
): number | null {
  if (blinkitSp == null || blinkitSp === 0 || negotiatedNlc == null) return null;
  return ((blinkitSp - negotiatedNlc) / blinkitSp) * 100;
}

/**
 * Row PI% = (BK SP − displayed NLC) / BK SP × 100.
 * Blank when BK SP is missing/zero (not sold on Blinkit) or NLC is missing.
 */
export function piPctFromDisplayNlc(
  blinkitSp: number | null,
  nlc: number | null,
): number | null {
  if (blinkitSp == null || blinkitSp === 0 || nlc == null) return null;
  return ((blinkitSp - nlc) / blinkitSp) * 100;
}

/**
 * Price Upload PI% average:
 * ((Σ demand × BK SP) − (Σ demand × NLC)) / (Σ demand × BK SP) × 100
 * Rows missing Blinkit SP or NLC are excluded from all three sums.
 */
export function basketPiPctAvg(
  rows: Array<{
    demandUnits: number;
    blinkitSp: number | null | undefined;
    nlc: number | null;
  }>,
): number | null {
  let bkValue = 0;
  let nlcValue = 0;
  for (const r of rows) {
    const sp = r.blinkitSp;
    if (sp == null || Number.isNaN(sp) || sp === 0 || r.nlc == null) continue;
    bkValue += r.demandUnits * sp;
    nlcValue += r.demandUnits * r.nlc;
  }
  if (bkValue === 0) return null;
  return ((bkValue - nlcValue) / bkValue) * 100;
}

/** Simple mean of numeric values; skips null, undefined, and NaN (NA / blanks). */
export function simpleMean(values: Array<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    sum += v;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

export function computeRowMetrics(row: RowMetricsInput, totalDemand: number): RowMetrics {
  const grnPerUnit = resolveGrnPerUnit({
    grnPricePerKg: row.grnPricePerKg,
    conversionFactor: row.conversionFactor,
    grnPricePerUnit: row.grnPricePerUnit,
    prevGrnPricePerUnit: row.prevDayGrnPerUnit,
    t3GrnPricePerUnit: row.t3GrnPricePerUnit,
  });
  const totalGrnPerUnit = totalGrnPerUnitFromParts(
    row.grnPricePerKg,
    row.adjustedGrn ?? 0,
    row.conversionFactor,
  );
  const prevDayGrnPerUnit = row.prevDayGrnPerUnit ?? null;
  const grnDiff =
    totalGrnPerUnit !== null && prevDayGrnPerUnit !== null
      ? totalGrnPerUnit - prevDayGrnPerUnit
      : null;

  const nlcPresent = quotedPpIsPresent(row);
  const nlc = nlcPresent
    ? quotedNlcFromParts(row.quotedPp, row.packagingCost, row.fmlCost, row.processingCost)
    : null;
  const piPct = piPctFromDisplayNlc(row.blinkitSp, nlc);
  const gm =
    nlc !== null && totalGrnPerUnit !== null ? nlc - totalGrnPerUnit : null;
  const mixPct = demandMixPct(row.demandUnits, totalDemand);
  const quotedForImpact = row.quotedPpIsSet === false ? null : row.quotedPp;

  // Impact PP = (Quoted PP − Total GRN ₹/unit) × Total Demand % — formula only.
  const impactPpDiff = impactPpDiffFromParts(quotedForImpact, totalGrnPerUnit, mixPct);

  // Impact GM = GM × Total Demand % — formula only.
  const impactGm = impactGmFromParts(gm, mixPct);

  // Deflection = ((today NLC − yesterday NLC) / yesterday NLC) × 100 — formula only, no DB fallback.
  const deflectionPct = deflectionPctFromNlc(nlc, row.prevDayNlc);

  const valueMix = row.blinkitSp !== null ? row.blinkitSp * row.demandUnits : null;
  const nlcValueMix = nlc !== null ? nlc * row.demandUnits : null;
  const grnMarkup =
    nlcPresent && totalGrnPerUnit !== null ? row.quotedPp - totalGrnPerUnit : null;

  return {
    grnPerUnit,
    totalGrnPerUnit,
    prevDayGrnPerUnit,
    grnDiff,
    nlc,
    piPct,
    gm,
    totalDemandPct: mixPct,
    quotedNlc: nlc,
    impactPpDiff,
    impactGm,
    deflectionPct,
    valueMix,
    nlcValueMix,
    grnMarkup,
  };
}
