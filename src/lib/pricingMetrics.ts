/** Inputs for per-row pricing sheet derived metrics (UI + audit). */
export type RowMetricsInput = {
  demandUnits: number;
  conversionFactor: number;
  grnPricePerKg: number | null;
  prevDayGrnPerUnit?: number | null;
  adjustedGrn?: number;
  quotedPp: number;
  negotiatedPp: number;
  packagingCost: number;
  fmlCost: number;
  processingCost: number;
  blinkitSp: number | null;
  /** Prior-day quoted NLC; used to compute deflection when available. */
  prevDayNlc?: number | null;
  /** Stored DB deflection fallback when prev-day NLC is unavailable. */
  storedDeflectionPct?: number | null;
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

/** Quoted NLC = quoted PP + fixed cost components (matches DB trigger). */
export function quotedNlcFromParts(
  quotedPp: number,
  packagingCost: number,
  fmlCost: number,
  processingCost: number,
): number {
  return quotedPp + packagingCost + fmlCost + processingCost;
}

/** Deflection vs prior-day quoted NLC. */
export function deflectionPctFromNlc(currentQuotedNlc: number, prevQuotedNlc: number | null | undefined): number | null {
  if (prevQuotedNlc == null || prevQuotedNlc === 0) return null;
  return ((currentQuotedNlc - prevQuotedNlc) / prevQuotedNlc) * 100;
}

export function computeRowMetrics(row: RowMetricsInput, totalDemand: number): RowMetrics {
  const grnPerUnit = row.grnPricePerKg !== null ? row.grnPricePerKg * row.conversionFactor : null;
  const adj = row.adjustedGrn ?? 0;
  const effectiveGrnPerUnit = grnPerUnit !== null ? grnPerUnit + adj : null;
  const prevDayGrnPerUnit = row.prevDayGrnPerUnit ?? null;
  const grnDiff =
    effectiveGrnPerUnit !== null && prevDayGrnPerUnit !== null
      ? effectiveGrnPerUnit - prevDayGrnPerUnit
      : null;

  const quotedNlc = quotedNlcFromParts(row.quotedPp, row.packagingCost, row.fmlCost, row.processingCost);
  const nlc = row.negotiatedPp + row.packagingCost + row.fmlCost + row.processingCost;
  const piPct = row.blinkitSp ? ((row.blinkitSp - nlc) / row.blinkitSp) * 100 : null;
  const gm = grnPerUnit !== null ? nlc - grnPerUnit : null;
  const mixPct = demandMixPct(row.demandUnits, totalDemand);

  const impactPpDiff =
    grnPerUnit !== null ? (row.quotedPp - grnPerUnit) * (mixPct / 100) : null;

  const impactGmBase = grnPerUnit !== null ? quotedNlc - grnPerUnit : null;
  const impactGm = impactGmBase !== null ? impactGmBase * (mixPct / 100) : null;

  const computedDeflection = deflectionPctFromNlc(quotedNlc, row.prevDayNlc);
  const deflectionPct = computedDeflection ?? row.storedDeflectionPct ?? null;

  const valueMix = row.blinkitSp !== null ? row.blinkitSp * row.demandUnits : null;
  const nlcValueMix = nlc * row.demandUnits;
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
