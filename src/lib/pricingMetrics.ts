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
  packagingCost: number;
  fmlCost: number;
  processingCost: number;
  blinkitSp: number | null;
  /** Prior-day displayed NLC from calendar yesterday; required for deflection. */
  prevDayNlc?: number | null;
};

export type RowMetrics = {
  grnPerUnit: number | null;
  prevDayGrnPerUnit: number | null;
  grnDiff: number | null;
  nlc: number;
  piPct: number | null;
  gm: number | null;
  totalDemandPct: number;
  quotedNlc: number;
  impactPpDiff: number | null;
  impactGm: number | null;
  deflectionPct: number | null;
  valueMix: number | null;
  nlcValueMix: number;
  grnMarkup: number | null;
};

/** Demand-weighted mix % for impact columns — always from live basket totals. */
export function demandMixPct(demandUnits: number, totalDemand: number): number {
  return totalDemand > 0 ? (demandUnits / totalDemand) * 100 : 0;
}

/** Display NLC = negotiated PP + costs when set, else quoted PP + costs (matches NLC column). */
export function displayNlcFromParts(
  quotedPp: number,
  negotiatedPp: number,
  packagingCost: number,
  fmlCost: number,
  processingCost: number,
): number {
  const costs = packagingCost + fmlCost + processingCost;
  const pp = negotiatedPp !== 0 ? negotiatedPp : quotedPp;
  return pp + costs;
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
export function deflectionPctFromNlc(currentNlc: number, prevNlc: number | null | undefined): number | null {
  if (prevNlc == null || prevNlc === 0) return null;
  return ((currentNlc - prevNlc) / prevNlc) * 100;
}

/** Impact PP Diff = (Quoted PP − GRN ₹/unit) × Total Demand %. */
export function impactPpDiffFromParts(
  quotedPp: number | null | undefined,
  grnPerUnit: number | null,
  mixPct: number,
): number | null {
  if (quotedPp == null || grnPerUnit == null) return null;
  return (quotedPp - grnPerUnit) * (mixPct / 100);
}

/** Impact GM = GM × Total Demand %. */
export function impactGmFromParts(gm: number | null, mixPct: number): number | null {
  if (gm == null) return null;
  return gm * (mixPct / 100);
}

export function computeRowMetrics(row: RowMetricsInput, totalDemand: number): RowMetrics {
  const grnPerUnit = resolveGrnPerUnit({
    grnPricePerKg: row.grnPricePerKg,
    conversionFactor: row.conversionFactor,
    grnPricePerUnit: row.grnPricePerUnit,
    prevGrnPricePerUnit: row.prevDayGrnPerUnit,
    t3GrnPricePerUnit: row.t3GrnPricePerUnit,
  });
  const adj = row.adjustedGrn ?? 0;
  const effectiveGrnPerUnit = grnPerUnit !== null ? grnPerUnit + adj : null;
  const prevDayGrnPerUnit = row.prevDayGrnPerUnit ?? null;
  const grnDiff =
    effectiveGrnPerUnit !== null && prevDayGrnPerUnit !== null
      ? effectiveGrnPerUnit - prevDayGrnPerUnit
      : null;

  const quotedNlc = quotedNlcFromParts(row.quotedPp, row.packagingCost, row.fmlCost, row.processingCost);
  const nlc = displayNlcFromParts(
    row.quotedPp,
    row.negotiatedPp,
    row.packagingCost,
    row.fmlCost,
    row.processingCost,
  );
  const piPct = row.blinkitSp ? ((row.blinkitSp - nlc) / row.blinkitSp) * 100 : null;
  const gm = grnPerUnit !== null ? nlc - grnPerUnit : null;
  const mixPct = demandMixPct(row.demandUnits, totalDemand);
  const quotedForImpact = row.quotedPpIsSet === false ? null : row.quotedPp;

  // Impact PP = (Quoted PP − GRN ₹/unit) × Total Demand % — formula only.
  const impactPpDiff = impactPpDiffFromParts(quotedForImpact, grnPerUnit, mixPct);

  // Impact GM = GM × Total Demand % — formula only.
  const impactGm = impactGmFromParts(gm, mixPct);

  // Deflection = ((today NLC − yesterday NLC) / yesterday NLC) × 100 — formula only, no DB fallback.
  const deflectionPct =
    row.prevDayNlc != null && row.prevDayNlc !== 0
      ? deflectionPctFromNlc(nlc, row.prevDayNlc)
      : null;

  const valueMix = row.blinkitSp !== null ? row.blinkitSp * row.demandUnits : null;
  // NLC Value Mix = quoted NLC × demand (matches working-sheet "NLC" column × demand units).
  const nlcValueMix = quotedNlc * row.demandUnits;
  const grnMarkup = grnPerUnit !== null ? row.quotedPp - grnPerUnit : null;

  return {
    grnPerUnit,
    prevDayGrnPerUnit,
    grnDiff,
    nlc,
    piPct,
    gm,
    totalDemandPct: mixPct,
    quotedNlc,
    impactPpDiff,
    impactGm,
    deflectionPct,
    valueMix,
    nlcValueMix,
    grnMarkup,
  };
}
