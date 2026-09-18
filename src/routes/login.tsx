import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/components/auth/LoginPage";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Ecom Pricing" },
      { name: "description", content: "Sign in to the Ecom Pricing console." },
    ],
  }),
  component: Login,
});

function Login() {
  return <LoginPage />;
}
