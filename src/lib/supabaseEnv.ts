/** Extract a valid Supabase project URL from env (guards against Vite path-resolution bugs). */
function normalizeSupabaseUrl(raw: string | undefined): string {
  if (!raw?.trim()) return "";
  const value = raw.trim();
  const embedded = value.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i);
  if (embedded) return embedded[0]!;
  if (value.startsWith("https://") || value.startsWith("http://")) return value;
  return "";
}

function normalizeKey(raw: string | undefined): string {
  return raw?.trim() ?? "";
}

export function getSupabaseUrl(): string {
  // Static import.meta.env access so Vite inlines values at build time (dynamic keys are not replaced).
  const fromVite = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
  if (fromVite) return fromVite;

  const fromProcess = normalizeSupabaseUrl(
    process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL,
  );
  if (fromProcess) return fromProcess;

  return "";
}

export function getSupabasePublishableKey(): string {
  const fromVite = normalizeKey(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (fromVite) return fromVite;

  const fromProcess = normalizeKey(
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.SUPABASE_ANON_KEY,
  );
  if (fromProcess) return fromProcess;

  return "";
}
