-- FSN-only fallback for fsn_cost_components lookup when weight_unit differs
-- (e.g. NC Name stored in reference table vs MySQL lot name on price sheet).

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
  select ps.delivery_date, ps.city
  into hdr_delivery_date, hdr_city
  from public.price_sheet ps
  where ps.price_sheet_id = new.price_sheet_id;

  new.updated_at := now();

  select scc.pm_cost, scc.fml_dump, scc.pc
  into ref_pm_cost, ref_fml_dump, ref_pc
  from public.fsn_cost_components scc
  where scc.fsn_id = new.fsn_id
    and scc.weight_unit = new.weight_unit;

  if not found then
    select scc.pm_cost, scc.fml_dump, scc.pc
    into ref_pm_cost, ref_fml_dump, ref_pc
    from public.fsn_cost_components scc
    where scc.fsn_id = new.fsn_id
      and (select count(*) from public.fsn_cost_components s2 where s2.fsn_id = new.fsn_id) = 1
    limit 1;
  end if;

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
    select d.quoted_pp
    into prev_quoted_pp
    from public.price_sheet_details d
    join public.price_sheet ps on ps.price_sheet_id = d.price_sheet_id
    where d.fsn_id = new.fsn_id
      and d.weight_unit = new.weight_unit
      and ps.city = hdr_city
      and ps.delivery_date < hdr_delivery_date
    order by ps.delivery_date desc
    limit 1;

    if new.quoted_pp is null then new.quoted_pp := prev_quoted_pp; end if;
  end if;

  new.grn_price_per_kg := coalesce(new.grn_price_per_kg, new.prev_grn_price_per_kg, new.t3_grn_price_per_kg);
  new.grn_price_per_unit := coalesce(new.grn_price_per_unit, new.prev_grn_price_per_unit, new.t3_grn_price_per_unit);

  if TG_OP = 'UPDATE' then
    grn_delta := coalesce(new.adjusted_grn, 0) - coalesce(old.adjusted_grn, 0);
  elsif TG_OP = 'INSERT' then
    grn_delta := coalesce(new.adjusted_grn, 0);
  end if;
  if grn_delta <> 0 then
    if TG_OP = 'UPDATE' or new.quoted_pp is null then
      new.quoted_pp := coalesce(new.quoted_pp, 0) + grn_delta;
    end if;
  end if;

  new.nlc := coalesce(new.quoted_pp, 0) + coalesce(new.pm_cost, 0) + coalesce(new.fml_dump, 0) + coalesce(new.pc, 0);

  if new.blinkit_sp is not null and new.blinkit_sp <> 0 then
    new.pi_pct := round(((new.blinkit_sp - new.nlc) / new.blinkit_sp) * 100, 2);
  else
    new.pi_pct := null;
  end if;

  if new.grn_price_per_unit is not null then
    new.gm := new.nlc - new.grn_price_per_unit;
  else
    new.gm := null;
  end if;

  if new.grn_price_per_unit is not null and new.prev_grn_price_per_unit is not null then
    new.grn_diff := new.grn_price_per_unit - new.prev_grn_price_per_unit;
  else
    new.grn_diff := null;
  end if;

  prev_nlc := public.lookup_prev_quoted_nlc(new.fsn_id, new.weight_unit, hdr_city, hdr_delivery_date);

  if prev_nlc is not null and prev_nlc <> 0 then
    new.deflection_pct := round(((new.nlc - prev_nlc) / prev_nlc) * 100, 2);
  else
    new.deflection_pct := null;
  end if;

  if new.grn_price_per_unit is not null and new.demand_pct is not null then
    new.impact_pp_diff := round((coalesce(new.quoted_pp, 0) - new.grn_price_per_unit) * new.demand_pct / 100, 2);
  else
    new.impact_pp_diff := null;
  end if;

  if new.gm is not null and new.demand_pct is not null then
    new.impact_gm := round(new.gm * new.demand_pct / 100, 2);
  else
    new.impact_gm := null;
  end if;

  if new.blinkit_sp is not null and new.demand_units is not null then
    new.bk_value_mix := round(new.blinkit_sp * new.demand_units, 2);
  else
    new.bk_value_mix := null;
  end if;

  return new;
end;
$function$;

-- Recompute costs / NLC on rows that still have zero cost components but have reference data.
update public.price_sheet_details d
set updated_at = now()
where (
  d.pm_cost is null or d.pm_cost = 0
  or d.fml_dump is null or d.fml_dump = 0
  or d.pc is null or d.pc = 0
)
and exists (
  select 1 from public.fsn_cost_components scc where scc.fsn_id = d.fsn_id
);
