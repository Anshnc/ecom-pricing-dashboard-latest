import { parseBulkPriceUpdates } from "./bulkPriceUpload";
import { computeRowMetrics } from "./pricingMetrics";

function assert(cond: unknown, label: string) {
  if (!cond) throw new Error(label);
}

const exported = `FSN ID,Weight Unit,Total Demand %,NC SKU Name,Special Tags,Subcategory,Conv. Factor,Demand Units,NLC Value Mix,GRN ₹/kg,Prev Day GRN ₹/unit,GRN ₹/unit,GRN Diff,Adjusted GRN,Total GRN ₹/unit,Blinkit SP,WSP Trend,Quoted PP,GRN Markup,Negotiated PP,Suggested PP,NLC,PI %,GM,Deflection %,Impact PP Diff,Impact GM,BK Value Mix
VEGGH9ZSYN3U269R,3 - Kg Onion - SD lot,1.000,Onion,,Vegetables,1,100,4537,20,18,20,2,0,20,50,flat,40.00,20,38, ,45.37,12.5,25.37,2.1,0.2,0.25,5000
`;

const parsed = parseBulkPriceUpdates(exported);
assert(parsed.length === 1, "parses one download-CSV row");
assert(parsed[0]!.fsnId === "VEGGH9ZSYN3U269R", "FSN ID header");
assert(parsed[0]!.quotedPp === 40, "Quoted PP from download CSV");
assert(parsed[0]!.negotiatedPp === 38, "Negotiated PP from download CSV");
assert(parsed[0]!.blinkitSp === 50, "Blinkit SP from download CSV");
assert(parsed[0]!.grnPricePerKg === 20, "GRN ₹/kg from download CSV");

const after = computeRowMetrics(
  {
    demandUnits: 100,
    conversionFactor: 1,
    grnPricePerKg: 30,
    quotedPp: parsed[0]!.quotedPp ?? 0,
    quotedPpIsSet: parsed[0]!.quotedPp != null,
    negotiatedPp: parsed[0]!.negotiatedPp ?? 0,
    negotiatedPpIsSet: parsed[0]!.negotiatedPp != null,
    packagingCost: 1.7,
    fmlCost: 0.95,
    processingCost: 3.72,
    blinkitSp: parsed[0]!.blinkitSp ?? null,
  },
  100,
);
assert(after.nlc !== 45.37, "CSV NLC is not used");
assert(Math.abs((after.nlc ?? 0) - (40 + 1.7 + 0.95 + 3.72)) < 0.01, "NLC = new Quoted PP + costs");
assert(Math.abs((after.totalGrnPerUnit ?? 0) - 30) < 0.01, "Total GRN/unit follows new GRN ₹/kg");
assert(Math.abs((after.gm ?? 0) - ((40 + 1.7 + 0.95 + 3.72) - 30)) < 0.01, "GM follows new NLC and GRN");
assert(Math.abs((after.grnMarkup ?? 0) - (40 - 30)) < 0.01, "GRN markup follows new GRN ₹/kg");

const junk = parseBulkPriceUpdates("FSN ID,Quoted PP\nABC123,not-a-number\n");
assert(junk.length === 0, "non-numeric Quoted PP is skipped");

console.log("bulkPriceUpload.test.ts — all assertions passed");
