type Mixpanel = typeof import("mixpanel-browser").default;

let client: Mixpanel | null = null;
let initPromise: Promise<void> | null = null;
const queue: Array<{ event: string; properties?: Record<string, unknown> }> = [];
let pendingContext: Record<string, unknown> | null = null;

export async function initAnalytics() {
  if (typeof window === "undefined") return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const token = import.meta.env.VITE_MIXPANEL_TOKEN as string | undefined;
    if (!token) return;

    const mixpanel = (await import("mixpanel-browser")).default;
    mixpanel.init(token, {
      persistence: "localStorage",
      track_pageview: false,
      autocapture: false,
      debug: import.meta.env.DEV,
    });
    client = mixpanel;
    if (pendingContext) {
      client.register(pendingContext);
      pendingContext = null;
    }
    while (queue.length > 0) {
      const item = queue.shift()!;
      client.track(item.event, item.properties);
    }
  })();

  return initPromise;
}

export function track(event: string, properties?: Record<string, unknown>) {
  if (client) {
    client.track(event, properties);
    return;
  }
  queue.push({ event, properties });
  void initAnalytics();
}

export function setAnalyticsContext(properties: Record<string, unknown>) {
  if (client) {
    client.register(properties);
    return;
  }
  pendingContext = { ...pendingContext, ...properties };
  void initAnalytics();
}
