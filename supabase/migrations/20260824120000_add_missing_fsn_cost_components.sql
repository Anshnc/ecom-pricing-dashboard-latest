-- Add / update fixed cost components for 7 FSNs (4 blank-NLC + 2 nearby Gala + Beans Avare).
-- Mapping: Processing cost → pc, FML dump → fml_dump, Packing cost → pm_cost.
-- Inserts one row per new FSN (weight_unit from existing sheets when available)
-- so the FSN-only fallback still applies when pack size differs.

WITH incoming (fsn_id, pc, fml_dump, pm_cost) AS (
  VALUES
    ('VEGHQFGM3FGZXFKS', 3.72, 0.95, 0.15),
    ('VEGH6HG9HEJTXGEC', 3.72, 0.95, 0.15),
    ('FRTHEGSQK344RHWP', 3.72, 0.90, 0.15),
    ('FRTHEGSQQGQF5CGM', 3.72, 0.90, 0.15),
    ('FRTHMJR3GZM6XHJN', 3.72, 0.90, 5.55),
    ('FRTFECZ8WNNPCTZB', 3.72, 0.95, 3.76),
    ('VEGHHW6MT6GDH9EF', 3.72, 0.95, 0.15)
)
UPDATE public.fsn_cost_components c
SET
  pc = i.pc,
  fml_dump = i.fml_dump,
  pm_cost = i.pm_cost,
  updated_at = now()
FROM incoming i
WHERE c.fsn_id = i.fsn_id;

WITH incoming (fsn_id, pc, fml_dump, pm_cost) AS (
  VALUES
    ('VEGHQFGM3FGZXFKS', 3.72, 0.95, 0.15),
    ('VEGH6HG9HEJTXGEC', 3.72, 0.95, 0.15),
    ('FRTHEGSQK344RHWP', 3.72, 0.90, 0.15),
    ('FRTHEGSQQGQF5CGM', 3.72, 0.90, 0.15),
    ('FRTHMJR3GZM6XHJN', 3.72, 0.90, 5.55),
    ('FRTFECZ8WNNPCTZB', 3.72, 0.95, 3.76),
    ('VEGHHW6MT6GDH9EF', 3.72, 0.95, 0.15)
),
to_insert AS (
  SELECT
    i.fsn_id,
    i.pc,
    i.fml_dump,
    i.pm_cost,
    COALESCE(
      (
        SELECT d.weight_unit
        FROM public.price_sheet_details d
        WHERE d.fsn_id = i.fsn_id
          AND d.weight_unit IS NOT NULL
          AND btrim(d.weight_unit) <> ''
        GROUP BY d.weight_unit
        ORDER BY count(*) DESC, d.weight_unit
        LIMIT 1
      ),
      ''
    ) AS weight_unit
  FROM incoming i
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.fsn_cost_components c
    WHERE c.fsn_id = i.fsn_id
  )
)
INSERT INTO public.fsn_cost_components (
  fsn_id, weight_unit, pc, fml_dump, pm_cost, updated_at
)
SELECT fsn_id, weight_unit, pc, fml_dump, pm_cost, now()
FROM to_insert;

-- Recompute NLC / GM / PI% on existing sheet rows now that costs exist.
UPDATE public.price_sheet_details d
SET updated_at = now()
WHERE d.fsn_id IN (
  'VEGHQFGM3FGZXFKS',
  'VEGH6HG9HEJTXGEC',
  'FRTHEGSQK344RHWP',
  'FRTHEGSQQGQF5CGM',
  'FRTHMJR3GZM6XHJN',
  'FRTFECZ8WNNPCTZB',
  'VEGHHW6MT6GDH9EF'
);
