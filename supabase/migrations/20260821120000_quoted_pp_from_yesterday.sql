-- Carry Quoted PP from the latest prior sheet when today's value is null or 0.
-- Match fsn+pack, then FSN, then sku_id (covers yesterday rows that had a blank FSN).
-- Leftover 0 is stored as null so NLC/GM/Impact stay blank instead of costs-only.

CREATE OR REPLACE FUNCTION public.lookup_prev_quoted_pp(
  p_fsn_id text,
  p_weight_unit text,
  p_sku_id text,
  p_city text,
  p_delivery_date date
) RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  prev_quoted numeric(12, 2);
BEGIN
  IF p_fsn_id IS NOT NULL AND btrim(p_fsn_id) <> '' THEN
    SELECT d.quoted_pp
    INTO prev_quoted
    FROM public.price_sheet_details d
    JOIN public.price_sheet ps ON ps.price_sheet_id = d.price_sheet_id
    WHERE d.fsn_id = p_fsn_id
      AND d.weight_unit = p_weight_unit
      AND ps.city = p_city
      AND ps.delivery_date < p_delivery_date
      AND d.quoted_pp IS NOT NULL
      AND d.quoted_pp <> 0
    ORDER BY ps.delivery_date DESC
    LIMIT 1;

    IF prev_quoted IS NOT NULL THEN
      RETURN prev_quoted;
    END IF;

    SELECT d.quoted_pp
    INTO prev_quoted
    FROM public.price_sheet_details d
    JOIN public.price_sheet ps ON ps.price_sheet_id = d.price_sheet_id
    WHERE d.fsn_id = p_fsn_id
      AND ps.city = p_city
      AND ps.delivery_date < p_delivery_date
      AND d.quoted_pp IS NOT NULL
      AND d.quoted_pp <> 0
    ORDER BY ps.delivery_date DESC
    LIMIT 1;

    IF prev_quoted IS NOT NULL THEN
      RETURN prev_quoted;
    END IF;
  END IF;

  IF p_sku_id IS NOT NULL AND btrim(p_sku_id) <> '' THEN
    SELECT d.quoted_pp
    INTO prev_quoted
    FROM public.price_sheet_details d
    JOIN public.price_sheet ps ON ps.price_sheet_id = d.price_sheet_id
    WHERE d.sku_id = p_sku_id
      AND ps.city = p_city
      AND ps.delivery_date < p_delivery_date
      AND d.quoted_pp IS NOT NULL
      AND d.quoted_pp <> 0
    ORDER BY ps.delivery_date DESC
    LIMIT 1;
  END IF;

  RETURN prev_quoted;
END;
$$;

CREATE OR REPLACE FUNCTION public.display_nlc_from_detail(
  p_negotiated_pp numeric,
  p_quoted_pp numeric,
  p_pm_cost numeric,
  p_fml_dump numeric,
  p_pc numeric,
  p_nlc_negotiated numeric,
  p_nlc numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_quoted_pp IS NULL OR p_quoted_pp = 0 THEN NULL
    ELSE p_quoted_pp
      + coalesce(p_pm_cost, 0)
      + coalesce(p_fml_dump, 0)
      + coalesce(p_pc, 0)
  END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_price_sheet_detail_metrics()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  hdr_delivery_date date;
  hdr_city text;
  prev_nlc numeric(12, 2);
  display_nlc numeric(12, 2);
  ref_pm_cost numeric(12, 2);
  ref_fml_dump numeric(12, 2);
  ref_pc numeric(12, 2);
  ref_found boolean := false;
  prev_quoted_pp numeric(12, 2);
BEGIN
  SELECT ps.delivery_date, ps.city
  INTO hdr_delivery_date, hdr_city
  FROM public.price_sheet ps
  WHERE ps.price_sheet_id = new.price_sheet_id;

  new.updated_at := now();

  SELECT scc.pm_cost, scc.fml_dump, scc.pc
  INTO ref_pm_cost, ref_fml_dump, ref_pc
  FROM public.fsn_cost_components scc
  WHERE scc.fsn_id = new.fsn_id
    AND scc.weight_unit = new.weight_unit;

  IF found THEN
    ref_found := true;
  ELSE
    SELECT scc.pm_cost, scc.fml_dump, scc.pc
    INTO ref_pm_cost, ref_fml_dump, ref_pc
    FROM public.fsn_cost_components scc
    WHERE scc.fsn_id = new.fsn_id
      AND (SELECT count(*) FROM public.fsn_cost_components s2 WHERE s2.fsn_id = new.fsn_id) = 1
    LIMIT 1;
    IF found THEN
      ref_found := true;
    END IF;
  END IF;

  IF ref_found THEN
    new.pm_cost := coalesce(ref_pm_cost, new.pm_cost);
    new.fml_dump := coalesce(ref_fml_dump, new.fml_dump);
    new.pc := coalesce(ref_pc, new.pc);
  END IF;

  IF new.quoted_pp IS NULL OR new.quoted_pp = 0 THEN
    prev_quoted_pp := public.lookup_prev_quoted_pp(
      new.fsn_id,
      new.weight_unit,
      new.sku_id,
      hdr_city,
      hdr_delivery_date
    );
    IF prev_quoted_pp IS NOT NULL AND prev_quoted_pp <> 0 THEN
      new.quoted_pp := prev_quoted_pp;
    ELSE
      new.quoted_pp := NULL;
    END IF;
  END IF;

  new.grn_price_per_kg := coalesce(new.grn_price_per_kg, new.prev_grn_price_per_kg, new.t3_grn_price_per_kg);
  new.grn_price_per_unit := coalesce(new.grn_price_per_unit, new.prev_grn_price_per_unit, new.t3_grn_price_per_unit);

  IF new.grn_price_per_kg IS NOT NULL THEN
    new.total_grn := new.grn_price_per_kg + coalesce(new.adjusted_grn, 0);
    new.total_grn_per_unit := new.total_grn * coalesce(new.cf, 1);
  ELSE
    new.total_grn := NULL;
    new.total_grn_per_unit := NULL;
  END IF;

  IF new.quoted_pp IS NOT NULL AND new.quoted_pp <> 0 THEN
    new.nlc := new.quoted_pp
      + coalesce(new.pm_cost, 0)
      + coalesce(new.fml_dump, 0)
      + coalesce(new.pc, 0);
  ELSE
    new.nlc := NULL;
  END IF;

  IF new.negotiated_pp IS NOT NULL AND new.negotiated_pp <> 0 THEN
    new.nlc_negotiated := new.negotiated_pp
      + coalesce(new.pm_cost, 0)
      + coalesce(new.fml_dump, 0)
      + coalesce(new.pc, 0);
  ELSE
    new.nlc_negotiated := NULL;
  END IF;

  display_nlc := new.nlc;

  IF new.blinkit_sp IS NOT NULL AND new.blinkit_sp <> 0 AND display_nlc IS NOT NULL THEN
    new.pi_pct_quoted := round(((new.blinkit_sp - new.nlc) / new.blinkit_sp) * 100, 2);
    IF new.nlc_negotiated IS NOT NULL THEN
      new.pi_pct_negotiated := round(((new.blinkit_sp - new.nlc_negotiated) / new.blinkit_sp) * 100, 2);
    ELSE
      new.pi_pct_negotiated := NULL;
    END IF;
    new.pi_pct := new.pi_pct_quoted;
  ELSE
    new.pi_pct := NULL;
    new.pi_pct_quoted := NULL;
    new.pi_pct_negotiated := NULL;
  END IF;

  IF new.total_grn_per_unit IS NOT NULL AND display_nlc IS NOT NULL THEN
    new.gm := display_nlc - new.total_grn_per_unit;
  ELSE
    new.gm := NULL;
  END IF;

  IF new.total_grn_per_unit IS NOT NULL AND new.prev_grn_price_per_unit IS NOT NULL THEN
    new.grn_diff := new.total_grn_per_unit - new.prev_grn_price_per_unit;
  ELSE
    new.grn_diff := NULL;
  END IF;

  prev_nlc := public.lookup_prev_display_nlc(new.fsn_id, new.weight_unit, hdr_city, hdr_delivery_date);

  IF prev_nlc IS NOT NULL AND prev_nlc <> 0 AND display_nlc IS NOT NULL THEN
    new.deflection_pct := round(((display_nlc - prev_nlc) / prev_nlc) * 100, 2);
  ELSE
    new.deflection_pct := NULL;
  END IF;

  IF new.total_grn_per_unit IS NOT NULL
     AND new.demand_pct IS NOT NULL
     AND new.quoted_pp IS NOT NULL
     AND new.quoted_pp <> 0 THEN
    new.impact_pp_diff := round((new.quoted_pp - new.total_grn_per_unit) * new.demand_pct / 100, 2);
  ELSE
    new.impact_pp_diff := NULL;
  END IF;

  IF new.gm IS NOT NULL AND new.demand_pct IS NOT NULL THEN
    new.impact_gm := round(new.gm * new.demand_pct / 100, 2);
  ELSE
    new.impact_gm := NULL;
  END IF;

  IF new.blinkit_sp IS NOT NULL AND new.demand_units IS NOT NULL THEN
    new.bk_value_mix := round(new.blinkit_sp * new.demand_units, 2);
  ELSE
    new.bk_value_mix := NULL;
  END IF;

  RETURN new;
END;
$function$;

-- Placeholder Quoted PP = 1 on Yellow Sevanthi: 20 Aug Quoted was blank (FSN was also blank).
UPDATE public.price_sheet_details d
SET quoted_pp = NULL
FROM public.price_sheet ps
WHERE ps.price_sheet_id = d.price_sheet_id
  AND ps.delivery_date = '2026-08-21'
  AND d.fsn_id = 'FFWHPZ8FPZNKTJSY';

-- Recompute 21 Aug only: fill Quoted PP = 0 from yesterday; leftover 0 → null.
UPDATE public.price_sheet_details d
SET quoted_pp = quoted_pp
FROM public.price_sheet ps
WHERE ps.price_sheet_id = d.price_sheet_id
  AND ps.delivery_date = '2026-08-21'
  AND (d.quoted_pp IS NULL OR d.quoted_pp = 0);
