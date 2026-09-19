type Mixpanel = typeof import("mixpanel-browser").default;

function getMixpanelToken(): string {
  const fromVite = (import.meta.env.VITE_MIXPANEL_TOKEN as string | undefined)?.trim() ?? "";
  if (fromVite) return fromVite;
  return (process.env.VITE_MIXPANEL_TOKEN ?? "").trim();
}

function getMixpanelApiHost(): string {
  const fromVite = (import.meta.env.VITE_MIXPANEL_API_HOST as string | undefined)?.trim();
  if (fromVite) return fromVite;
  const fromProcess = (process.env.VITE_MIXPANEL_API_HOST ?? "").trim();
  return fromProcess || "https://api-eu.mixpanel.com";
}

export const AnalyticsEvent = {
  MixpanelReady: "Mixpanel Ready",
  DashboardViewed: "Dashboard Viewed",
  TabChanged: "Tab Changed",
  SheetLoaded: "Sheet Loaded",
  SheetLoadFailed: "Sheet Load Failed",
  BulkUploadOpened: "Bulk Upload Opened",
  BulkUploadStarted: "Bulk Upload Started",
  BulkUploadCompleted: "Bulk Upload Completed",
  PriceConfirmed: "Price Confirmed",
  FkSheetDownloaded: "FK Sheet Downloaded",
  ViolationFilterApplied: "Violation Filter Applied",
  SubcategoryFilterApplied: "Subcategory Filter Applied",
  DemandUploaded: "Demand Uploaded",
  SkuCostsUploaded: "SKU Costs Uploaded",
  GuardrailsSaved: "Guardrails Saved",
  RaasCheckCompleted: "RAAS Check Completed",
  SheetApproved: "Sheet Approved",
  SheetRejected: "Sheet Rejected",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

const DISTINCT_ID_KEY = "mp_ecom_distinct_id";

let client: Mixpanel | null = null;
let initPromise: Promise<void> | null = null;
const queue: Array<{ event: AnalyticsEventName; properties?: Record<string, unknown> }> = [];
let pendingContext: Record<string, string | number | boolean> | null = null;

function distinctId(): string {
  try {
    const existing = window.localStorage.getItem(DISTINCT_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(DISTINCT_ID_KEY, id);
    return id;
  } catch {
    return "anonymous";
  }
}

/** Mixpanel HTTP track via GET image — works even when XHR/batching is blocked. */
function sendViaHttp(event: string, properties?: Record<string, unknown>) {
  const token = getMixpanelToken();
  const host = getMixpanelApiHost().replace(/\/$/, "");
  if (!token || typeof window === "undefined") return;

  const payload = {
    event,
    properties: {
      token,
      distinct_id: distinctId(),
      time: Math.floor(Date.now() / 1000),
      $insert_id: crypto.randomUUID(),
      ...pendingContext,
      ...properties,
    },
  };

  const data = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = `${host}/track/?ip=1&data=${encodeURIComponent(data)}`;
  try {
    navigator.sendBeacon?.(url);
  } catch {
    /* ignore */
  }
  const img = new Image();
  img.src = url;
}

export async function initAnalytics() {
  if (typeof window === "undefined") return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const token = getMixpanelToken();
    if (!token) {
      console.warn("[analytics] VITE_MIXPANEL_TOKEN is missing. Restart `bun run dev` after saving .env.");
      return;
    }

    const apiHost = getMixpanelApiHost();
    const mixpanel = (await import("mixpanel-browser")).default;
    mixpanel.init(token, {
      persistence: "localStorage",
      track_pageview: false,
      autocapture: false,
      ignore_dnt: true,
      debug: true,
      api_host: apiHost,
      batch_requests: false,
    });
    client = mixpanel;
    mixpanel.identify(distinctId());
    console.info(`[analytics] Mixpanel initialized (token …${token.slice(-4)}, host ${apiHost})`);
    try {
      if (pendingContext) {
        client.register(pendingContext);
      }
    } catch (e) {
      console.warn("[analytics] Mixpanel register failed:", e);
    }
    while (queue.length > 0) {
      const item = queue.shift()!;
      client.track(item.event, item.properties);
      sendViaHttp(item.event, item.properties);
    }
    client.track(AnalyticsEvent.MixpanelReady, { source: "app" });
    sendViaHttp(AnalyticsEvent.MixpanelReady, { source: "app" });
  })();

  return initPromise;
}

export function track(event: AnalyticsEventName, properties?: Record<string, unknown>) {
  sendViaHttp(event, properties);
  if (client) {
    client.track(event, properties);
    return;
  }
  queue.push({ event, properties });
  void initAnalytics();
}

export function setAnalyticsContext(properties: Record<string, string | number | boolean>) {
  pendingContext = { ...pendingContext, ...properties };
  if (client) {
    client.register(properties);
    return;
  }
  void initAnalytics();
}
