function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const viteName = `VITE_${name}`;
    const fromImportMeta =
      typeof import.meta !== "undefined"
        ? ((import.meta.env as Record<string, string | undefined>)[viteName] ??
          (import.meta.env as Record<string, string | undefined>)[name])
        : undefined;
    if (fromImportMeta?.trim()) return fromImportMeta.trim();

    const fromProcess = process.env[viteName] ?? process.env[name];
    if (fromProcess?.trim()) return fromProcess.trim();
  }
  return undefined;
}

export function getSupabaseUrl(): string {
  return readEnv("SUPABASE_URL") ?? "";
}

export function getSupabasePublishableKey(): string {
  return readEnv("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY") ?? "";
}
