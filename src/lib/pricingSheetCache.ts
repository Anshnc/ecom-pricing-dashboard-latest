import { loadDemandForPricingSheet } from "@/lib/demandSheet";
import { supabase, type PricingSheetRow } from "@/lib/supabase";

/** Rolling window: pricing sheets within this many days ago are served from Supabase cache. */
export const PRICING_SHEET_CACHE_DAYS = 7;

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Whole days between deliveryDate and today (positive = past, negative = future). */
export function daysBeforeToday(deliveryDate: string): number {
  const today = todayISO();
  const t = new Date(`${today}T12:00:00`).getTime();
  const d = new Date(`${deliveryDate}T12:00:00`).getTime();
  return Math.round((t - d) / 86_400_000);
}

export function isWithinPricingSheetCacheWindow(deliveryDate: string): boolean {
  const days = daysBeforeToday(deliveryDate);
  return days >= 0 && days <= PRICING_SHEET_CACHE_DAYS;
}

/** Dates from today back through the cache window (today, yesterday, …). */
export function getPricingSheetCacheWindowDates(): string[] {
  const today = todayISO();
  const dates: string[] = [];
  for (let i = 0; i <= PRICING_SHEET_CACHE_DAYS; i++) {
    dates.push(addDaysISO(today, -i));
  }
  return dates;
}

export async function pricingSheetExists(city: string, deliveryDate: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("pricing_sheet")
    .select("id", { count: "exact", head: true })
    .eq("city", city)
    .eq("delivery_date", deliveryDate);
  return !error && (count ?? 0) > 0;
}

export async function pricingSheetExistingDates(
  city: string,
  dates: string[],
): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabase
    .from("pricing_sheet")
    .select("delivery_date")
    .eq("city", city)
    .in("delivery_date", dates);
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.delivery_date as string));
}

async function upsertDemandRows(payload: Partial<PricingSheetRow>[]): Promise<number> {
  if (payload.length === 0) return 0;
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
  return total;
}

export type PricingSheetLoadResult =
  | { source: "cache" }
  | { source: "demand"; rowCount: number };

/**
 * Load demand for a pricing sheet, using Supabase as a 7-day cache when possible.
 * Dates older than the cache window always hit MySQL.
 */
export async function loadPricingSheetDemand(
  deliveryDate: string,
  city: string,
): Promise<PricingSheetLoadResult> {
  const inWindow = isWithinPricingSheetCacheWindow(deliveryDate);

  if (inWindow) {
    const exists = await pricingSheetExists(city, deliveryDate);
    if (exists) {
      void prefetchMissingPricingSheetDates(city, deliveryDate);
      return { source: "cache" };
    }
  }

  const demandRows = await loadDemandForPricingSheet(deliveryDate, city);
  if (demandRows.length === 0) {
    return { source: "demand", rowCount: 0 };
  }

  const inserted = await upsertDemandRows(demandRows);

  if (inWindow) {
    void prefetchMissingPricingSheetDates(city, deliveryDate);
  }

  return { source: "demand", rowCount: inserted };
}

/** Background: fetch and store demand for other cache-window dates missing from Supabase. */
export async function prefetchMissingPricingSheetDates(
  city: string,
  skipDate?: string,
): Promise<void> {
  const windowDates = getPricingSheetCacheWindowDates().filter((d) => d !== skipDate);
  const existing = await pricingSheetExistingDates(city, windowDates);
  const missing = windowDates.filter((d) => !existing.has(d));

  for (const date of missing) {
    try {
      const rows = await loadDemandForPricingSheet(date, city);
      if (rows.length > 0) {
        await upsertDemandRows(rows);
      }
    } catch (e) {
      console.warn(`Background pricing sheet prefetch failed for ${city} ${date}:`, e);
    }
  }
}
