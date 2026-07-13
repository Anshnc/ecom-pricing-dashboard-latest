## 1. Bulk upload deadlock + retry

**Root cause (recap):** Bulk `onApply` calls `updateRow` per CSV row, each starting a 400ms debounce timer keyed by `fsnId`. After 400ms all timers fire in the same tick → N parallel Supabase UPDATEs → Postgres reports `40P01 deadlock detected` → the losing transactions are aborted and never persist.

**Fix — serialize the bulk path in `PricingDashboard.tsx` `onApply` (lines ~861–881):**

- Do NOT go through `updateRow` (which is debounced + parallel).
- One `setRows` up front that merges every patch into local state (single re-render).
- Then a sequential `for..of` loop that `await`s `dbUpdateRow(...)` one row at a time. Build each DB patch via the existing `SAVE_MAP` so lock flags / booleans stay consistent.
- Each iteration is wrapped in `try/catch`; failures are collected into `failed: { fsnId, weightUnit, message }[]` and the loop continues (so row 200 failing does not skip 201–342).
- Progress toast: `toast.loading("Saving 0 / N…", { id })` before the loop, updated inside the loop via `toast.loading("Saving i / N…", { id })`.
- Final toast on the same id:
  - all-success → `toast.success("Saved N rows")`
  - partial → `toast.error("Saved X / N. Y rows failed", { description: first 3 fsnIds + "…" , action: { label: "Retry failed", onClick: () => retryFailed() }})` and `console.table(failed)` for the full list.
- Stash `failed` in `lastBulkFailures = useRef<BulkUpdate[]>([])` so the retry action re-runs the same serialized flow with only the failed rows.
- Also expose "Retry failed rows" as a button in the Bulk Upload modal footer (visible only when `lastBulkFailures.current.length > 0`), running the same handler.

**Why this fixes the deadlock:** Supabase UPDATEs are issued strictly one after another, so Postgres never has two conflicting row-locks in flight, and `40P01` cannot occur.

**Note on `saveTimers`:** the bulk path does not populate `saveTimers.current`. The sync-effect `hasPending` guard is not needed here because the local `setRows` runs before the awaits and the DB round-trip reconciles at the end; there are no unrelated single-cell edits mid-flight in the bulk flow.

## 2. Locked-by-default for all five cells

**Current behaviour:** `dbToSku` reads persisted lock flags (`r.quoted_locked ?? true`, etc). Rows previously saved with `false` come back unlocked forever, and the newer `blinkit_sp_locked` / `grn_locked` columns may not exist in the DB yet — either way, the UI shows cells permanently unlocked and there is no way to re-lock cleanly.

**Fix — treat lock state as pure client state, always defaulting to `locked = true` per fetch:**

1. In `dbToSku` (lines 124–135 of `PricingDashboard.tsx`), hard-code all five to `true`:
   ```
   grnLocked: true,
   blinkitLocked: true,
   adjustedGrnLocked: true,
   quotedLocked: true,
   negotiatedLocked: true,
   ```
2. In `SAVE_MAP` (lines 398–402), remove the five `*Locked → *_locked` entries. Lock state is no longer persisted; only the numeric value is written when the user re-locks.
3. In the sync-effect merge (lines 247–251) keep the current `hasPending` branch that preserves local lock flags in-flight — this is what makes "click unlock → edit → click lock" survive the round-trip refresh caused by the value write.
4. Keep every `onToggleLock` handler as-is. They already:
   - unlock branch: `updateRow(fsnId, { <field>Locked: false })` — client-only now.
   - lock branch: `updateRow(fsnId, { <field>Locked: true, <valueField>: currentValue })` — writes the numeric value through `SAVE_MAP`.
5. `src/lib/supabase.ts`: leave the five lock columns on the `PricingSheetRow` type (they're harmless / optional) but no code writes to them any more. No DB migration needed.

**User-facing flow after fix:**
- Load sheet → every Quoted PP, Negotiated PP, Adjusted GRN, Blinkit SP, GRN cell shows a filled lock icon and a read-only value.
- Click the lock icon → cell becomes editable.
- Type new value → local state updates; nothing hits the DB yet.
- Click the lock icon again → value is written to DB (via `SAVE_MAP`), cell returns to locked read-only.
- Refresh → all five come back locked (default), with the latest DB values displayed.

## Files touched

- `src/components/pricing/PricingDashboard.tsx`
  - `dbToSku`: hard-code five lock defaults to `true`.
  - `SAVE_MAP`: drop the five lock keys.
  - Bulk `onApply`: rewrite as serialized loop with per-row try/catch, progress toast, failure collection, retry action + modal button.
  - Add `lastBulkFailures = useRef<BulkUpdate[]>([])` and `retryFailed()` helper wired to the modal.
- `BulkUploadModal` component: add optional "Retry failed rows" button in the footer, driven by a prop from the parent.

No DB migrations. No changes to `usePricingSheet.ts`. Math, layout, and the Download FK button behavior stay untouched.

## Verify

- Bulk upload a CSV that previously produced `deadlock detected` → progress toast counts to N, final toast reads "Saved N rows", DB rows reflect the new values.
- Simulate a failure (e.g. temporarily bad fsn_id in the CSV) → other rows still persist, failure toast shows count + first fsnIds, "Retry failed rows" button re-runs only the failed subset.
- On a freshly loaded sheet: every Quoted PP / Negotiated PP / Adjusted GRN / Blinkit SP / GRN cell is locked. Unlock → edit → re-lock writes the new value; refresh keeps the value and returns the cell to locked.
