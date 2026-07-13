import { createFileRoute } from "@tanstack/react-router";
import { PricingDashboard } from "@/components/pricing/PricingDashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ecom Pricing — Bifrost 2.0" },
      { name: "description", content: "Daily pricing workflow for F&V and grocery SKUs." },
    ],
  }),
  component: Index,
});

function Index() {
  return <PricingDashboard />;
}
