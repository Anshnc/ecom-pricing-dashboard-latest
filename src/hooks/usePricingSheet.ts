import { useCallback, useEffect, useState } from "react";
import { supabase, type PricingSheetRow } from "@/lib/supabase";
import { enrichRowsWithMysqlWeightUnits } from "@/lib/fsnWeightUnit";

export function usePricingSheet(params: { city?: string; deliveryDate?: string; autoFetch?: boolean }) {
  const { city, deliveryDate, autoFetch = true } = params;
  const [rows, setRows] = useState<PricingSheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    let query = supabase.from("pricing_sheet").select("*").limit(5000)
      .order("fsn_id", { ascending: true, nullsFirst: false })
      .order("weight_unit", { ascending: true, nullsFirst: false });
    if (city) query = query.eq("city", city);
    if (deliveryDate) query = query.eq("delivery_date", deliveryDate);
    const { data, error } = await query;
    if (error) {
      setError(error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    let result = (data ?? []) as PricingSheetRow[];

    // Backfill pm_cost / fml_dump / pc from the most recent prior date when
    // the current row is missing any of them (matched on fsn_id + weight_unit).
    const needFsns = Array.from(
      new Set(
        result
          .filter((r) => r.pm_cost == null || r.fml_dump == null || r.pc == null)
          .map((r) => r.fsn_id)
          .filter((v): v is string => !!v),
      ),
    );
    if (needFsns.length && city && deliveryDate) {
      const { data: hist } = await supabase
        .from("pricing_sheet")
        .select("fsn_id,weight_unit,delivery_date,pm_cost,fml_dump,pc")
        .eq("city", city)
        .lt("delivery_date", deliveryDate)
        .in("fsn_id", needFsns)
        .order("delivery_date", { ascending: false })
        .limit(10000);
      if (hist && hist.length) {
        const latest: Record<
          string,
          { pm_cost: number | null; fml_dump: number | null; pc: number | null }
        > = {};
        for (const h of hist as Array<Pick<PricingSheetRow, "fsn_id" | "weight_unit" | "pm_cost" | "fml_dump" | "pc">>) {
          const key = `${h.fsn_id}||${h.weight_unit ?? ""}`;
          const cur = latest[key] ?? { pm_cost: null, fml_dump: null, pc: null };
          if (cur.pm_cost == null && h.pm_cost != null) cur.pm_cost = h.pm_cost;
          if (cur.fml_dump == null && h.fml_dump != null) cur.fml_dump = h.fml_dump;
          if (cur.pc == null && h.pc != null) cur.pc = h.pc;
          latest[key] = cur;
        }
        result = result.map((r) => {
          const key = `${r.fsn_id}||${r.weight_unit ?? ""}`;
          const l = latest[key];
          if (!l) return r;
          return {
            ...r,
            pm_cost: r.pm_cost ?? l.pm_cost,
            fml_dump: r.fml_dump ?? l.fml_dump,
            pc: r.pc ?? l.pc,
          };
        });
      }
    }

    // Weight Unit display source of truth: vormir/asgard MySQL (fallback: pricing_sheet).
    if (city) {
      result = (await enrichRowsWithMysqlWeightUnits(result, city)) as PricingSheetRow[];
    }

    setRows(result);
    setLoading(false);
  }, [city, deliveryDate]);


  useEffect(() => {
    if (!autoFetch) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await fetchRows();
    })();
    return () => { cancelled = true; };
  }, [fetchRows, autoFetch]);

  // Optimistic patch of a single row (by id or fsn_id+weight_unit) and persist to Supabase.
  // Prefer matching on the original Supabase weight_unit (`weight_unit_db`) when MySQL enrichment changed the display value.
  const updateRow = useCallback(
    async (
      match: { id?: string; fsn_id?: string; weight_unit?: string | null },
      patch: Partial<PricingSheetRow>,
    ) => {
      const rowMatchKey = (r: PricingSheetRow) => r.weight_unit_db ?? r.weight_unit ?? null;
      setRows((rs) =>
        rs.map((r) => {
          const hit =
            (match.id && r.id === match.id) ||
            (match.fsn_id &&
              r.fsn_id === match.fsn_id &&
              (match.weight_unit ?? null) === rowMatchKey(r));
          return hit ? { ...r, ...patch } : r;
        }),
      );
      let q = supabase.from("pricing_sheet").update(patch);
      if (match.id) q = q.eq("id", match.id);
      else {
        q = q.eq("fsn_id", match.fsn_id!);
        if (deliveryDate) q = q.eq("delivery_date", deliveryDate);
        if (city) q = q.eq("city", city);
        if (match.weight_unit !== undefined) q = q.eq("weight_unit", match.weight_unit as string);
      }
      const { data, error } = await q.select("*").maybeSingle();
      if (error) {
        setError(error.message);
        // No rollback — caller can call fetchRows() to reconcile.
        throw error;
      }
      const updated = data as PricingSheetRow | null;
      if (updated) {
        setRows((rs) =>
          rs.map((r) => {
            const hit =
              (match.id && r.id === match.id) ||
              (match.fsn_id &&
                r.fsn_id === match.fsn_id &&
                (match.weight_unit ?? null) === rowMatchKey(r));
            // Keep MySQL display weight_unit / weight_unit_db when merging RETURNING row.
            return hit
              ? {
                  ...updated,
                  weight_unit: r.weight_unit,
                  weight_unit_db: r.weight_unit_db ?? r.weight_unit,
                }
              : r;
          }),
        );
      }
      return updated;
    },
    [city, deliveryDate],
  );

  const upsertMany = useCallback(async (payload: Partial<PricingSheetRow>[]) => {
    if (payload.length === 0) return { inserted: 0 };
    const chunkSize = 500;
    let total = 0;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error, count } = await supabase
        .from("pricing_sheet")
        .upsert(chunk, { onConflict: "delivery_date,city,sku_id,weight_unit", count: "exact" });
      if (error) throw error;
      total += count ?? chunk.length;
    }
    await fetchRows();
    return { inserted: total };
  }, [fetchRows]);

  const submitSheet = useCallback(async () => {
    if (!city || !deliveryDate) throw new Error("City and delivery date required");
    const { error } = await supabase
      .from("pricing_sheet")
      .update({ submitted: true })
      .eq("city", city)
      .eq("delivery_date", deliveryDate);
    if (error) throw error;
    setRows((rs) => rs.map((r) => ({ ...r, submitted: true })));
  }, [city, deliveryDate]);

  return { rows, loading, error, refetch: fetchRows, updateRow, upsertMany, submitSheet };
}
