-- Align DB trigger metrics with UI: GM / Impact GM / Deflection use displayed NLC
-- (negotiated PP + costs when set, else quoted PP + costs). Then touch all rows
-- so existing sheets pick up the corrected stored values.

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
  SELECT coalesce(
    nullif(p_nlc_negotiated, 0),
    CASE
      WHEN p_negotiated_pp IS NOT NULL AND p_negotiated_pp <> 0 THEN
        p_negotiated_pp + coalesce(p_pm_cost, 0) + coalesce(p_fml_dump, 0) + coalesce(p_pc, 0)
      ELSE NULL
    END,
    nullif(p_nlc, 0),
    CASE
      WHEN p_quoted_pp IS NOT NULL THEN
        p_quoted_pp + coalesce(p_pm_cost, 0) + coalesce(p_fml_dump, 0) + coalesce(p_pc, 0)
      ELSE NULL
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.lookup_prev_display_nlc(
  p_fsn_id text,
  p_weight_unit text,
  p_city text,
  p_delivery_date date
) RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  prev_nlc numeric(12, 2);
BEGIN
  SELECT public.display_nlc_from_detail(
    d.negotiated_pp,
    d.quoted_pp,
    d.pm_cost,
    d.fml_dump,
    d.pc,
    d.nlc_negotiated,
    d.nlc
  )
  INTO prev_nlc
  FROM public.price_sheet_details d
  JOIN public.price_sheet ps ON ps.price_sheet_id = d.price_sheet_id
  WHERE d.fsn_id = p_fsn_id
    AND d.weight_unit = p_weight_unit
    AND ps.city = p_city
    AND ps.delivery_date < p_delivery_date
  ORDER BY ps.delivery_date DESC
  LIMIT 1;

  IF prev_nlc IS NOT NULL AND prev_nlc <> 0 THEN
    RETURN prev_nlc;
  END IF;

  SELECT public.display_nlc_from_detail(
    d.negotiated_pp,
    d.quoted_pp,
    d.pm_cost,
    d.fml_dump,
    d.pc,
    d.nlc_negotiated,
    d.nlc
  )
  INTO prev_nlc
  FROM public.price_sheet_details d
  JOIN public.price_sheet ps ON ps.price_sheet_id = d.price_sheet_id
  WHERE d.fsn_id = p_fsn_id
    AND ps.city = p_city
    AND ps.delivery_date < p_delivery_date
  ORDER BY ps.delivery_date DESC
  LIMIT 1;

  IF prev_nlc IS NULL OR prev_nlc = 0 THEN
    RETURN NULL;
  END IF;

  RETURN prev_nlc;
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
  grn_delta numeric(12, 2) := 0;
  ref_pm_cost numeric(12, 2);
  ref_fml_dump numeric(12, 2);
  ref_pc numeric(12, 2);
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

  IF NOT found THEN
    SELECT scc.pm_cost, scc.fml_dump, scc.pc
    INTO ref_pm_cost, ref_fml_dump, ref_pc
    FROM public.fsn_cost_components scc
    WHERE scc.fsn_id = new.fsn_id
      AND (SELECT count(*) FROM public.fsn_cost_components s2 WHERE s2.fsn_id = new.fsn_id) = 1
    LIMIT 1;
  END IF;

  IF new.pm_cost IS NULL OR new.pm_cost = 0 THEN
    new.pm_cost := coalesce(nullif(ref_pm_cost, 0), coalesce(new.pm_cost, 0));
  END IF;
  IF new.fml_dump IS NULL OR new.fml_dump = 0 THEN
    new.fml_dump := coalesce(nullif(ref_fml_dump, 0), coalesce(new.fml_dump, 0));
  END IF;
  IF new.pc IS NULL OR new.pc = 0 THEN
    new.pc := coalesce(nullif(ref_pc, 0), coalesce(new.pc, 0));
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT d.quoted_pp
    INTO prev_quoted_pp
    FROM public.price_sheet_details d
    JOIN public.price_sheet ps ON ps.price_sheet_id = d.price_sheet_id
    WHERE d.fsn_id = new.fsn_id
      AND d.weight_unit = new.weight_unit
      AND ps.city = hdr_city
      AND ps.delivery_date < hdr_delivery_date
    ORDER BY ps.delivery_date DESC
    LIMIT 1;

    IF new.quoted_pp IS NULL THEN
      new.quoted_pp := prev_quoted_pp;
    END IF;
  END IF;

  new.grn_price_per_kg := coalesce(new.grn_price_per_kg, new.prev_grn_price_per_kg, new.t3_grn_price_per_kg);
  new.grn_price_per_unit := coalesce(new.grn_price_per_unit, new.prev_grn_price_per_unit, new.t3_grn_price_per_unit);

  IF TG_OP = 'UPDATE' THEN
    grn_delta := coalesce(new.adjusted_grn, 0) - coalesce(old.adjusted_grn, 0);
  ELSIF TG_OP = 'INSERT' THEN
    grn_delta := coalesce(new.adjusted_grn, 0);
  END IF;

  IF grn_delta <> 0 THEN
    IF TG_OP = 'UPDATE' OR new.quoted_pp IS NULL THEN
      new.quoted_pp := coalesce(new.quoted_pp, 0) + grn_delta;
    END IF;
  END IF;

  new.nlc := coalesce(new.quoted_pp, 0)
    + coalesce(new.pm_cost, 0)
    + coalesce(new.fml_dump, 0)
    + coalesce(new.pc, 0);

  IF new.negotiated_pp IS NOT NULL AND new.negotiated_pp <> 0 THEN
    new.nlc_negotiated := new.negotiated_pp
      + coalesce(new.pm_cost, 0)
      + coalesce(new.fml_dump, 0)
      + coalesce(new.pc, 0);
  ELSE
    new.nlc_negotiated := NULL;
  END IF;

  display_nlc := public.display_nlc_from_detail(
    new.negotiated_pp,
    new.quoted_pp,
    new.pm_cost,
    new.fml_dump,
    new.pc,
    new.nlc_negotiated,
    new.nlc
  );

  IF new.blinkit_sp IS NOT NULL AND new.blinkit_sp <> 0 THEN
    new.pi_pct_quoted := round(((new.blinkit_sp - new.nlc) / new.blinkit_sp) * 100, 2);
    IF new.nlc_negotiated IS NOT NULL THEN
      new.pi_pct_negotiated := round(((new.blinkit_sp - new.nlc_negotiated) / new.blinkit_sp) * 100, 2);
    ELSE
      new.pi_pct_negotiated := NULL;
    END IF;
    new.pi_pct := coalesce(new.pi_pct_negotiated, new.pi_pct_quoted);
  ELSE
    new.pi_pct := NULL;
    new.pi_pct_quoted := NULL;
    new.pi_pct_negotiated := NULL;
  END IF;

  IF new.grn_price_per_unit IS NOT NULL AND display_nlc IS NOT NULL THEN
    new.gm := display_nlc - new.grn_price_per_unit;
  ELSE
    new.gm := NULL;
  END IF;

  IF new.grn_price_per_unit IS NOT NULL AND new.prev_grn_price_per_unit IS NOT NULL THEN
    new.grn_diff := new.grn_price_per_unit - new.prev_grn_price_per_unit;
  ELSE
    new.grn_diff := NULL;
  END IF;

  prev_nlc := public.lookup_prev_display_nlc(new.fsn_id, new.weight_unit, hdr_city, hdr_delivery_date);

  IF prev_nlc IS NOT NULL AND prev_nlc <> 0 AND display_nlc IS NOT NULL THEN
    new.deflection_pct := round(((display_nlc - prev_nlc) / prev_nlc) * 100, 2);
  ELSE
    new.deflection_pct := NULL;
  END IF;

  IF new.grn_price_per_unit IS NOT NULL AND new.demand_pct IS NOT NULL THEN
    new.impact_pp_diff := round((coalesce(new.quoted_pp, 0) - new.grn_price_per_unit) * new.demand_pct / 100, 2);
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

-- Backfill: touch every detail row so the trigger recomputes stored metrics.
UPDATE public.price_sheet_details
SET updated_at = now()
WHERE true;
