import { applyComboGrnPerKgOverride, comboSourceGrnKgSum } from "./comboGrnKg";

function assertClose(actual: number | null, expected: number | null, label: string, eps = 0.001) {
  if (actual === null && expected === null) return;
  if (actual === null || expected === null || Math.abs(actual - expected) > eps) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

const rows = [
  { fsn_id: "VEGGEDSQPGBGHNYP", grn_price_per_kg: 22, cf: 1 },
  { fsn_id: "VEGG6FK9GFUZ3J8E", grn_price_per_kg: 16, cf: 1 },
  { fsn_id: "VEGGH9ZSYN3U269R", grn_price_per_kg: 24, cf: 3 },
  { fsn_id: "OTHER", grn_price_per_kg: 99, cf: 1 },
];

assertClose(comboSourceGrnKgSum(rows), 40, "16 + 24 = 40");

const out = applyComboGrnPerKgOverride(rows);
assertClose(out[0].grn_price_per_kg ?? null, 40, "combo GRN/kg overwritten to 40");
assertClose(out[0].grn_price_per_unit ?? null, 40, "combo GRN/unit = kg × CF");
assertClose(out[1].grn_price_per_kg ?? null, 16, "potato GRN/kg unchanged");
assertClose(out[2].grn_price_per_kg ?? null, 24, "onion GRN/kg unchanged");
assertClose(out[3].grn_price_per_kg ?? null, 99, "other FSN unchanged");

assertEqual(comboSourceGrnKgSum([{ fsn_id: "OTHER", grn_price_per_kg: 10 }]), null, "no sources → no override");
assertClose(
  comboSourceGrnKgSum([
    { fsn_id: "VEGG6FK9GFUZ3J8E", grn_price_per_kg: 16.83 },
    { fsn_id: "VEGGH9ZSYN3U269R", grn_price_per_kg: 48 },
  ]),
  64.83,
  "live-style decimals round to 2 places",
);

console.log("comboGrnKg.test.ts — all assertions passed");
