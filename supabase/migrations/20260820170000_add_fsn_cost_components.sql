-- Add / update fixed cost components for 15 FSNs.
-- Mapping: Processing cost → pc, FML/Dump/Sourcing → fml_dump, Packing Cost → pm_cost.
-- Inserts one row per new FSN (weight_unit from existing sheets when available)
-- so the FSN-only fallback still applies when pack size differs.

WITH incoming (fsn_id, pc, fml_dump, pm_cost) AS (
  VALUES
    ('VEGHQFGM5FVQXYNN', 3.72, 0.90, 0.15),
    ('FRTHQFGVKRGW4K5D', 3.72, 0.90, 0.15),
    ('VEGGCDRKBKVHATPG', 3.72, 0.90, 1.28),
    ('FRTG3HWKGWF472XJ', 3.72, 0.90, 0.15),
    ('FFWHQYDSZFQPNSMK', 3.72, 0.90, 0.15),
    ('VEGHHW97YGCFNBU4', 3.72, 0.90, 0.15),
    ('VEGHZ2DQGYXGY7WH', 3.72, 0.90, 0.15),
    ('FFWHGKDY4JKEQ2EU', 3.35, 0.95, 0.15),
    ('VEGHQ4NPSGNEUFTM', 2.95, 0.00, 0.15),
    ('VEGHFS82WMERGWMH', 2.95, 0.00, 0.15),
    ('VEGHHHYCDVPPDX7S', 2.95, 0.00, 0.15),
    ('VEGHD2SMMGFD6QNV', 2.95, 0.00, 0.15),
    ('VEGHD2SMTKGKMTT6', 2.95, 0.00, 0.15),
    ('VEGHFJZWMZDGHBUB', 2.95, 0.00, 0.15),
    ('VEGHJYMGRGGRZVG6', 3.72, 0.90, 0.15)
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
    ('VEGHQFGM5FVQXYNN', 3.72, 0.90, 0.15),
    ('FRTHQFGVKRGW4K5D', 3.72, 0.90, 0.15),
    ('VEGGCDRKBKVHATPG', 3.72, 0.90, 1.28),
    ('FRTG3HWKGWF472XJ', 3.72, 0.90, 0.15),
    ('FFWHQYDSZFQPNSMK', 3.72, 0.90, 0.15),
    ('VEGHHW97YGCFNBU4', 3.72, 0.90, 0.15),
    ('VEGHZ2DQGYXGY7WH', 3.72, 0.90, 0.15),
    ('FFWHGKDY4JKEQ2EU', 3.35, 0.95, 0.15),
    ('VEGHQ4NPSGNEUFTM', 2.95, 0.00, 0.15),
    ('VEGHFS82WMERGWMH', 2.95, 0.00, 0.15),
    ('VEGHHHYCDVPPDX7S', 2.95, 0.00, 0.15),
    ('VEGHD2SMMGFD6QNV', 2.95, 0.00, 0.15),
    ('VEGHD2SMTKGKMTT6', 2.95, 0.00, 0.15),
    ('VEGHFJZWMZDGHBUB', 2.95, 0.00, 0.15),
    ('VEGHJYMGRGGRZVG6', 3.72, 0.90, 0.15)
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
  'VEGHQFGM5FVQXYNN',
  'FRTHQFGVKRGW4K5D',
  'VEGGCDRKBKVHATPG',
  'FRTG3HWKGWF472XJ',
  'FFWHQYDSZFQPNSMK',
  'VEGHHW97YGCFNBU4',
  'VEGHZ2DQGYXGY7WH',
  'FFWHGKDY4JKEQ2EU',
  'VEGHQ4NPSGNEUFTM',
  'VEGHFS82WMERGWMH',
  'VEGHHHYCDVPPDX7S',
  'VEGHD2SMMGFD6QNV',
  'VEGHD2SMTKGKMTT6',
  'VEGHFJZWMZDGHBUB',
  'VEGHJYMGRGGRZVG6'
);

-- Verify
SELECT fsn_id, weight_unit, pc, fml_dump, pm_cost
FROM public.fsn_cost_components
WHERE fsn_id IN (
  'VEGHQFGM5FVQXYNN',
  'FRTHQFGVKRGW4K5D',
  'VEGGCDRKBKVHATPG',
  'FRTG3HWKGWF472XJ',
  'FFWHQYDSZFQPNSMK',
  'VEGHHW97YGCFNBU4',
  'VEGHZ2DQGYXGY7WH',
  'FFWHGKDY4JKEQ2EU',
  'VEGHQ4NPSGNEUFTM',
  'VEGHFS82WMERGWMH',
  'VEGHHHYCDVPPDX7S',
  'VEGHD2SMMGFD6QNV',
  'VEGHD2SMTKGKMTT6',
  'VEGHFJZWMZDGHBUB',
  'VEGHJYMGRGGRZVG6'
)
ORDER BY fsn_id, weight_unit;
