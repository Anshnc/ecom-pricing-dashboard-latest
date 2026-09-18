import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { isAuthenticated } from "@/lib/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const ok = isAuthenticated();
    setAllowed(ok);
    if (!ok) {
      void navigate({ to: "/login", replace: true });
    }
  }, [navigate]);

  if (allowed !== true) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="text-sm text-muted-foreground">Checking session…</div>
      </div>
    );
  }

  return children;
}
