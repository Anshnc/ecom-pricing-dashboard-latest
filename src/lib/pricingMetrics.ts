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
  negotiatedPp: number;
  packagingCost: number;
  fmlCost: number;
  processingCost: number;
  blinkitSp: number | null;
  /** Prior-day displayed NLC; used to compute deflection when available. */
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

/** Resolve GRN ₹/unit — prefer GRN/kg × CF; fall back to stored unit (matches DB trigger coalesce). */
export function resolveGrnPerUnit(args: {
  grnPricePerKg: number | null;
  conversionFactor: number;
  grnPricePerUnit?: number | null;
  prevGrnPricePerUnit?: number | null;
  t3GrnPricePerUnit?: number | null;
}): number | null {
  if (args.grnPricePerKg !== null) {
    return args.grnPricePerKg * args.conversionFactor;
  }
  return (
    args.grnPricePerUnit ??
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
  const nlc = row.negotiatedPp + row.packagingCost + row.fmlCost + row.processingCost;
  const piPct = row.blinkitSp ? ((row.blinkitSp - nlc) / row.blinkitSp) * 100 : null;
  const gm = grnPerUnit !== null ? nlc - grnPerUnit : null;
  const mixPct = demandMixPct(row.demandUnits, totalDemand);

  // Impact PP = (Quoted PP − GRN ₹/unit) × Total Demand %
  const impactPpDiff =
    grnPerUnit !== null ? (row.quotedPp - grnPerUnit) * (mixPct / 100) : null;

  // Impact GM = GM × Total Demand %, where GM = NLC − GRN ₹/unit (displayed NLC column).
  const impactGm = gm !== null ? gm * (mixPct / 100) : null;

  // Deflection = ((today NLC − prev NLC) / prev NLC) × 100 using displayed NLC.
  const deflectionPct =
    row.prevDayNlc != null && row.prevDayNlc !== 0
      ? deflectionPctFromNlc(nlc, row.prevDayNlc)
      : row.storedDeflectionPct ?? null;

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
