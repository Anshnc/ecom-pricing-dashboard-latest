import { useEffect, useState, type ReactNode } from "react";

import { LoginPage } from "@/components/auth/LoginPage";
import { isAuthenticated } from "@/lib/auth";

/** Renders the sign-in form until a session exists. Never mounts the dashboard first. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(isAuthenticated());
  }, []);

  if (!allowed) {
    return <LoginPage onSuccess={() => setAllowed(true)} />;
  }

  return children;
}
