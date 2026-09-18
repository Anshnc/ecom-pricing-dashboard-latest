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

export type BulkParseResult = {
  updates: BulkUpdate[];
  detectedGrnColumn: boolean;
  grnValueCount: number;
  formulaCellCount: number;
};

/** Excel formula or error left in a CSV cell — cannot be saved as a price. */
export function isExcelFormulaOrError(raw: string): boolean {
  const s = raw.trim();
  if (s.startsWith("=") || s.startsWith("{=")) return true;
  return /^#(N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NULL!|NUM!|GETTING_DATA)$/i.test(s);
}

function csvField(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const found = Object.keys(row).find((h) => h.trim().toLowerCase() === k.toLowerCase());
    if (found && row[found] !== "") return row[found];
  }
  return undefined;
}

/** Strip currency/punctuation so "GRN ₹/kg", "GRN/kg", and Excel mojibake all compare. */
export function normalizeCsvHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .replace(/[₹]/g, " ")
    .replace(/\brs\.?/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** True for GRN ₹/kg (and aliases). False for GRN ₹/unit, Total GRN, Prev Day GRN, markup. */
export function isGrnKgHeader(raw: string): boolean {
  const n = normalizeCsvHeader(raw);
  if (/(unit|diff|markup|total|prev|adjusted|t 2|t2|t 3|t3)/.test(n)) return false;
  if (n === "grn kg" || n === "grn price per kg" || n === "grnpriceperkg") return true;
  if (n === "t 1 grn qty" || n === "t1 grn qty" || n === "grn qty") return true;
  return n.includes("grn") && n.includes("kg");
}

function grnKgField(row: Record<string, string>): string | undefined {
  for (const h of Object.keys(row)) {
    if (isGrnKgHeader(h) && row[h] !== "") return row[h];
  }
  return undefined;
}

/** Parse the Download CSV. Only Quoted PP, Negotiated PP, Blinkit SP, and GRN ₹/kg are applied. */
export function parseBulkPriceUpload(text: string): BulkParseResult {
  const parsed = parseCSV(text);
  const detectedGrnColumn = (parsed[0] ? Object.keys(parsed[0]) : []).some(isGrnKgHeader);
  const updates: BulkUpdate[] = [];
  let grnValueCount = 0;
  let formulaCellCount = 0;

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
    if (bk !== undefined) {
      if (isExcelFormulaOrError(bk)) formulaCellCount += 1;
      else u.blinkitSp = toNum(bk);
    }
    const qp = csvField(r, "quoted_pp", "Quoted PP", "QuotedPp");
    if (qp !== undefined) {
      if (isExcelFormulaOrError(qp)) formulaCellCount += 1;
      else u.quotedPp = toNum(qp);
    }
    const np = csvField(r, "negotiated_pp", "Negotiated PP", "NegotiatedPp");
    if (np !== undefined) {
      if (isExcelFormulaOrError(np)) formulaCellCount += 1;
      else u.negotiatedPp = toNum(np);
    }
    const gk = grnKgField(r);
    if (gk !== undefined) {
      if (isExcelFormulaOrError(gk)) formulaCellCount += 1;
      else {
        u.grnPricePerKg = toNum(gk);
        if (u.grnPricePerKg != null) grnValueCount += 1;
      }
    }

    const hasEditable =
      u.blinkitSp != null ||
      u.quotedPp != null ||
      u.negotiatedPp != null ||
      u.grnPricePerKg != null;
    if (hasEditable) updates.push(u);
  }

  return { updates, detectedGrnColumn, grnValueCount, formulaCellCount };
}

export function parseBulkPriceUpdates(text: string): BulkUpdate[] {
  return parseBulkPriceUpload(text).updates;
}
