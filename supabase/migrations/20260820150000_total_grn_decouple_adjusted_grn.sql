-- Decouple adjusted_grn from quoted_pp; add total_grn / total_grn_per_unit; use total GRN for GM.

ALTER TABLE public.price_sheet_details
  ADD COLUMN IF NOT EXISTS total_grn NUMERIC(12, 2) NULL,
  ADD COLUMN IF NOT EXISTS total_grn_per_unit NUMERIC(12, 2) NULL;

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

  -- Total GRN = GRN/kg + Adjusted GRN; Total GRN/unit = Total GRN × CF
  IF new.grn_price_per_kg IS NOT NULL THEN
    new.total_grn := new.grn_price_per_kg + coalesce(new.adjusted_grn, 0);
    new.total_grn_per_unit := new.total_grn * coalesce(new.cf, 1);
  ELSE
    new.total_grn := NULL;
    new.total_grn_per_unit := NULL;
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
    new.pi_pct := new.pi_pct_negotiated;
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
     AND new.quoted_pp IS NOT NULL THEN
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

UPDATE public.price_sheet_details
SET updated_at = now()
WHERE true;
