import { parseCSV, parseCSVMatrix, toNum } from "./csv";

export type BlinkitSpFileRow = {
  fsnId: string;
  blinkitSp: number | null;
};

const FSN_HEADERS = ["fsn", "fsn id", "fsn_id", "fsnid", "fsn code"];
const SP_HEADERS = ["blinkit sp", "blinkit_sp", "blinkitsp", "bksp", "blinkit", "blinkit selling price"];

function headerIndex(headers: string[], names: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase().replace(/^\ufeff/, ""));
  return lower.findIndex((h) => names.includes(h));
}

function csvField(row: Record<string, string>, names: string[]): string | undefined {
  for (const key of Object.keys(row)) {
    const h = key.trim().toLowerCase().replace(/^\ufeff/, "");
    if (names.includes(h)) return row[key];
  }
  return undefined;
}

/** Parse a Blinkit SP sheet: FSN + Blinkit SP (2-col or a full Price Upload CSV). */
export function parseBlinkitSpUpload(text: string): BlinkitSpFileRow[] {
  const raw = text.replace(/^\uFEFF/, "");
  const parsed = parseCSV(raw);
  if (parsed.length > 0) {
    const headers = Object.keys(parsed[0] ?? {});
    const hasFsn = headerIndex(headers, FSN_HEADERS) >= 0;
    const hasSp = headerIndex(headers, SP_HEADERS) >= 0;
    if (hasFsn && hasSp) {
      const rows: BlinkitSpFileRow[] = [];
      for (const r of parsed) {
        const fsnId = String(csvField(r, FSN_HEADERS) ?? "").trim();
        if (!fsnId) continue;
        const spRaw = csvField(r, SP_HEADERS);
        if (spRaw === undefined) continue;
        rows.push({ fsnId, blinkitSp: toNum(spRaw) });
      }
      return rows;
    }
  }

  const matrix = parseCSVMatrix(raw);
  if (matrix.length === 0) return [];
  // Headerless 2-column paste: every row is FSN, SP.
  return matrix
    .map((r) => ({
      fsnId: String(r[0] ?? "").trim(),
      blinkitSp: toNum(r[1]),
    }))
    .filter((r) => r.fsnId && !FSN_HEADERS.includes(r.fsnId.toLowerCase()));
}

export type BlinkitSpPair = {
  sheetIndex: number;
  fsnId: string;
  blinkitSp: number;
};

/**
 * Pair file rows to the current sheet in Download CSV order.
 * FSN at each index must match. Empty SP cells are skipped (existing value kept).
 * 0 is a real overwrite (not sold).
 */
export function pairBlinkitSpBySequence(
  fileRows: BlinkitSpFileRow[],
  sheetFsnIds: string[],
): {
  pairs: BlinkitSpPair[];
  skippedEmpty: number;
  fsnMismatch: number;
  extraFile: number;
} {
  const n = Math.min(fileRows.length, sheetFsnIds.length);
  const pairs: BlinkitSpPair[] = [];
  let skippedEmpty = 0;
  let fsnMismatch = 0;
  for (let i = 0; i < n; i++) {
    const file = fileRows[i]!;
    const sheetFsn = String(sheetFsnIds[i] ?? "").trim();
    if (file.fsnId.trim().toUpperCase() !== sheetFsn.toUpperCase()) {
      fsnMismatch += 1;
      continue;
    }
    if (file.blinkitSp == null) {
      skippedEmpty += 1;
      continue;
    }
    pairs.push({ sheetIndex: i, fsnId: sheetFsn, blinkitSp: file.blinkitSp });
  }
  return {
    pairs,
    skippedEmpty,
    fsnMismatch,
    extraFile: Math.max(0, fileRows.length - sheetFsnIds.length),
  };
}
