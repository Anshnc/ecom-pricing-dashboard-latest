import { parseBlinkitSpUpload, pairBlinkitSpBySequence } from "./blinkitSpUpload";

function assert(cond: unknown, label: string) {
  if (!cond) throw new Error(label);
}

const twoCol = parseBlinkitSpUpload(`FSN,Blinkit SP
AAA,10
BBB,20
CCC,
`);
assert(twoCol.length === 3, "parses 2-col file including empty SP row");
assert(twoCol[0]!.fsnId === "AAA" && twoCol[0]!.blinkitSp === 10, "first SP");
assert(twoCol[2]!.blinkitSp === null, "blank SP is null");

const fullExport = parseBlinkitSpUpload(`FSN ID,Weight Unit,Blinkit SP,Quoted PP
VEGG1,1kg,49.5,30
VEGG1,500g,22,12
`);
assert(fullExport.length === 2, "reads FSN ID + Blinkit SP from full export");
assert(fullExport[0]!.blinkitSp === 49.5, "decimal SP");
assert(fullExport[1]!.fsnId === "VEGG1", "duplicate FSN kept in file order");

const paired = pairBlinkitSpBySequence(fullExport, ["VEGG1", "VEGG1"]);
assert(paired.pairs.length === 2, "duplicate FSN maps by sequence");
assert(paired.pairs[0]!.blinkitSp === 49.5 && paired.pairs[1]!.blinkitSp === 22, "each pack gets its SP");
assert(paired.fsnMismatch === 0, "no mismatch when order matches download");

const mismatch = pairBlinkitSpBySequence(
  [
    { fsnId: "AAA", blinkitSp: 1 },
    { fsnId: "ZZZ", blinkitSp: 2 },
  ],
  ["AAA", "BBB"],
);
assert(mismatch.pairs.length === 1, "only matching FSN at the same index is applied");
assert(mismatch.fsnMismatch === 1, "counts FSN/order mismatch");

const skipEmpty = pairBlinkitSpBySequence(
  [
    { fsnId: "AAA", blinkitSp: null },
    { fsnId: "BBB", blinkitSp: 0 },
  ],
  ["AAA", "BBB"],
);
assert(skipEmpty.pairs.length === 1 && skipEmpty.pairs[0]!.blinkitSp === 0, "0 overwrites; blank is skipped");
assert(skipEmpty.skippedEmpty === 1, "blank SP does not clear existing");

const blankMiddle = parseBlinkitSpUpload(`FSN,Blinkit SP
AAA,10
BBB,
CCC,30
`);
assert(blankMiddle.length === 3, "blank SP still occupies a sequence slot");
const blankPaired = pairBlinkitSpBySequence(
  blankMiddle,
  ["AAA", "BBB", "CCC"],
);
assert(blankPaired.pairs.length === 2, "applies AAA and CCC");
assert(blankPaired.pairs[1]!.fsnId === "CCC" && blankPaired.pairs[1]!.blinkitSp === 30, "CCC is not shifted by blank BBB");

console.log("blinkitSpUpload.test.ts — all assertions passed");
