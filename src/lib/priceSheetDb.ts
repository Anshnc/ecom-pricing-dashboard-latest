import { loadDemandForPricingSheet } from "@/lib/demandSheet";
import { applySkuCostComponents } from "@/lib/skuCostComponents";
import { addDaysISO } from "@/lib/pricingSheetCache";
import {
  supabase,
  type PriceSheetDetailRow,
  type PriceSheetHeader,
  type PriceSheetStatus,
  type PricingSheetRow,
} from "@/lib/supabase";

/** Columns populated from the MySQL demand / GRN query for a new sheet date. */
const MYSQL_FRESH_COLUMNS = new Set([
  "fsn_id",
  "sku_id",
  "sku_name",
  "weight_unit",
  "cf",
  "bucket",
  "subcategory",
  "demand_units",
  "demand_pct",
  "grn_price_per_kg",
  "grn_price_per_unit",
  "prev_grn_price_per_kg",
  "prev_grn_price_per_unit",
  "t3_grn_price_per_kg",
  "t3_grn_price_per_unit",
] as const);

/** Only Quoted PP and Negotiated PP are copied from the prior day's sheet (matched on fsn_id + weight_unit). */
const CARRY_FORWARD_COLUMNS: (keyof PriceSheetDetailRow)[] = [
  "quoted_pp",
  "negotiated_pp",
];

function detailLineKey(fsnId: string | null | undefined, weightUnit: string | null | undefined) {
  return `${fsnId ?? ""}||${weightUnit ?? ""}`;
}

/** Quoted NLC from a detail row (stored nlc or quoted_pp + cost components). */
function quotedNlcFromDetailRow(d: Pick<PriceSheetDetailRow, "nlc" | "quoted_pp" | "pm_cost" | "fml_dump" | "pc">): number | null {
  if (d.nlc != null && d.nlc !== 0) return d.nlc;
  if (d.quoted_pp == null) return null;
  return d.quoted_pp + (d.pm_cost ?? 0) + (d.fml_dump ?? 0) + (d.pc ?? 0);
}

export type PriorNlcLookup = {
  byLineKey: Map<string, number>;
  byFsn: Map<string, number>;
};

/**
 * Most recent prior quoted NLC per (fsn + weight_unit) and per fsn (any weight unit).
 * Scans all sheets before deliveryDate — not only calendar yesterday.
 */
export async function fetchPriorNlcLookup(city: string, deliveryDate: string): Promise<PriorNlcLookup> {
  const empty = { byLineKey: new Map<string, number>(), byFsn: new Map<string, number>() };

  const { data: headers, error: headerErr } = await supabase
    .from("price_sheet")
    .select("price_sheet_id, delivery_date")
    .eq("city", city)
    .lt("delivery_date", deliveryDate)
    .order("delivery_date", { ascending: false });
  if (headerErr || !headers?.length) return empty;

  const dateBySheet = new Map(headers.map((h) => [h.price_sheet_id, h.delivery_date as string]));
  const sheetIds = headers.map((h) => h.price_sheet_id);

  const { data: details, error: detailErr } = await supabase
    .from("price_sheet_details")
    .select("fsn_id, weight_unit, quoted_pp, nlc, pm_cost, fml_dump, pc, price_sheet_id")
    .in("price_sheet_id", sheetIds)
    .limit(20000);
  if (detailErr || !details?.length) return empty;

  const sorted = [...details].sort((a, b) => {
    const da = dateBySheet.get(a.price_sheet_id!) ?? "";
    const db = dateBySheet.get(b.price_sheet_id!) ?? "";
    return db.localeCompare(da);
  });

  const byLineKey = new Map<string, number>();
  const byFsn = new Map<string, number>();

  for (const d of sorted) {
    const nlc = quotedNlcFromDetailRow(d as PriceSheetDetailRow);
    if (nlc == null || nlc === 0) continue;
    const fsn = String(d.fsn_id ?? "").trim();
    if (!fsn) continue;
    const lineKey = detailLineKey(fsn, d.weight_unit);
    if (!byLineKey.has(lineKey)) byLineKey.set(lineKey, nlc);
    if (!byFsn.has(fsn)) byFsn.set(fsn, nlc);
  }

  return { byLineKey, byFsn };
}

function resolvePrevDayNlc(
  fsnId: string | null | undefined,
  weightUnitDb: string | null | undefined,
  weightUnit: string | null | undefined,
  lookup: PriorNlcLookup,
): number | null {
  const fsn = String(fsnId ?? "").trim();
  if (!fsn) return null;

  for (const wu of [weightUnitDb, weightUnit]) {
    if (!wu) continue;
    const hit = lookup.byLineKey.get(detailLineKey(fsn, wu));
    if (hit != null) return hit;
  }

  return lookup.byFsn.get(fsn) ?? null;
}

export function mergeHeaderAndDetails(
  header: PriceSheetHeader,
  details: PriceSheetDetailRow[],
): PricingSheetRow[] {
  return details.map((d) => ({
    ...d,
    id: d.price_sheet_details_id ?? d.id,
    delivery_date: header.delivery_date,
    city: header.city,
    city_id: header.city_id,
    submitted:
      d.submitted ??
      (header.status === "Submitted for Approval" || header.status === "Approved"),
  }));
}

export async function fetchPriceSheetHeader(
  city: string,
  deliveryDate: string,
): Promise<PriceSheetHeader | null> {
  const { data, error } = await supabase
    .from("price_sheet")
    .select("*")
    .eq("city", city)
    .eq("delivery_date", deliveryDate)
    .maybeSingle();
  if (error) throw error;
  return (data as PriceSheetHeader) ?? null;
}

export async function fetchPriceSheetDetails(priceSheetId: string): Promise<PriceSheetDetailRow[]> {
  const { data, error } = await supabase
    .from("price_sheet_details")
    .select("*")
    .eq("price_sheet_id", priceSheetId)
    .order("fsn_id", { ascending: true, nullsFirst: false })
    .order("weight_unit", { ascending: true, nullsFirst: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as PriceSheetDetailRow[];
}

export async function priceSheetHeaderExists(city: string, deliveryDate: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("price_sheet")
    .select("price_sheet_id", { count: "exact", head: true })
    .eq("city", city)
    .eq("delivery_date", deliveryDate);
  return !error && (count ?? 0) > 0;
}

export async function fetchExistingPriceSheetDates(
  city: string,
  dates: string[],
): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabase
    .from("price_sheet")
    .select("delivery_date")
    .eq("city", city)
    .in("delivery_date", dates);
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.delivery_date as string));
}

async function fetchPreviousDayDetails(city: string, deliveryDate: string): Promise<PriceSheetDetailRow[]> {
  const prevDate = addDaysISO(deliveryDate, -1);
  const prevHeader = await fetchPriceSheetHeader(city, prevDate);
  if (!prevHeader) return [];
  const { data, error } = await supabase
    .from("price_sheet_details")
    .select("fsn_id,weight_unit,quoted_pp,negotiated_pp,nlc,pm_cost,fml_dump,pc")
    .eq("price_sheet_id", prevHeader.price_sheet_id)
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as PriceSheetDetailRow[];
}

/** Attach most recent prior quoted NLC for client-side deflection. */
export async function enrichRowsWithPreviousDayNlc<T extends PricingSheetRow>(
  rows: T[],
  city: string,
  deliveryDate: string,
): Promise<(T & { prev_day_nlc?: number | null })[]> {
  if (rows.length === 0) return rows;
  const lookup = await fetchPriorNlcLookup(city, deliveryDate);
  if (lookup.byLineKey.size === 0 && lookup.byFsn.size === 0) return rows;

  return rows.map((r) => ({
    ...r,
    prev_day_nlc: resolvePrevDayNlc(r.fsn_id, r.weight_unit_db, r.weight_unit, lookup),
  }));
}

function buildDetailFromMysqlAndPrev(
  mysqlRow: Partial<PricingSheetRow>,
  prev: PriceSheetDetailRow | undefined,
  priceSheetId: string,
): Partial<PriceSheetDetailRow> {
  const detail: Partial<PriceSheetDetailRow> = {
    price_sheet_id: priceSheetId,
    fsn_id: mysqlRow.fsn_id ?? null,
    weight_unit: mysqlRow.weight_unit ?? null,
    sku_id: mysqlRow.sku_id ?? null,
    sku_name: mysqlRow.sku_name ?? null,
    cf: mysqlRow.cf ?? null,
    bucket: mysqlRow.bucket ?? null,
    subcategory: mysqlRow.subcategory ?? null,
    demand_units: mysqlRow.demand_units ?? null,
    demand_pct: mysqlRow.demand_pct ?? null,
    grn_price_per_kg: mysqlRow.grn_price_per_kg ?? null,
    grn_price_per_unit: mysqlRow.grn_price_per_unit ?? null,
    prev_grn_price_per_kg: mysqlRow.prev_grn_price_per_kg ?? null,
    prev_grn_price_per_unit: mysqlRow.prev_grn_price_per_unit ?? null,
    t3_grn_price_per_kg: mysqlRow.t3_grn_price_per_kg ?? null,
    t3_grn_price_per_unit: mysqlRow.t3_grn_price_per_unit ?? null,
  };

  if (prev) {
    for (const col of CARRY_FORWARD_COLUMNS) {
      const v = prev[col];
      if (v !== undefined && v !== null) {
        (detail as Record<string, unknown>)[col] = v;
      }
    }
  }

  // Ensure mysql fresh columns are never overwritten by carry-forward.
  for (const col of MYSQL_FRESH_COLUMNS) {
    const v = mysqlRow[col as keyof PricingSheetRow];
    if (v !== undefined) {
      (detail as Record<string, unknown>)[col] = v;
    }
  }

  return detail;
}

async function insertDetailsInChunks(rows: Partial<PriceSheetDetailRow>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const chunkSize = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from("price_sheet_details")
      .insert(chunk)
      .select("price_sheet_details_id", { count: "exact" });
    if (error) throw error;
    total += count ?? chunk.length;
  }
  return total;
}

export type LoadPriceSheetResult = {
  header: PriceSheetHeader;
  rows: PricingSheetRow[];
  created: boolean;
};

/**
 * Fetch an existing sheet or create a new one from MySQL demand + prior-day carry-forward.
 */
export async function loadOrCreatePriceSheet(
  city: string,
  deliveryDate: string,
  options?: { createIfMissing?: boolean },
): Promise<LoadPriceSheetResult | null> {
  const createIfMissing = options?.createIfMissing ?? true;

  const existing = await fetchPriceSheetHeader(city, deliveryDate);
  if (existing) {
    const details = await fetchPriceSheetDetails(existing.price_sheet_id);
    let rows = mergeHeaderAndDetails(existing, details);
    rows = await applySkuCostComponents(rows);
    rows = await enrichRowsWithPreviousDayNlc(rows, city, deliveryDate);
    return {
      header: existing,
      rows,
      created: false,
    };
  }

  if (!createIfMissing) return null;

  const mysqlRows = await loadDemandForPricingSheet(deliveryDate, city);
  if (mysqlRows.length === 0) {
    throw new Error("No demand data found for this date and city");
  }

  const cityId = mysqlRows.find((r) => r.city_id != null)?.city_id ?? null;

  const { data: header, error: headerErr } = await supabase
    .from("price_sheet")
    .insert({
      delivery_date: deliveryDate,
      city,
      city_id: cityId,
      status: "Created",
    })
    .select("*")
    .single();
  if (headerErr) throw headerErr;

  const prevDetails = await fetchPreviousDayDetails(city, deliveryDate);
  const prevMap = new Map(
    prevDetails.map((d) => [detailLineKey(d.fsn_id, d.weight_unit), d]),
  );

  const detailPayload = mysqlRows
    .filter((r) => r.sku_id)
    .map((mysqlRow) => {
      const prev = prevMap.get(detailLineKey(mysqlRow.fsn_id, mysqlRow.weight_unit));
      return buildDetailFromMysqlAndPrev(mysqlRow, prev, header.price_sheet_id);
    });

  const enrichedPayload = await applySkuCostComponents(detailPayload);
  await insertDetailsInChunks(enrichedPayload);

  const details = await fetchPriceSheetDetails(header.price_sheet_id);
  let rows = mergeHeaderAndDetails(header as PriceSheetHeader, details);
  rows = await applySkuCostComponents(rows);
  rows = await enrichRowsWithPreviousDayNlc(rows, city, deliveryDate);
  return {
    header: header as PriceSheetHeader,
    rows,
    created: true,
  };
}

export async function updatePriceSheetDetail(
  priceSheetId: string,
  match: { price_sheet_details_id?: string; id?: string; fsn_id?: string; weight_unit?: string | null },
  patch: Partial<PriceSheetDetailRow>,
): Promise<PriceSheetDetailRow | null> {
  const detailId = match.price_sheet_details_id ?? match.id;
  let q = supabase.from("price_sheet_details").update(patch);
  if (detailId) q = q.eq("price_sheet_details_id", detailId);
  else {
    q = q.eq("price_sheet_id", priceSheetId).eq("fsn_id", match.fsn_id!);
    if (match.weight_unit !== undefined) q = q.eq("weight_unit", match.weight_unit as string);
  }
  const { data, error } = await q.select("*").maybeSingle();
  if (error) throw error;
  return (data as PriceSheetDetailRow) ?? null;
}

export async function submitPriceSheet(city: string, deliveryDate: string): Promise<PriceSheetHeader> {
  const header = await fetchPriceSheetHeader(city, deliveryDate);
  if (!header) throw new Error("Price sheet not found");

  const { data, error } = await supabase
    .from("price_sheet")
    .update({ status: "Submitted for Approval" })
    .eq("price_sheet_id", header.price_sheet_id)
    .select("*")
    .single();
  if (error) throw error;

  await supabase
    .from("price_sheet_details")
    .update({ submitted: true })
    .eq("price_sheet_id", header.price_sheet_id);

  return data as PriceSheetHeader;
}

export async function upsertPriceSheetDetails(
  priceSheetId: string,
  payload: Partial<PriceSheetDetailRow>[],
): Promise<number> {
  if (payload.length === 0) return 0;
  const withSheet = payload.map((p) => ({ ...p, price_sheet_id: priceSheetId }));
  const chunkSize = 500;
  let total = 0;
  for (let i = 0; i < withSheet.length; i += chunkSize) {
    const chunk = withSheet.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from("price_sheet_details")
      .upsert(chunk, { onConflict: "price_sheet_id,sku_id,weight_unit", count: "exact" });
    if (error) throw error;
    total += count ?? chunk.length;
  }
  return total;
}

export function headerStatusToUiStatus(
  status: PriceSheetStatus,
): "created" | "pending" | "approved" {
  switch (status) {
    case "Submitted for Approval":
      return "pending";
    case "Approved":
      return "approved";
    default:
      return "created";
  }
}
