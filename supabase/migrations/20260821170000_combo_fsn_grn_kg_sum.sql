-- Always set Potato–Onion combo GRN ₹/kg = Onion Premium GRN ₹/kg + Potato GRN ₹/kg.
-- Overwrites demand-query GRN/kg for VEGGEDSQPGBGHNYP only.

UPDATE public.price_sheet_details d
SET
  grn_price_per_kg = src.sum_kg,
  grn_price_per_unit = round(src.sum_kg * coalesce(d.cf, 1), 2)
FROM (
  SELECT
    price_sheet_id,
    round(
      coalesce(max(CASE WHEN fsn_id = 'VEGGH9ZSYN3U269R' THEN grn_price_per_kg END), 0)
      + coalesce(max(CASE WHEN fsn_id = 'VEGG6FK9GFUZ3J8E' THEN grn_price_per_kg END), 0)
    , 2) AS sum_kg
  FROM public.price_sheet_details
  GROUP BY price_sheet_id
) src
WHERE d.price_sheet_id = src.price_sheet_id
  AND d.fsn_id = 'VEGGEDSQPGBGHNYP'
  AND src.sum_kg <> 0
  AND (
    d.grn_price_per_kg IS DISTINCT FROM src.sum_kg
    OR d.grn_price_per_unit IS DISTINCT FROM round(src.sum_kg * coalesce(d.cf, 1), 2)
  );
