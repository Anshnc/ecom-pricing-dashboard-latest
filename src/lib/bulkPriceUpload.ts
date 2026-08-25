import { parseCSV, toNum } from "./csv";

/** Columns written from the downloaded Price Upload CSV. Everything else is ignored. */
export type BulkUpdate = {
  fsnId: string;
  weightUnit: string | null;
  blinkitSp?: number | null;
  quotedPp?: number | null;
  negotiatedPp?: number | null;
};

function csvField(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const found = Object.keys(row).find((h) => h.trim().toLowerCase() === k.toLowerCase());
    if (found && row[found] !== "") return row[found];
  }
  return undefined;
}

/** Parse the Download CSV. Only Quoted PP, Negotiated PP, and Blinkit SP are applied. */
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

    const hasEditable =
      u.blinkitSp != null || u.quotedPp != null || u.negotiatedPp != null;
    if (hasEditable) updates.push(u);
  }

  return updates;
}
