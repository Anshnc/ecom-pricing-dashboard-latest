-- bksp total demand% (DB only; not shown in the grid, not an audit column).
-- Same mix as demand_pct when Blinkit SP is present and <> 0, else 0.

ALTER TABLE public.price_sheet_details
  ADD COLUMN IF NOT EXISTS bksp_total_demand_pct NUMERIC(12, 3) NULL;

CREATE OR REPLACE FUNCTION public.recompute_demand_pct_detail_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  update public.price_sheet_details d
  set
    demand_pct = round(
      case when totals.total_demand > 0
        then (d.demand_units / totals.total_demand) * 100
        else 0
      end, 3),
    bksp_total_demand_pct = case
      when d.blinkit_sp is not null and d.blinkit_sp <> 0 then
        round(
          case when totals.total_demand > 0
            then (d.demand_units / totals.total_demand) * 100
            else 0
          end, 3)
      else 0
    end
  from (
    select price_sheet_id, sum(demand_units) as total_demand
    from public.price_sheet_details
    where price_sheet_id in (
      select distinct price_sheet_id from new_rows
    )
    group by price_sheet_id
  ) totals
  where d.price_sheet_id = totals.price_sheet_id;

  return null;
end;
$function$;

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

  IF new.blinkit_sp IS NOT NULL AND new.blinkit_sp <> 0 THEN
    new.bksp_total_demand_pct := coalesce(new.demand_pct, 0);
  ELSE
    new.bksp_total_demand_pct := 0;
  END IF;

  RETURN new;
END;
$function$;

-- Backfill without firing metrics/demand triggers (those would rewrite Quoted PP / NLC).
ALTER TABLE public.price_sheet_details DISABLE TRIGGER trg_calculate_price_sheet_detail_metrics;
ALTER TABLE public.price_sheet_details DISABLE TRIGGER trg_recompute_demand_pct_detail_update;
ALTER TABLE public.price_sheet_details DISABLE TRIGGER trg_touch_price_sheet_header;

UPDATE public.price_sheet_details
SET bksp_total_demand_pct = CASE
  WHEN blinkit_sp IS NOT NULL AND blinkit_sp <> 0 THEN coalesce(demand_pct, 0)
  ELSE 0
END
WHERE bksp_total_demand_pct IS NULL;

ALTER TABLE public.price_sheet_details ENABLE TRIGGER trg_calculate_price_sheet_detail_metrics;
ALTER TABLE public.price_sheet_details ENABLE TRIGGER trg_recompute_demand_pct_detail_update;
ALTER TABLE public.price_sheet_details ENABLE TRIGGER trg_touch_price_sheet_header;
