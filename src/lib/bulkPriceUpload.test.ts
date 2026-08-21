import { parseBulkPriceUpdates } from "./bulkPriceUpload";
import { computeRowMetrics } from "./pricingMetrics";

function assert(cond: unknown, label: string) {
  if (!cond) throw new Error(label);
}

const exported = `FSN ID,Weight Unit,Quoted PP,NLC,GM,PI %
VEGGH9ZSYN3U269R,3 - Kg Onion - SD lot,40.00,45.37,10.00,12.5
`;

const parsed = parseBulkPriceUpdates(exported);
assert(parsed.updates.length === 1, "parses one row");
assert(parsed.updates[0]!.fsnId === "VEGGH9ZSYN3U269R", "FSN ID header");
assert(parsed.updates[0]!.quotedPp === 40, "Quoted PP is taken from CSV");
assert(parsed.hasDerivedColumns === true, "detects NLC/GM/PI% columns");

const after = computeRowMetrics(
  {
    demandUnits: 100,
    conversionFactor: 1,
    grnPricePerKg: 20,
    quotedPp: parsed.updates[0]!.quotedPp ?? 0,
    quotedPpIsSet: parsed.updates[0]!.quotedPp != null,
    negotiatedPp: 0,
    packagingCost: 1.7,
    fmlCost: 0.95,
    processingCost: 3.72,
    blinkitSp: 50,
  },
  100,
);
assert(after.nlc !== 45.37, "CSV NLC must not be used");
assert(Math.abs((after.nlc ?? 0) - (40 + 1.7 + 0.95 + 3.72)) < 0.01, "NLC = new Quoted PP + costs");
assert(Math.abs((after.gm ?? 0) - ((40 + 1.7 + 0.95 + 3.72) - 20)) < 0.01, "GM follows new NLC");

const fkSheet = parseBulkPriceUpdates("FSN,Quoted PP\nABC123,12.5\n");
assert(fkSheet.updates[0]!.fsnId === "ABC123", "FSN header from FK sheet");
assert(fkSheet.updates[0]!.quotedPp === 12.5, "Quoted PP from FK sheet");

const junk = parseBulkPriceUpdates("fsn_id,quoted_pp\nABC123,not-a-number\n");
assert(junk.updates.length === 0, "non-numeric Quoted PP is skipped");

console.log("bulkPriceUpload.test.ts — all assertions passed");
