import { parseCSV, toNum } from "./csv";

/** Columns written from the downloaded Price Upload CSV. Everything else is ignored. */
export type BulkUpdate = {
  fsnId: string;
  weightUnit: string | null;
  blinkitSp?: number | null;
  quotedPp?: number | null;
  negotiatedPp?: number | null;
  grnPricePerKg?: number | null;
};

function csvField(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const found = Object.keys(row).find((h) => h.trim().toLowerCase() === k.toLowerCase());
    if (found && row[found] !== "") return row[found];
  }
  return undefined;
}

/** Parse the Download CSV. Only Quoted PP, Negotiated PP, Blinkit SP, and GRN ₹/kg are applied. */
export function parseBulkPriceUpdates(text: string): BulkUpdate[] {
  const parsed = parseCSV(text);
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
    const qp = csvField(r, "quoted_pp", "Quoted PP", "QuotedPp");
    if (qp !== undefined) u.quotedPp = toNum(qp);
    const np = csvField(r, "negotiated_pp", "Negotiated PP", "NegotiatedPp");
    if (np !== undefined) u.negotiatedPp = toNum(np);
    const gk = csvField(r, "grn_price_per_kg", "GRN ₹/kg", "GRN Price Per Kg", "GRN /kg");
    if (gk !== undefined) u.grnPricePerKg = toNum(gk);

    const hasEditable =
      u.blinkitSp != null ||
      u.quotedPp != null ||
      u.negotiatedPp != null ||
      u.grnPricePerKg != null;
    if (hasEditable) updates.push(u);
  }

  return updates;
}
