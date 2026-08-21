/** Potato–Onion combo FSN whose GRN ₹/kg is never taken from the demand query. */
export const COMBO_GRN_KG_TARGET_FSN = "VEGGEDSQPGBGHNYP";

/** Component FSNs: Onion Premium + Potato. GRN ₹/kg of the combo = sum of these. */
export const COMBO_GRN_KG_SOURCE_FSNS = ["VEGGH9ZSYN3U269R", "VEGG6FK9GFUZ3J8E"] as const;

export type ComboGrnKgRow = {
  fsn_id?: string | null;
  grn_price_per_kg?: number | null;
  grn_price_per_unit?: number | null;
  cf?: number | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fsnOf(row: ComboGrnKgRow): string {
  return String(row.fsn_id ?? "").trim();
}

/** First non-null GRN ₹/kg per FSN (do not double-count multiple packs). */
export function comboSourceGrnKgSum(rows: ComboGrnKgRow[]): number | null {
  const kgByFsn = new Map<string, number>();
  for (const row of rows) {
    const fsn = fsnOf(row);
    if (!(COMBO_GRN_KG_SOURCE_FSNS as readonly string[]).includes(fsn)) continue;
    if (row.grn_price_per_kg == null || Number.isNaN(row.grn_price_per_kg)) continue;
    if (!kgByFsn.has(fsn)) kgByFsn.set(fsn, row.grn_price_per_kg);
  }
  if (kgByFsn.size === 0) return null;
  let sum = 0;
  for (const fsn of COMBO_GRN_KG_SOURCE_FSNS) {
    sum += kgByFsn.get(fsn) ?? 0;
  }
  return round2(sum);
}

/**
 * Overwrite VEGGEDSQPGBGHNYP GRN ₹/kg with the sum of the two component FSNs.
 * Also sets GRN ₹/unit = kg × CF so the unit column stays in sync.
 */
export function applyComboGrnPerKgOverride<T extends ComboGrnKgRow>(rows: T[]): T[] {
  const sum = comboSourceGrnKgSum(rows);
  if (sum == null) return rows;
  return rows.map((row) => {
    if (fsnOf(row) !== COMBO_GRN_KG_TARGET_FSN) return row;
    const cf = row.cf == null || Number.isNaN(row.cf) ? 1 : row.cf;
    return {
      ...row,
      grn_price_per_kg: sum,
      grn_price_per_unit: round2(sum * cf),
    };
  });
}
