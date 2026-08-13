-- Fresh-database bootstrap for ecom-pricing-dashboard (final normalized schema).

CREATE TABLE IF NOT EXISTS public.price_sheet (
  price_sheet_id UUID NOT NULL DEFAULT gen_random_uuid(),
  delivery_date DATE NOT NULL,
  city TEXT NOT NULL,
  city_id INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'Created'
    CHECK (status IN ('Created', 'Submitted for Approval', 'Approved')),
  created_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  CONSTRAINT price_sheet_pkey PRIMARY KEY (price_sheet_id),
  CONSTRAINT price_sheet_delivery_date_city_key UNIQUE (delivery_date, city)
);

CREATE INDEX IF NOT EXISTS price_sheet_delivery_date_city_idx
  ON public.price_sheet (delivery_date, city);

CREATE TABLE IF NOT EXISTS public.price_sheet_details (
  price_sheet_details_id UUID NOT NULL DEFAULT gen_random_uuid(),
  price_sheet_id UUID NOT NULL REFERENCES public.price_sheet (price_sheet_id) ON DELETE CASCADE,
  fsn_id TEXT NULL,
  weight_unit TEXT NULL,
  sku_id TEXT NULL,
  sku_name TEXT NULL,
  cf NUMERIC(12, 2) NULL,
  bucket TEXT NULL,
  subcategory TEXT NULL,
  demand_units NUMERIC(12, 2) NULL,
  demand_pct NUMERIC(12, 3) NULL,
  grn_price_per_kg NUMERIC(12, 2) NULL,
  grn_price_per_unit NUMERIC(12, 2) NULL,
  prev_grn_price_per_kg NUMERIC(12, 2) NULL,
  prev_grn_price_per_unit NUMERIC(12, 2) NULL,
  t3_grn_price_per_kg NUMERIC(12, 2) NULL,
  t3_grn_price_per_unit NUMERIC(12, 2) NULL,
  grn_diff NUMERIC NULL,
  blinkit_sp NUMERIC(12, 2) NULL,
  adjusted_grn NUMERIC(12, 2) NULL DEFAULT 0,
  quoted_pp NUMERIC(12, 2) NULL,
  negotiated_pp NUMERIC(12, 2) NULL,
  submitted BOOLEAN NULL DEFAULT false,
  pm_cost NUMERIC(12, 2) NULL,
  fml_dump NUMERIC(12, 2) NULL,
  pc NUMERIC(12, 2) NULL,
  nlc NUMERIC(12, 2) NULL,
  pi_pct NUMERIC(12, 2) NULL,
  gm NUMERIC(12, 2) NULL,
  deflection_pct NUMERIC(12, 2) NULL,
  impact_pp_diff NUMERIC(12, 2) NULL,
  impact_gm NUMERIC(12, 2) NULL,
  bk_value_mix NUMERIC(12, 2) NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  nlc_negotiated NUMERIC(12, 2) NULL,
  pi_pct_quoted NUMERIC(12, 2) NULL,
  pi_pct_negotiated NUMERIC(12, 2) NULL,
  quoted_locked BOOLEAN NULL,
  negotiated_locked BOOLEAN NULL,
  adjusted_grn_locked BOOLEAN NULL,
  blinkit_sp_locked BOOLEAN NULL,
  grn_locked BOOLEAN NULL,
  CONSTRAINT price_sheet_details_pkey PRIMARY KEY (price_sheet_details_id),
  CONSTRAINT price_sheet_details_sheet_sku_weight_key UNIQUE (price_sheet_id, sku_id, weight_unit)
);

CREATE INDEX IF NOT EXISTS price_sheet_details_sheet_idx ON public.price_sheet_details (price_sheet_id);
CREATE INDEX IF NOT EXISTS price_sheet_details_fsn_weight_idx
  ON public.price_sheet_details (price_sheet_id, fsn_id, weight_unit);

CREATE TABLE IF NOT EXISTS public.fsn_cost_components (
  fsn_id TEXT NOT NULL,
  weight_unit TEXT NOT NULL,
  pm_cost NUMERIC(12, 2) NULL,
  fml_dump NUMERIC(12, 2) NULL,
  pc NUMERIC(12, 2) NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  CONSTRAINT fsn_cost_components_pkey PRIMARY KEY (fsn_id, weight_unit)
);

CREATE INDEX IF NOT EXISTS fsn_cost_components_fsn_idx ON public.fsn_cost_components (fsn_id);

CREATE TABLE IF NOT EXISTS public.pricing_sheet_audit (
  revision_id UUID NOT NULL DEFAULT gen_random_uuid(),
  revision_type SMALLINT NOT NULL DEFAULT 0 CHECK (revision_type IN (0, 1)),
  price_sheet_details_id UUID NOT NULL
    REFERENCES public.price_sheet_details (price_sheet_details_id) ON DELETE CASCADE,
  price_sheet_id UUID NOT NULL
    REFERENCES public.price_sheet (price_sheet_id) ON DELETE CASCADE,
  delivery_date DATE NULL,
  city TEXT NULL,
  city_id INTEGER NULL,
  fsn_id TEXT NULL,
  weight_unit TEXT NULL,
  sku_id TEXT NULL,
  sku_name TEXT NULL,
  cf NUMERIC(12, 2) NULL,
  bucket TEXT NULL,
  subcategory TEXT NULL,
  demand_units NUMERIC(12, 2) NULL,
  demand_pct NUMERIC(12, 3) NULL,
  grn_price_per_kg NUMERIC(12, 2) NULL,
  grn_price_per_unit NUMERIC(12, 2) NULL,
  prev_grn_price_per_kg NUMERIC(12, 2) NULL,
  prev_grn_price_per_unit NUMERIC(12, 2) NULL,
  grn_diff NUMERIC NULL,
  blinkit_sp NUMERIC(12, 2) NULL,
  adjusted_grn NUMERIC(12, 2) NULL,
  quoted_pp NUMERIC(12, 2) NULL,
  negotiated_pp NUMERIC(12, 2) NULL,
  submitted BOOLEAN NULL,
  pm_cost NUMERIC(12, 2) NULL,
  fml_dump NUMERIC(12, 2) NULL,
  pc NUMERIC(12, 2) NULL,
  nlc NUMERIC(12, 2) NULL,
  pi_pct NUMERIC(12, 2) NULL,
  gm NUMERIC(12, 2) NULL,
  deflection_pct NUMERIC(12, 2) NULL,
  impact_pp_diff NUMERIC(12, 2) NULL,
  impact_gm NUMERIC(12, 2) NULL,
  bk_value_mix NUMERIC(12, 2) NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  nlc_negotiated NUMERIC(12, 2) NULL,
  pi_pct_quoted NUMERIC(12, 2) NULL,
  pi_pct_negotiated NUMERIC(12, 2) NULL,
  quoted_locked BOOLEAN NULL,
  negotiated_locked BOOLEAN NULL,
  adjusted_grn_locked BOOLEAN NULL,
  blinkit_sp_locked BOOLEAN NULL,
  grn_locked BOOLEAN NULL,
  t3_grn_price_per_kg NUMERIC(12, 2) NULL,
  t3_grn_price_per_unit NUMERIC(12, 2) NULL,
  CONSTRAINT pricing_sheet_audit_pkey PRIMARY KEY (revision_id)
);

CREATE INDEX IF NOT EXISTS pricing_sheet_audit_details_revision_idx
  ON public.pricing_sheet_audit (price_sheet_details_id, revision_type, created_at DESC);
CREATE INDEX IF NOT EXISTS pricing_sheet_audit_sheet_idx ON public.pricing_sheet_audit (price_sheet_id);
CREATE INDEX IF NOT EXISTS pricing_sheet_audit_row_created_idx
  ON public.pricing_sheet_audit (city, delivery_date, fsn_id, weight_unit, created_at DESC);

CREATE TABLE IF NOT EXISTS public.guardrails (
  city TEXT NOT NULL,
  pi_min NUMERIC(12, 2) NULL,
  pi_max NUMERIC(12, 2) NULL,
  gm_target NUMERIC(12, 2) NULL,
  deflection_target NUMERIC(12, 2) NULL,
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  CONSTRAINT guardrails_pkey PRIMARY KEY (city)
);

CREATE TABLE IF NOT EXISTS public.subcategory (
  fsn_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
  CONSTRAINT subcategory_pkey PRIMARY KEY (fsn_id, sku_id)
);

CREATE INDEX IF NOT EXISTS subcategory_name_idx ON public.subcategory (subcategory);

-- Metrics trigger (latest version with /100 demand_pct fix)
CREATE OR REPLACE FUNCTION public.calculate_price_sheet_detail_metrics()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  hdr_delivery_date date;
  hdr_city text;
  prev_nlc numeric(12,2);
  grn_delta numeric(12,2) := 0;
  ref_pm_cost numeric(12,2);
  ref_fml_dump numeric(12,2);
  ref_pc numeric(12,2);
  prev_quoted_pp numeric(12,2);
begin
  select ps.delivery_date, ps.city into hdr_delivery_date, hdr_city
  from public.price_sheet ps where ps.price_sheet_id = new.price_sheet_id;

  new.updated_at := now();

  select scc.pm_cost, scc.fml_dump, scc.pc into ref_pm_cost, ref_fml_dump, ref_pc
  from public.fsn_cost_components scc
  where scc.fsn_id = new.fsn_id and scc.weight_unit = new.weight_unit;

  if new.pm_cost is null or new.pm_cost = 0 then
    new.pm_cost := coalesce(nullif(ref_pm_cost, 0), coalesce(new.pm_cost, 0));
  end if;
  if new.fml_dump is null or new.fml_dump = 0 then
    new.fml_dump := coalesce(nullif(ref_fml_dump, 0), coalesce(new.fml_dump, 0));
  end if;
  if new.pc is null or new.pc = 0 then
    new.pc := coalesce(nullif(ref_pc, 0), coalesce(new.pc, 0));
  end if;

  if TG_OP = 'INSERT' then
    select d.quoted_pp into prev_quoted_pp
    from public.price_sheet_details d
    join public.price_sheet ps on ps.price_sheet_id = d.price_sheet_id
    where d.fsn_id = new.fsn_id and d.weight_unit = new.weight_unit
      and ps.city = hdr_city and ps.delivery_date < hdr_delivery_date
    order by ps.delivery_date desc limit 1;
    if new.quoted_pp is null then new.quoted_pp := prev_quoted_pp; end if;
  end if;

  new.grn_price_per_kg := coalesce(new.grn_price_per_kg, new.prev_grn_price_per_kg, new.t3_grn_price_per_kg);
  new.grn_price_per_unit := coalesce(new.grn_price_per_unit, new.prev_grn_price_per_unit, new.t3_grn_price_per_unit);

  if TG_OP = 'UPDATE' then
    grn_delta := coalesce(new.adjusted_grn, 0) - coalesce(old.adjusted_grn, 0);
  elsif TG_OP = 'INSERT' then
    grn_delta := coalesce(new.adjusted_grn, 0);
  end if;
  if grn_delta <> 0 and (TG_OP = 'UPDATE' or new.quoted_pp is null) then
    new.quoted_pp := coalesce(new.quoted_pp, 0) + grn_delta;
  end if;

  new.nlc := coalesce(new.quoted_pp, 0) + coalesce(new.pm_cost, 0) + coalesce(new.fml_dump, 0) + coalesce(new.pc, 0);

  if new.blinkit_sp is not null and new.blinkit_sp <> 0 then
    new.pi_pct := round(((new.blinkit_sp - new.nlc) / new.blinkit_sp) * 100, 2);
  else new.pi_pct := null; end if;

  if new.grn_price_per_unit is not null then new.gm := new.nlc - new.grn_price_per_unit; else new.gm := null; end if;

  if new.grn_price_per_unit is not null and new.prev_grn_price_per_unit is not null then
    new.grn_diff := new.grn_price_per_unit - new.prev_grn_price_per_unit;
  else new.grn_diff := null; end if;

  select d.nlc into prev_nlc
  from public.price_sheet_details d
  join public.price_sheet ps on ps.price_sheet_id = d.price_sheet_id
  where d.fsn_id = new.fsn_id and d.weight_unit = new.weight_unit
    and ps.city = hdr_city and ps.delivery_date < hdr_delivery_date
  order by ps.delivery_date desc limit 1;

  if prev_nlc is not null and prev_nlc <> 0 then
    new.deflection_pct := round(((new.nlc - prev_nlc) / prev_nlc) * 100, 2);
  else new.deflection_pct := null; end if;

  if new.grn_price_per_unit is not null and new.demand_pct is not null then
    new.impact_pp_diff := round((coalesce(new.quoted_pp, 0) - new.grn_price_per_unit) * new.demand_pct / 100, 2);
  else new.impact_pp_diff := null; end if;

  if new.gm is not null and new.demand_pct is not null then
    new.impact_gm := round(new.gm * new.demand_pct / 100, 2);
  else new.impact_gm := null; end if;

  if new.blinkit_sp is not null and new.demand_units is not null then
    new.bk_value_mix := round(new.blinkit_sp * new.demand_units, 2);
  else new.bk_value_mix := null; end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_demand_pct_detail_stmt()
 RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  update public.price_sheet_details d
  set demand_pct = round(case when totals.total_demand > 0
    then (d.demand_units / totals.total_demand) * 100 else 0 end, 3)
  from (
    select price_sheet_id, sum(demand_units) as total_demand
    from public.price_sheet_details
    where price_sheet_id in (select distinct price_sheet_id from new_rows)
    group by price_sheet_id
  ) totals
  where d.price_sheet_id = totals.price_sheet_id;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_price_sheet_header()
 RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  update public.price_sheet set updated_at = now() where price_sheet_id = new.price_sheet_id;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_calculate_price_sheet_detail_metrics ON public.price_sheet_details;
CREATE TRIGGER trg_calculate_price_sheet_detail_metrics
  BEFORE INSERT OR UPDATE ON public.price_sheet_details
  FOR EACH ROW EXECUTE FUNCTION calculate_price_sheet_detail_metrics();

DROP TRIGGER IF EXISTS trg_recompute_demand_pct_detail_insert ON public.price_sheet_details;
CREATE TRIGGER trg_recompute_demand_pct_detail_insert
  AFTER INSERT ON public.price_sheet_details
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recompute_demand_pct_detail_stmt();

DROP TRIGGER IF EXISTS trg_recompute_demand_pct_detail_update ON public.price_sheet_details;
CREATE TRIGGER trg_recompute_demand_pct_detail_update
  AFTER UPDATE ON public.price_sheet_details
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recompute_demand_pct_detail_stmt();

DROP TRIGGER IF EXISTS trg_touch_price_sheet_header ON public.price_sheet_details;
CREATE TRIGGER trg_touch_price_sheet_header
  AFTER INSERT OR UPDATE ON public.price_sheet_details
  FOR EACH ROW EXECUTE FUNCTION touch_price_sheet_header();

-- RLS + grants
ALTER TABLE public.price_sheet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_sheet_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fsn_cost_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_sheet_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardrails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='price_sheet' AND policyname='price_sheet_anon_all') THEN
    CREATE POLICY price_sheet_anon_all ON public.price_sheet FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='price_sheet_details' AND policyname='price_sheet_details_anon_all') THEN
    CREATE POLICY price_sheet_details_anon_all ON public.price_sheet_details FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fsn_cost_components' AND policyname='fsn_cost_components_anon_all') THEN
    CREATE POLICY fsn_cost_components_anon_all ON public.fsn_cost_components FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pricing_sheet_audit' AND policyname='pricing_sheet_audit_anon_all') THEN
    CREATE POLICY pricing_sheet_audit_anon_all ON public.pricing_sheet_audit FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guardrails' AND policyname='guardrails_anon_all') THEN
    CREATE POLICY guardrails_anon_all ON public.guardrails FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='subcategory' AND policyname='subcategory_anon_all') THEN
    CREATE POLICY subcategory_anon_all ON public.subcategory FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_sheet TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_sheet_details TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fsn_cost_components TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_sheet_audit TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardrails TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcategory TO anon, authenticated;
