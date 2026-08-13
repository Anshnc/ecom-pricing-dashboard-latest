-- Guardrails per city (PI / GM / deflection targets).
CREATE TABLE IF NOT EXISTS public.guardrails (
  city TEXT NOT NULL,
  pi_min NUMERIC(12, 2) NULL,
  pi_max NUMERIC(12, 2) NULL,
  gm_target NUMERIC(12, 2) NULL,
  deflection_target NUMERIC(12, 2) NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),

  CONSTRAINT guardrails_pkey PRIMARY KEY (city)
);

ALTER TABLE public.guardrails ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guardrails' AND policyname = 'guardrails_anon_all'
  ) THEN
    CREATE POLICY guardrails_anon_all ON public.guardrails
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardrails TO anon, authenticated;

-- FSN / SKU → subcategory mapping (optional reference; app falls back to price_sheet_details).
CREATE TABLE IF NOT EXISTS public.subcategory (
  fsn_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),

  CONSTRAINT subcategory_pkey PRIMARY KEY (fsn_id, sku_id)
);

CREATE INDEX IF NOT EXISTS subcategory_name_idx ON public.subcategory (subcategory);

ALTER TABLE public.subcategory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'subcategory' AND policyname = 'subcategory_anon_all'
  ) THEN
    CREATE POLICY subcategory_anon_all ON public.subcategory
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcategory TO anon, authenticated;
