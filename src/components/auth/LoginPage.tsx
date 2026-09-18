import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isAuthenticated, login } from "@/lib/auth";

export function LoginPage({ onSuccess }: { onSuccess?: () => void } = {}) {
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const finish = () => {
    if (onSuccess) {
      onSuccess();
      return;
    }
    void navigate({ to: "/", replace: true });
  };

  useEffect(() => {
    if (isAuthenticated()) finish();
    // Only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const ok = login(id, password);
    setSubmitting(false);
    if (!ok) {
      setError("Invalid ID or password.");
      return;
    }
    finish();
  };

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-[44%] flex-col justify-between bg-sidebar px-10 py-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary text-base font-bold text-primary-foreground">
            B
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Bifrost 2.0</div>
            <div className="text-[12px] text-sidebar-foreground/70">Pricing Console</div>
          </div>
        </div>
        <div>
          <h1 className="max-w-sm text-3xl font-semibold tracking-tight text-white">
            Ecom Pricing
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-sidebar-foreground/70">
            Sign in to upload, lock, and approve daily F&amp;V prices.
          </p>
        </div>
        <p className="text-[11px] text-sidebar-foreground/50">Internal · Quick Commerce</p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              B
            </div>
            <div>
              <div className="text-sm font-semibold">Bifrost 2.0</div>
              <div className="text-[12px] text-muted-foreground">Ecom Pricing</div>
            </div>
          </div>

          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use your pricing console credentials.</p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="login-id">ID</Label>
              <Input
                id="login-id"
                name="username"
                autoComplete="username"
                value={id}
                onChange={(e) => setId(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <div className="relative">
                <Input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              Sign in
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
