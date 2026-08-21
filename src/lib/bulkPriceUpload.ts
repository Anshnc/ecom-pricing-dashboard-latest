import { parseCSV, toNum } from "./csv";

/** Editable columns bulk upload may write. Derived metrics (NLC, GM, PI%) are never taken from CSV. */
export type BulkUpdate = {
  fsnId: string;
  weightUnit: string | null;
  blinkitSp?: number | null;
  adjustedGrn?: number | null;
  quotedPp?: number | null;
  negotiatedPp?: number | null;
  grnPricePerKg?: number | null;
};

const DERIVED_HEADERS = [
  "nlc",
  "gm",
  "pi %",
  "pi%",
  "pi_pct",
  "deflection %",
  "deflection_pct",
  "nlc value mix",
  "impact pp diff",
  "impact gm",
];

function csvField(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const found = Object.keys(row).find((h) => h.trim().toLowerCase() === k.toLowerCase());
    if (found && row[found] !== "") return row[found];
  }
  return undefined;
}

export function csvHasDerivedColumns(headers: string[]): boolean {
  const lower = headers.map((h) => h.trim().toLowerCase());
  return lower.some((h) => DERIVED_HEADERS.includes(h));
}

/** Parse a price-upload CSV. NLC / GM / PI% columns are ignored — they are recalculated from Quoted PP + costs. */
export function parseBulkPriceUpdates(text: string): {
  updates: BulkUpdate[];
  hasDerivedColumns: boolean;
} {
  const parsed = parseCSV(text);
  const headers = parsed[0] ? Object.keys(parsed[0]) : [];
  const updates: BulkUpdate[] = [];

  for (const r of parsed) {
    const fsnId = String(
      csvField(r, "fsn_id", "FSN ID", "FSNId", "FSN code", "FSN") ?? "",
    ).trim();
    if (!fsnId) continue;

    const u: BulkUpdate = {
      fsnId,
      weightUnit: (csvField(r, "weight_unit", "Weight Unit", "WeightUnit", "WeightUnitName") ??
        null) as string | null,
    };

    const bk = csvField(r, "blinkit_sp", "Blinkit SP", "BlinkitSP");
    if (bk !== undefined) u.blinkitSp = toNum(bk);
    const adj = csvField(r, "adjusted_grn", "Adjusted GRN", "AdjustedGrn");
    if (adj !== undefined) u.adjustedGrn = toNum(adj);
    const qp = csvField(r, "quoted_pp", "Quoted PP", "QuotedPp");
    if (qp !== undefined) u.quotedPp = toNum(qp);
    const np = csvField(r, "negotiated_pp", "Negotiated PP", "NegotiatedPp");
    if (np !== undefined) u.negotiatedPp = toNum(np);
    const gk = csvField(r, "grn_price_per_kg", "GRN ₹/kg", "GRN Price Per Kg");
    if (gk !== undefined) u.grnPricePerKg = toNum(gk);

    const hasEditable =
      u.blinkitSp != null ||
      u.adjustedGrn != null ||
      u.quotedPp != null ||
      u.negotiatedPp != null ||
      u.grnPricePerKg != null;
    if (hasEditable) updates.push(u);
  }

  return { updates, hasDerivedColumns: csvHasDerivedColumns(headers) };
}
