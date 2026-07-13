import { useEffect, useState } from "react";
import { supabase, DEFAULT_GUARDRAILS, type GuardrailRow } from "@/lib/supabase";

export function useGuardrails(city: string) {
  const [value, setValue] = useState<GuardrailRow>({ ...DEFAULT_GUARDRAILS, city });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("guardrails")
        .select("city, pi_min, pi_max, gm_target, deflection_target, updated_at")
        .eq("city", city)
        .maybeSingle();
      if (cancelled) return;
      if (error && error.code !== "PGRST116") {
        setError(error.message);
        setValue({ ...DEFAULT_GUARDRAILS, city });
      } else if (data) {
        setValue({ ...DEFAULT_GUARDRAILS, ...(data as Partial<GuardrailRow>), city });
      } else {
        setValue({ ...DEFAULT_GUARDRAILS, city });
      }
      setLoading(false);
    }
    run();
    return () => { cancelled = true; };
  }, [city]);

  const save = async (patch: Partial<GuardrailRow>) => {
    const next: GuardrailRow = { ...value, ...patch, city };
    const { error } = await supabase
      .from("guardrails")
      .upsert(
        {
          city: next.city,
          pi_min: next.pi_min,
          pi_max: next.pi_max,
          gm_target: next.gm_target,
          deflection_target: next.deflection_target,
        },
        { onConflict: "city" },
      );
    if (error) throw error;
    setValue(next);
    return next;
  };

  return { guardrails: value, loading, error, save, setLocal: setValue };
}
