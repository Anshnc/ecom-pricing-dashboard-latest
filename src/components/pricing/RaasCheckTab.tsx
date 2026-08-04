import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, RefreshCw, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { downloadCSV, parseCSV, toCSV } from "@/lib/csv";

const CITIES = ["Bengaluru", "Chennai", "Coimbatore", "Hyderabad", "Mumbai", "Nashik", "Trichy"];
const PAGE_SIZE = 50;

const tomorrowISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Strip currency symbols / commas / whitespace and parse a price. Blank → null. */
export function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .trim()
    .replace(/^(rs\.?|inr|₹|\$)\s*/i, "")
    .replace(/\s*(rs\.?|inr|₹|\$)$/i, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (s === "" || s === "-" || s.toLowerCase() === "na" || s.toLowerCase() === "n/a") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

const FSN_ALIASES = new Set(["fsn id", "fsn", "fsn_id", "fsnid"]);
const PRICE_ALIASES = new Set([
  "final price",
  "raas final price",
  "raas price",
  "price",
  "final_price",
  "finalprice",
  "raas_final_price",
]);

function findColumn(headers: string[], aliases: Set<string>): string | null {
  for (const h of headers) {
    if (aliases.has(normalizeHeader(h))) return h;
  }
  return null;
}

/** Money equality to the nearest paise (2 decimal places). */
function pricesEqual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

type ToolSku = {
  fsnId: string;
  negotiatedPp: number | null;
  conflictInTool: boolean;
};

type RaasRow = {
  fsnId: string;
  finalPrice: number | null;
  rawPrice: string;
  duplicateInRaas: boolean;
  sourceIndex: number;
};

export type RaasCompareRow = {
  key: string;
  fsnId: string;
  negotiatedPp: number | null;
  raasFinalPrice: number | null;
  difference: number | null;
  status: "Match" | "Mismatch";
  issue: string | null;
  inTool: boolean;
  inRaas: boolean;
};

type StatusFilter = "all" | "match" | "mismatch";

function buildComparison(tool: ToolSku[], raas: RaasRow[]): RaasCompareRow[] {
  const toolByFsn = new Map(tool.map((t) => [t.fsnId, t]));
  const raasByFsn = new Map<string, RaasRow[]>();
  for (const r of raas) {
    const list = raasByFsn.get(r.fsnId) ?? [];
    list.push(r);
    raasByFsn.set(r.fsnId, list);
  }

  const allFsns = new Set<string>([...toolByFsn.keys(), ...raasByFsn.keys()]);
  const rows: RaasCompareRow[] = [];

  for (const fsnId of allFsns) {
    const t = toolByFsn.get(fsnId);
    const raasList = raasByFsn.get(fsnId);

    if (raasList && raasList.length > 0) {
      for (const r of raasList) {
        const issues: string[] = [];
        if (!t) issues.push("Not found in pricing sheet");
        if (r.duplicateInRaas) issues.push("Duplicate FSN in RAAS file");
        if (t?.conflictInTool) issues.push("Multiple Negotiated PP values in tool");
        if (t && r.finalPrice === null) issues.push("Blank RAAS price");
        if (t && t.negotiatedPp === null) issues.push("Blank Negotiated PP");

        const negotiatedPp = t?.negotiatedPp ?? null;
        const raasFinalPrice = r.finalPrice;
        const bothPresent = t != null;
        const equal = bothPresent && pricesEqual(negotiatedPp, raasFinalPrice);
        const status: "Match" | "Mismatch" = equal && issues.length === 0 ? "Match" : "Mismatch";
        const difference =
          negotiatedPp !== null && raasFinalPrice !== null
            ? raasFinalPrice - negotiatedPp
            : null;

        rows.push({
          key: `${fsnId}::raas-${r.sourceIndex}`,
          fsnId,
          negotiatedPp: t ? negotiatedPp : null,
          raasFinalPrice,
          difference,
          status,
          issue: issues.length ? issues.join("; ") : null,
          inTool: !!t,
          inRaas: true,
        });
      }
    } else if (t) {
      const issues = ["Not found in RAAS file"];
      if (t.conflictInTool) issues.push("Multiple Negotiated PP values in tool");
      if (t.negotiatedPp === null) issues.push("Blank Negotiated PP");
      rows.push({
        key: `${fsnId}::tool-only`,
        fsnId,
        negotiatedPp: t.negotiatedPp,
        raasFinalPrice: null,
        difference: null,
        status: "Mismatch",
        issue: issues.join("; "),
        inTool: true,
        inRaas: false,
      });
    }
  }

  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "Mismatch" ? -1 : 1;
    return a.fsnId.localeCompare(b.fsnId);
  });
  return rows;
}

function aggregateToolSkus(
  rows: { fsn_id: string | null; negotiated_pp: number | null }[],
): ToolSku[] {
  const map = new Map<string, { prices: (number | null)[] }>();
  for (const r of rows) {
    const fsn = (r.fsn_id ?? "").trim();
    if (!fsn) continue;
    const entry = map.get(fsn) ?? { prices: [] };
    entry.prices.push(r.negotiated_pp);
    map.set(fsn, entry);
  }
  const out: ToolSku[] = [];
  for (const [fsnId, { prices }] of map) {
    const nonNull = prices.filter((p): p is number => p !== null && p !== undefined);
    const unique = new Set(nonNull.map((p) => Math.round(p * 100)));
    const conflictInTool = unique.size > 1;
    const negotiatedPp =
      nonNull.length > 0 ? nonNull[0] : prices.length > 0 ? prices[0] : null;
    out.push({ fsnId, negotiatedPp, conflictInTool });
  }
  return out;
}

function parseRaasFile(text: string): { rows: RaasRow[]; error: string | null } {
  const parsed = parseCSV(text);
  if (parsed.length === 0) {
    return { rows: [], error: "The file is empty or has no data rows." };
  }
  const headers = Object.keys(parsed[0] ?? {});
  if (headers.length === 0) {
    return { rows: [], error: "Could not read column headers from the file." };
  }
  const fsnCol = findColumn(headers, FSN_ALIASES);
  const priceCol = findColumn(headers, PRICE_ALIASES);
  if (!fsnCol || !priceCol) {
    const missing = [
      !fsnCol ? "FSN ID (or FSN / fsn_id)" : null,
      !priceCol ? "Final Price (or RAAS Final Price / Price)" : null,
    ].filter(Boolean);
    return {
      rows: [],
      error: `Invalid RAAS file format. Missing required column(s): ${missing.join(", ")}. Found columns: ${headers.join(", ") || "(none)"}.`,
    };
  }

  const counts = new Map<string, number>();
  const draft: Omit<RaasRow, "duplicateInRaas">[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    const fsnId = (row[fsnCol] ?? "").trim();
    if (!fsnId) continue;
    const rawPrice = row[priceCol] ?? "";
    draft.push({
      fsnId,
      finalPrice: parsePrice(rawPrice),
      rawPrice: String(rawPrice).trim(),
      sourceIndex: i,
    });
    counts.set(fsnId, (counts.get(fsnId) ?? 0) + 1);
  }

  if (draft.length === 0) {
    return { rows: [], error: "No valid FSN ID rows found in the RAAS file." };
  }

  const rows: RaasRow[] = draft.map((r) => ({
    ...r,
    duplicateInRaas: (counts.get(r.fsnId) ?? 0) > 1,
  }));
  return { rows, error: null };
}

const fmtPrice = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `₹${n.toFixed(2)}`;

const fmtDiff = (n: number | null | undefined) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
};

export function RaasCheckTab({
  parentDate,
  parentCity,
}: {
  parentDate?: string;
  parentCity?: string;
}) {
  const [date, setDate] = useState(parentDate || tomorrowISO());
  const [city, setCity] = useState(parentCity || "Bengaluru");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [toolSkus, setToolSkus] = useState<ToolSku[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [compareRows, setCompareRows] = useState<RaasCompareRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** "stage" = drop-zone pick only; "process" = Upload button → run comparison */
  const pickModeRef = useRef<"stage" | "process">("stage");
  const toolSkusRef = useRef(toolSkus);
  toolSkusRef.current = toolSkus;

  const canSelect = !!date && !!city;
  const sheetReady = toolSkus !== null && toolSkus.length > 0;
  const sheetMissing = toolSkus !== null && toolSkus.length === 0 && !sheetLoading;

  const loadSheet = useCallback(async (d: string, c: string) => {
    if (!d || !c) {
      setToolSkus(null);
      return;
    }
    setSheetLoading(true);
    setSheetError(null);
    setToolSkus(null);
    setCompareRows(null);
    setFileName(null);
    setPendingFile(null);
    setUploadError(null);
    setStatusFilter("all");
    setPage(1);
    try {
      const { data, error } = await supabase
        .from("pricing_sheet")
        .select("fsn_id,negotiated_pp")
        .eq("city", c)
        .eq("delivery_date", d)
        .limit(5000);
      if (error) throw new Error(error.message);
      setToolSkus(aggregateToolSkus(data ?? []));
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "Failed to load pricing sheet");
      setToolSkus([]);
    } finally {
      setSheetLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canSelect) return;
    void loadSheet(date, city);
  }, [date, city, canSelect, loadSheet]);

  const onDateOrCityChange = (nextDate: string, nextCity: string) => {
    setDate(nextDate);
    setCity(nextCity);
  };

  const onFileSelected = async (file: File | null) => {
    const skus = toolSkusRef.current;
    if (!file) return;
    if (!skus || skus.length === 0) {
      setUploadError("No pricing sheet loaded. Select a valid delivery date and city first.");
      return;
    }
    setUploadError(null);
    // Replacing any previous comparison for this date/city — never merge.
    setCompareRows(null);
    setFileName(null);
    try {
      const text = await file.text();
      const { rows, error } = parseRaasFile(text);
      if (error) {
        setUploadError(error);
        setPendingFile(null);
        return;
      }
      setPendingFile(null);
      setFileName(file.name);
      setCompareRows(buildComparison(skus, rows));
      setStatusFilter("all");
      setPage(1);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Failed to read the uploaded file.");
      setPendingFile(null);
    }
  };

  const stageFile = (file: File | null) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && file.type !== "text/csv" && file.type !== "application/vnd.ms-excel") {
      setUploadError("Please select a CSV format file.");
      return;
    }
    setUploadError(null);
    setPendingFile(file);
  };

  const openPicker = (mode: "stage" | "process") => {
    pickModeRef.current = mode;
    fileInputRef.current?.click();
  };

  const onUploadClick = () => {
    if (pendingFile) {
      void onFileSelected(pendingFile);
      return;
    }
    openPicker("process");
  };

  const onDownloadSample = () => {
    const csv = toCSV(
      [
        { "FSN ID": "FFWFX4NYFXEXAMPLE1", "Final Price": "120.50" },
        { "FSN ID": "FFWFX4NYFXEXAMPLE2", "Final Price": "85" },
      ],
      ["FSN ID", "Final Price"],
    );
    downloadCSV("RAAS_Sample.csv", csv);
  };

  const clearUpload = () => {
    setCompareRows(null);
    setFileName(null);
    setPendingFile(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const filtered = useMemo(() => {
    if (!compareRows) return [];
    if (statusFilter === "match") return compareRows.filter((r) => r.status === "Match");
    if (statusFilter === "mismatch") return compareRows.filter((r) => r.status === "Mismatch");
    return compareRows;
  }, [compareRows, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const counts = useMemo(() => {
    if (!compareRows) return { all: 0, match: 0, mismatch: 0 };
    let match = 0;
    let mismatch = 0;
    for (const r of compareRows) {
      if (r.status === "Match") match++;
      else mismatch++;
    }
    return { all: compareRows.length, match, mismatch };
  }, [compareRows]);

  const onDownload = () => {
    if (filtered.length === 0) return;
    const csv = toCSV(
      filtered.map((r) => ({
        "FSN ID": r.fsnId,
        "Negotiated PP": r.inTool ? (r.negotiatedPp ?? "") : "Not Found",
        "RAAS Final Price": r.inRaas ? (r.raasFinalPrice ?? "") : "Not Found",
        Difference: r.difference ?? "",
        "Mismatch Status": r.status,
        Issue: r.issue ?? "",
      })),
      ["FSN ID", "Negotiated PP", "RAAS Final Price", "Difference", "Mismatch Status", "Issue"],
    );
    const filterSuffix =
      statusFilter === "mismatch" ? "_Mismatch" : statusFilter === "match" ? "_Match" : "_All";
    downloadCSV(`RAAS_Check_${date}_${city}${filterSuffix}.csv`, csv);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Delivery date
          </label>
          <input
            type="date"
            value={date}
            max={tomorrowISO()}
            onChange={(e) => onDateOrCityChange(e.target.value, city)}
            className="h-8 rounded-md border border-input bg-card px-2 text-[12px] outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            City
          </label>
          <select
            value={city}
            onChange={(e) => onDateOrCityChange(date, e.target.value)}
            className="h-8 rounded-md border border-input bg-card px-2 text-[12px] outline-none focus:border-primary"
          >
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void loadSheet(date, city)}
          disabled={!canSelect || sheetLoading}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${sheetLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {sheetLoading && (
        <div className="mb-3 rounded-md border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
          Looking up pricing sheet for {city} · {date}…
        </div>
      )}

      {sheetError && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{sheetError}</span>
        </div>
      )}

      {sheetMissing && !sheetError && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-amber-900">
            No pricing data found for this date/city
          </p>
          <p className="mt-1 text-[12px] text-amber-800/80">
            Create or fetch a pricing sheet in Price Upload for {city} on {date} before running a RAAS check.
          </p>
        </div>
      )}

      {sheetReady && (
        <div className="mb-3 rounded-lg border bg-card p-6 shadow-sm">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              const mode = pickModeRef.current;
              pickModeRef.current = "stage";
              e.target.value = "";
              if (!file) return;
              if (mode === "process") {
                void onFileSelected(file);
              } else {
                stageFile(file);
              }
            }}
          />
          <button
            type="button"
            onClick={() => openPicker("stage")}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              stageFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-primary/50"
            }`}
          >
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-sky-100 text-sky-600">
              <Upload className="h-6 w-6" />
            </span>
            <p className="text-[14px] text-muted-foreground">Please upload RAAS file in CSV format</p>
            <p className="mt-2 text-[15px] font-medium text-primary">
              Please select a file or drag and drop here
            </p>
          </button>

          {(pendingFile || fileName) && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <span className="truncate text-[12px] text-foreground">
                {pendingFile?.name ?? fileName}
                {pendingFile ? (
                  <span className="ml-2 text-muted-foreground">(ready to upload)</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={clearUpload}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground"
                title="Clear file"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onDownloadSample}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-4 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              <Download className="h-4 w-4" />
              Download Sample
            </button>
            <button
              type="button"
              onClick={onUploadClick}
              className="inline-flex h-9 min-w-[7.5rem] items-center justify-center gap-2 rounded-md bg-primary px-5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
            >
              Upload
            </button>
          </div>
        </div>
      )}

      {uploadError && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {compareRows && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Filter
              </span>
              {(
                [
                  { key: "all" as const, label: `All (${counts.all})` },
                  { key: "mismatch" as const, label: `Mismatch (${counts.mismatch})` },
                  { key: "match" as const, label: `Match (${counts.match})` },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStatusFilter(opt.key)}
                  className={`inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-medium ring-1 ${
                    statusFilter === opt.key
                      ? opt.key === "mismatch"
                        ? "bg-red-50 text-red-800 ring-red-300"
                        : opt.key === "match"
                          ? "bg-green-50 text-green-800 ring-green-300"
                          : "bg-primary/10 text-primary ring-primary/30"
                      : "bg-card text-muted-foreground ring-border hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onDownload}
              disabled={filtered.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </button>
          </div>

          <div className="overflow-auto rounded-md border bg-card max-h-[calc(100vh-16rem)]">
            <table className="w-full min-w-[720px] border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 bg-muted text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="border-b px-3 py-2 text-left">FSN ID</th>
                  <th className="border-b px-3 py-2 text-right">Negotiated PP</th>
                  <th className="border-b px-3 py-2 text-right">RAAS Final Price</th>
                  <th className="border-b px-3 py-2 text-right">Difference</th>
                  <th className="border-b px-3 py-2 text-left">Mismatch Status</th>
                  <th className="border-b px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No rows match this filter.
                    </td>
                  </tr>
                ) : (
                  paged.map((r) => (
                    <tr
                      key={r.key}
                      className={`border-b last:border-b-0 hover:bg-muted/40 ${
                        r.status === "Mismatch" ? "bg-red-50/40" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-[11px]">{r.fsnId}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.inTool ? fmtPrice(r.negotiatedPp) : (
                          <span className="text-muted-foreground">Not Found</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.inRaas ? fmtPrice(r.raasFinalPrice) : (
                          <span className="text-muted-foreground">Not Found</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          r.difference !== null && r.difference !== 0
                            ? r.difference > 0
                              ? "text-amber-700"
                              : "text-sky-700"
                            : ""
                        }`}
                      >
                        {fmtDiff(r.difference)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                            r.status === "Match"
                              ? "bg-green-50 text-green-800 ring-green-200"
                              : "bg-red-50 text-red-800 ring-red-200"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="max-w-[280px] px-3 py-2 text-[11px] text-muted-foreground">
                        {r.issue ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
                {filtered.length !== counts.all ? ` (filtered from ${counts.all})` : ""} · {PAGE_SIZE} per page
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <span className="min-w-[5.5rem] text-center text-[11px] tabular-nums text-muted-foreground">
                  Page {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
